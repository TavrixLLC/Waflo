import { createApiApplication } from "./app.js";
import { EnvironmentService } from "./config/environment.service.js";

async function bootstrap(): Promise<void> {
  const app = await createApiApplication();
  const environment = app.get(EnvironmentService);
  app.enableShutdownHooks(["SIGTERM", "SIGINT"]);
  await app.listen(environment.values.API_PORT, "0.0.0.0");
}

function safeStartupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:postgres(?:ql)?|redis|https?):\/\/[^\s"']+/giu, (url) => {
    const scheme = url.slice(0, url.indexOf(":"));
    return `${scheme}://[redacted]`;
  });
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(`Waflo API failed to start: ${safeStartupError(error)}\n`);
  process.exitCode = 1;
});
