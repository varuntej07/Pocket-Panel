import { NextResponse } from "next/server";
import { getModeById } from "../../../lib/modes";
import { createSession } from "../../../lib/session-store";
import { StartSessionRequestSchema } from "../../../lib/tool-schemas";
import { logError, logInfo } from "../../../lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const buildWsUrl = (sessionId: string, request: Request): string => {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? "localhost:3000";
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto = forwardedProto ?? "http";
  const wsProto = proto === "https" ? "wss" : "ws";
  return `${wsProto}://${host}/ws?sessionId=${encodeURIComponent(sessionId)}`;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const parsed = StartSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload.",
          details: parsed.error.flatten()
        },
        { status: 400 }
      );
    }

    const { prompt, modeId } = parsed.data;
    logInfo("api/start", "Received session start request", {
      promptLength: prompt.length,
      modeId,
      host: request.headers.get("host") ?? "",
      forwardedHost: request.headers.get("x-forwarded-host") ?? "",
      forwardedProto: request.headers.get("x-forwarded-proto") ?? ""
    });

    const mode = getModeById(modeId);
    if (!mode) {
      return NextResponse.json(
        {
          error: `Unknown modeId: ${modeId}`
        },
        { status: 404 }
      );
    }

    const session = createSession(prompt, mode);
    const wsUrl = buildWsUrl(session.id, request);

    logInfo("api/start", "Session created", {
      sessionId: session.id,
      modeId: mode.id,
      wsUrl
    });

    return NextResponse.json({
      sessionId: session.id,
      wsUrl
    });
  } catch (error) {
    logError("api/start", "Failed to create session", { error: String(error) });
    return NextResponse.json(
      {
        error: "Failed to create session."
      },
      { status: 500 }
    );
  }
}
