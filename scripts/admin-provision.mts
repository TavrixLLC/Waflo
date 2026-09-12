import { runAdminProvisionCli } from "./admin-provision-cli.ts";

void runAdminProvisionCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`Admin provisioning failed: ${message}\n`);
  process.exitCode = 1;
});
