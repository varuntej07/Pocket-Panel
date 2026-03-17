import { db } from "../index";
import { turns } from "../schema";

export const insertTurn = async (params: {
  sessionId: string;
  speaker: string;
  text: string;
  turnIndex: number;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> => {
  if (!db) return;
  await db.insert(turns).values({
    sessionId: params.sessionId,
    speaker: params.speaker,
    text: params.text,
    turnIndex: params.turnIndex,
    inputTokens: params.inputTokens ?? null,
    outputTokens: params.outputTokens ?? null
  });
};
