import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  playerOneToken: text("player_one_token").notNull(),
  playerTwoToken: text("player_two_token"),
  playerThreeToken: text("player_three_token"),
  currentRound: integer("current_round").notNull().default(1),
  durationSeconds: integer("duration_seconds").notNull().default(60),
  playerCount: integer("player_count").notNull().default(2),
  status: text("status").notNull().default("waiting"),
  isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
  description: text("description"),
  rematchCode: text("rematch_code"),
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const rounds = sqliteTable(
  "rounds",
  {
    roomCode: text("room_code").notNull().references(() => rooms.code, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    startedAt: text("started_at").notNull(),
    playerOneWord: text("player_one_word"),
    playerTwoWord: text("player_two_word"),
    playerThreeWord: text("player_three_word"),
    playerOneSubmittedAt: text("player_one_submitted_at"),
    playerTwoSubmittedAt: text("player_two_submitted_at"),
    playerThreeSubmittedAt: text("player_three_submitted_at"),
    playerOneReady: integer("player_one_ready", { mode: "boolean" }).notNull().default(false),
    playerTwoReady: integer("player_two_ready", { mode: "boolean" }).notNull().default(false),
    playerThreeReady: integer("player_three_ready", { mode: "boolean" }).notNull().default(false),
    playerOneMatch: integer("player_one_match", { mode: "boolean" }).notNull().default(false),
    playerTwoMatch: integer("player_two_match", { mode: "boolean" }).notNull().default(false),
    playerThreeMatch: integer("player_three_match", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.roomCode, table.number] })],
);
