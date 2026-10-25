import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  playerOneToken: text("player_one_token").notNull(),
  playerTwoToken: text("player_two_token"),
  currentRound: integer("current_round").notNull().default(1),
  status: text("status").notNull().default("waiting"),
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
    playerOneSubmittedAt: text("player_one_submitted_at"),
    playerTwoSubmittedAt: text("player_two_submitted_at"),
    playerOneReady: integer("player_one_ready", { mode: "boolean" }).notNull().default(false),
    playerTwoReady: integer("player_two_ready", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.roomCode, table.number] })],
);
