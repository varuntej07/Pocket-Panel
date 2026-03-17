import { eq } from "drizzle-orm";
import { db } from "../index";
import { sessions } from "../schema";
import type { SessionState } from "../../types";

export const upsertSession = async (session: SessionState): Promise<void> => {
  if (!db) return;
  await db
    .insert(sessions)
    .values({
      id: session.id,
      prompt: session.prompt,
      topicBreadcrumb: session.topicBreadcrumb,
      modeId: session.mode.id,
      modeTitle: session.mode.title,
      modeCategory: session.mode.category,
      status: session.status,
      totalTurns: session.turns.length,
      ipAddress: session.ipAddress ?? null,
      createdAt: new Date(session.createdAt),
      updatedAt: new Date(session.updatedAt)
    })
    .onConflictDoUpdate({
      target: sessions.id,
      set: {
        status: session.status,
        totalTurns: session.turns.length,
        updatedAt: new Date(session.updatedAt)
      }
    });
};

export const updateSessionStatus = async (
  sessionId: string,
  status: string,
  extra?: { endedReason?: string; lastError?: string; endedAt?: Date }
): Promise<void> => {
  if (!db) return;
  await db
    .update(sessions)
    .set({
      status,
      updatedAt: new Date(),
      ...(extra?.endedReason !== undefined && { endedReason: extra.endedReason }),
      ...(extra?.lastError !== undefined && { lastError: extra.lastError }),
      ...(extra?.endedAt !== undefined && { endedAt: extra.endedAt })
    })
    .where(eq(sessions.id, sessionId));
};

export const updateSessionTurns = async (sessionId: string, totalTurns: number): Promise<void> => {
  if (!db) return;
  await db
    .update(sessions)
    .set({ totalTurns, updatedAt: new Date() })
    .where(eq(sessions.id, sessionId));
};

export const updateSessionIp = async (sessionId: string, ipAddress: string): Promise<void> => {
  if (!db) return;
  await db
    .update(sessions)
    .set({ ipAddress, updatedAt: new Date() })
    .where(eq(sessions.id, sessionId));
};

export const updateSessionLocation = async (
  sessionId: string,
  location: Record<string, unknown>
): Promise<void> => {
  if (!db) return;
  await db
    .update(sessions)
    .set({ location, updatedAt: new Date() })
    .where(eq(sessions.id, sessionId));
};
