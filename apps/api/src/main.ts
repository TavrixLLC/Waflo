import { createApiApplication } from "./app.js";
import { EnvironmentService } from "./config/environment.service.js";

async function bootstrap(): Promise<void> {
  const app = await createApiApplication();
  const environment = app.get(EnvironmentService);
  app.enableShutdownHooks(["SIGTERM", "SIGINT"]);
  await app.listen(environment.values.API_PORT, "0.0.0.0");
}

void bootstrap().catch(() => {
  process.stderr.write("Waflo API failed to start.\n");
  process.exitCode = 1;
});
