import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import next from "next";
import { attachWebSocketServer } from "./ws/ws-server";
import { logError, logInfo } from "../lib/telemetry";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

async function bootstrap(): Promise<void> {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res);
  });

  attachWebSocketServer(server);

  server.listen(port, hostname, () => {
    logInfo("server", `PocketPanel listening on http://${hostname}:${port}`, {
      nodeEnv: process.env.NODE_ENV ?? "development"
    });
  });
}

bootstrap().catch((error) => {
  logError("server", "Startup failed", { error: String(error) });
  process.exit(1);
});
