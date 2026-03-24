import "dotenv/config";
import { buildServer } from "./server.js";

function resolvePort(rawPort: string | undefined): number {
  const parsed = Number.parseInt(rawPort ?? "3101", 10);
  return Number.isNaN(parsed) ? 3101 : parsed;
}

async function main(): Promise<void> {
  const app = buildServer();
  const host = process.env.HOST ?? "0.0.0.0";
  const port = resolvePort(process.env.PORT);

  try {
    await app.listen({ host, port });
    app.log.info(`workspace-fastify listening on http://${host}:${port}`);
  } catch (error) {
    app.log.error(error, "failed to start workspace-fastify");
    process.exitCode = 1;
    await app.close();
  }
}

void main();
