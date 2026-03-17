import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import { URL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { logEvent } from "../../lib/db/queries/events";
import { updateSessionLocation } from "../../lib/db/queries/debates";
import { clearSessionSocket, getSession, markSessionEnded, setPendingInjection, setSessionIp, setSessionSocket, signalSpeechDone } from "../../lib/session-store";
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

const getClientIp = (request: IncomingMessage): string => {
  const forwarded = request.headers["x-forwarded-for"];
  if (forwarded) {
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return raw.split(",")[0].trim();
  }
  return request.socket.remoteAddress ?? "unknown";
};

const PRIVATE_IP_PREFIXES = ["127.", "10.", "192.168.", "::1", "::ffff:127.", "unknown"];
const isPrivateIp = (ip: string): boolean =>
  PRIVATE_IP_PREFIXES.some((prefix) => ip.startsWith(prefix)) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

const geoLookup = async (ip: string): Promise<Record<string, unknown> | null> => {
  if (isPrivateIp(ip)) return null;
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,regionName,lat,lon,status`);
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    return data["status"] === "success" ? data : null;
  } catch {
    return null;
  }
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

    const clientIp = getClientIp(request);
    setSessionSocket(sessionId, ws);
    setSessionIp(sessionId, clientIp);
    logInfo("ws", "Client connected", { sessionId, clientIp });

    void logEvent({ sessionId, eventType: "ws_connected", metadata: { session_id: sessionId }, ipAddress: clientIp }).catch(() => {});

    // Fire-and-forget geo lookup — never blocks WS pipeline
    void geoLookup(clientIp)
      .then((location) => {
        if (location) {
          void updateSessionLocation(sessionId, location).catch(() => {});
        }
      })
      .catch(() => {});

    ws.on("close", (code: number, reasonBuffer: Buffer) => {
      clearSessionSocket(sessionId);
      const current = getSession(sessionId);
      if (current && (current.status === "created" || current.status === "running")) {
        markSessionEnded(sessionId, "closed");
      }
      const reason = reasonBuffer.toString("utf-8");
      logInfo("ws", "Client disconnected", { sessionId, code, reason });
      void logEvent({ sessionId, eventType: "ws_disconnected", metadata: { close_code: code, reason }, ipAddress: clientIp }).catch(() => {});
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
        if (parsed.type === "CLIENT_SPEECH_DONE") {
          signalSpeechDone(sessionId);
          logInfo("ws", "Client speech done signal received", { sessionId });
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
