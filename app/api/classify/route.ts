import { NextResponse } from "next/server";
import { classifyIntentWithTools } from "../../../lib/bedrock/classifier";
import { rankModeSuggestions } from "../../../lib/mode-ranking";
import { ClassifyIntentRequestSchema } from "../../../lib/tool-schemas";
import { logError, logInfo } from "../../../lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const parsed = ClassifyIntentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload.",
          details: parsed.error.flatten()
        },
        { status: 400 }
      );
    }

    const { prompt } = parsed.data;
    logInfo("api/classify", "Classifying prompt", { promptLength: prompt.length });

    const classification = await classifyIntentWithTools(prompt);
    const modes = rankModeSuggestions(classification.intent, classification.suggestedModes);
    logInfo("api/classify", "Classification complete", {
      intent: classification.intent,
      suggestedModeCount: classification.suggestedModes.length,
      rankedModeCount: modes.length
    });

    return NextResponse.json({
      intent: classification.intent,
      modes
    });
  } catch (error) {
    logError("api/classify", "Classification failed", { error: String(error) });
    return NextResponse.json(
      {
        error: "Classification failed."
      },
      { status: 500 }
    );
  }
}
