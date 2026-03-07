import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import { URL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { clearSessionSocket, getSession, markSessionEnded, setPendingInjection, setSessionSocket } from "../../lib/session-store";
import { logError, logInfo } from "../../lib/telemetry";
import { startConversationIfNeeded } from "../orchestrator/conversation-orchestrator";
import type { ServerWsEvent } from "./protocol";

const SESSION_ID_PARAM = "sessionId";

const sendWsEvent = (socket: { send: (payload: string) => void }, event: ServerWsEvent): void => {
  socket.send(JSON.stringify(event));
};

const getSessionIdFromRequest = (request: IncomingMessage): string | null => {
  const host = request.headers.host ?? "localhost";
  const requestUrl = new URL(request.url ?? "/", `http://${host}`);
  return requestUrl.searchParams.get(SESSION_ID_PARAM);
};

export const attachWebSocketServer = (server: HttpServer): void => {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const host = request.headers.host ?? "localhost";
    const requestUrl = new URL(request.url ?? "/", `http://${host}`);
    logInfo("ws", "Received HTTP upgrade request", {
      host,
      path: requestUrl.pathname,
      hasSessionId: Boolean(requestUrl.searchParams.get(SESSION_ID_PARAM))
    });
    if (requestUrl.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    const sessionId = getSessionIdFromRequest(request);
    if (!sessionId) {
      sendWsEvent(ws, { type: "ERROR", message: "Missing sessionId query parameter." });
      ws.close(1008);
      return;
    }

    const session = getSession(sessionId);
    if (!session) {
      sendWsEvent(ws, {
        type: "ERROR",
        message: `Session ${sessionId} was not found.`
      });
      ws.close(1008);
      return;
    }

    setSessionSocket(sessionId, ws);
    logInfo("ws", "Client connected", { sessionId });

    ws.on("close", (code: number, reasonBuffer: Buffer) => {
      clearSessionSocket(sessionId);
      const current = getSession(sessionId);
      if (current && (current.status === "created" || current.status === "running")) {
        markSessionEnded(sessionId, "closed");
      }
      logInfo("ws", "Client disconnected", {
        sessionId,
        code,
        reason: reasonBuffer.toString("utf-8")
      });
    });

    ws.on("message", (data) => {
      const raw = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
      logInfo("ws", "Received message from websocket client", {
        sessionId,
        payloadLength: raw.length
      });

      try {
        const parsed = JSON.parse(raw.toString("utf-8")) as { type?: string; text?: string };
        if (parsed.type === "USER_INJECT" && typeof parsed.text === "string" && parsed.text.trim().length > 0) {
          setPendingInjection(sessionId, parsed.text.trim());
          logInfo("ws", "User injection queued", { sessionId, textLength: parsed.text.length });
        }
      } catch {
        // Non-JSON message — ignore
      }
    });

    ws.on("error", (error: Error) => {
      logError("ws", "Socket error", {
        sessionId,
        errorName: error.name,
        errorMessage: error.message
      });
    });

    startConversationIfNeeded(sessionId);
  });

  logInfo("ws", "WebSocket server attached", {});
};
