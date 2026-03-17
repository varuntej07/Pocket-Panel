import { eq } from "drizzle-orm";
import { db } from "../index";
import { transcripts } from "../schema";
import type { SessionTurn } from "../../types";

export const upsertTranscript = async (sessionId: string, turns: SessionTurn[]): Promise<void> => {
  if (!db) return;
  const fullText = turns.map((t) => ({
    speaker: t.speaker,
    text: t.text,
    turnIndex: t.turnIndex,
    createdAt: t.createdAt
  }));
  const wordCount = turns.reduce((sum, t) => sum + t.text.trim().split(/\s+/).length, 0);

  await db
    .insert(transcripts)
    .values({ sessionId, fullText, wordCount })
    .onConflictDoUpdate({
      target: transcripts.sessionId,
      set: { fullText, wordCount }
    });
};

export const updateSynthesisText = async (sessionId: string, synthesisText: string): Promise<void> => {
  if (!db) return;
  await db.update(transcripts).set({ synthesisText }).where(eq(transcripts.sessionId, sessionId));
};
