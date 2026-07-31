import { createConnection } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const managedPorts = [3000, 3001, 3002, 4000];
const output = resolve("artifacts/handoff-w4-round-1/raw-test-output/process-cleanup.log");

function isOpen(port) {
  return new Promise((resolveState) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolveState(true);
    });
    const close = () => {
      socket.destroy();
      resolveState(false);
    };
    socket.once("error", close);
    socket.once("timeout", close);
  });
}

const states = await Promise.all(managedPorts.map(async (port) => [port, await isOpen(port)]));
const openPorts = states.filter(([, open]) => open).map(([port]) => port);
const lines = [
  `checked_at=${new Date().toISOString()}`,
  ...states.map(([port, open]) => `port_${port}=${open ? "OPEN" : "CLOSED"}`),
  `exit_code=${openPorts.length === 0 ? 0 : 1}`,
  "",
];

await mkdir(resolve("artifacts/handoff-w4-round-1/raw-test-output"), { recursive: true });
await writeFile(output, lines.join("\n"), "utf8");
process.stdout.write(lines.join("\n"));
if (openPorts.length) {
  throw new Error(`Managed ports still open: ${openPorts.join(", ")}`);
}
