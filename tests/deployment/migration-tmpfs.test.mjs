import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arguments_ = process.argv.slice(2);
let composeExecutable = "docker";
let composePrefix = ["compose"];
if (arguments_[0] === "--compose-binary") {
  composeExecutable = arguments_[1];
  composePrefix = [];
  arguments_.splice(0, 2);
}
const tmpfs = arguments_;
if (tmpfs.length !== 1 || tmpfs[0] !== "/tmp:rw,noexec,nosuid,size=64m") {
  throw new Error(`unexpected rendered migration tmpfs vector: ${JSON.stringify(tmpfs)}`);
}
for (const value of tmpfs) {
  if (["noexec", "nosuid", "nodev"].includes(value)) {
    throw new Error(`standalone mount-option token: ${value}`);
  }
  const destination = value.split(":", 1)[0];
  if (!destination.startsWith("/")) {
    throw new Error(`tmpfs destination is not absolute: ${destination}`);
  }
}

const scratch = mkdtempSync(join(tmpdir(), "waflo-migration-tmpfs-"));
const composeFile = join(scratch, "compose.json");
const marker = "migration-entrypoint-executed";
const entrypoint = String.raw`
mount_options=''
cap_eff=''
no_new_privs=''
while read -r device target type options remainder; do
  if [ "$$target" = '/tmp' ]; then mount_options="$$options"; fi
done </proc/mounts
for required in noexec nosuid nodev; do
  case ",$$mount_options," in
    *,$$required,*) ;;
    *) echo "missing tmpfs hardening option: $$required" >&2; exit 1 ;;
  esac
done
while IFS=: read -r key value; do
  case "$$key" in
    CapEff) set -- $$value; cap_eff="$$1" ;;
    NoNewPrivs) set -- $$value; no_new_privs="$$1" ;;
  esac
done </proc/self/status
[ "$$cap_eff" = '0000000000000000' ]
[ "$$no_new_privs" = '1' ]
if touch /rootfs-write-check 2>/dev/null; then
  echo 'read-only root filesystem was writable' >&2
  exit 1
fi
printf '%s\n' '${marker}'
`;

writeFileSync(
  composeFile,
  `${JSON.stringify(
    {
      name: `waflo-migration-tmpfs-${process.pid}`,
      services: {
        migrate: {
          image:
            "redis:8.2-alpine@sha256:a7859ed111db3c1f5404a973a4747505d559fb5ca32d37e447afc0ef845a2103",
          entrypoint: ["/bin/sh", "-ec"],
          command: [entrypoint],
          user: "1000:1000",
          init: true,
          restart: "no",
          cap_drop: ["ALL"],
          security_opt: ["no-new-privileges:true"],
          read_only: true,
          tmpfs,
        },
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const composeArgs = [...composePrefix, "-f", composeFile, "run", "--rm", "migrate"];
for (const token of ["noexec", "nosuid", "nodev"]) {
  if (composeArgs.includes(token)) {
    throw new Error(`standalone Docker Compose argv token: ${token}`);
  }
}

try {
  process.stdout.write(
    `migration compose argv: ${JSON.stringify([composeExecutable, ...composeArgs])}\n`,
  );
  const result = spawnSync(composeExecutable, composeArgs, {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `migration container creation failed (${result.status ?? "no status"}):\n${result.stdout}${result.stderr}`,
    );
  }
  const markerCount = result.stdout.split(/\r?\n/u).filter((line) => line.trim() === marker).length;
  if (markerCount !== 1) {
    throw new Error(`migration entrypoint marker count was ${markerCount}:\n${result.stdout}`);
  }
  process.stdout.write(
    "Migration container creation, one-shot entrypoint, and tmpfs hardening smoke passed.\n",
  );
} finally {
  spawnSync(composeExecutable, [...composePrefix, "-f", composeFile, "down", "--remove-orphans"], {
    encoding: "utf8",
    shell: false,
  });
  rmSync(scratch, { recursive: true, force: true });
}
