import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type InitialSessionConstraint = "first-primary" | "first-unconstrained";

export function createDbSession(
  bookmark?: string | null,
  initialConstraint: InitialSessionConstraint = "first-primary",
) {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  const requestedBookmark = bookmark?.trim();
  const startPoint = requestedBookmark && requestedBookmark.length <= 512
    ? requestedBookmark
    : initialConstraint;
  let session: D1DatabaseSession;
  try {
    session = env.DB.withSession(startPoint);
  } catch {
    // A stale or malformed client bookmark must not prevent the player from rejoining.
    session = env.DB.withSession(initialConstraint);
  }

  return {
    db: drizzle(session as unknown as D1Database, { schema }),
    getBookmark: () => session.getBookmark(),
  };
}

export type GameDb = ReturnType<typeof createDbSession>["db"];
export type GameDbSession = ReturnType<typeof createDbSession>;
