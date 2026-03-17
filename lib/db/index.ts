import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

declare global {
  var __POCKET_PANEL_DB__: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

function createDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

export const db: ReturnType<typeof drizzle<typeof schema>> | null =
  globalThis.__POCKET_PANEL_DB__ ?? (globalThis.__POCKET_PANEL_DB__ = createDb() as any);
