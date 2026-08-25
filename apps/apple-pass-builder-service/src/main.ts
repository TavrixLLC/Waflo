import { preflightSigningIdentities } from "./certificate.js";
import { loadServiceConfiguration } from "./config.js";
import { configurationFingerprint, PassBuilderHttpService } from "./server.js";

async function main() {
  const configuration = await loadServiceConfiguration();
  const certificateExpirations = await preflightSigningIdentities(configuration);
  const service = new PassBuilderHttpService(configuration, certificateExpirations);
  const server = service.createServer();
  server.listen(configuration.port, configuration.host, () => {
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        component: "apple-pass-builder-service",
        event: "ready",
        host: configuration.host,
        port: configuration.port,
        configurationFingerprint: configurationFingerprint(configuration),
      })}\n`,
    );
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Pass Builder service failed to start.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
