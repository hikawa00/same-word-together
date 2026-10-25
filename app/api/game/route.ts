import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { rooms, rounds } from "../../../db/schema";

const ROUND_MS = 60_000;

function cleanCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function cleanWord(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
}

function normalizeWord(value: string | null) {
  return (value ?? "").trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function fail(error: string, status = 400) {
  return Response.json({ error }, { status });
}

function slotFor(room: typeof rooms.$inferSelect, token: string) {
  if (room.playerOneToken === token) return 1;
  if (room.playerTwoToken === token) return 2;
  return 0;
}

async function stateFor(code: string, token: string) {
  const db = getDb();
  const room = await db.query.rooms.findFirst({ where: eq(rooms.code, code) });
  if (!room) return { error: "房间不存在，检查一下房间码吧。", status: 404 } as const;
  const slot = slotFor(room, token);
  if (!slot) return { error: "这个房间已经有两位玩家了。", status: 403 } as const;

  const allRounds = await db.select().from(rounds).where(eq(rounds.roomCode, code)).orderBy(asc(rounds.number));
  const current = allRounds.find((round) => round.number === room.currentRound) ?? null;
  const now = Date.now();
  const deadline = current ? new Date(current.startedAt).getTime() + ROUND_MS : null;
  const bothSubmitted = Boolean(current?.playerOneWord && current?.playerTwoWord);
  const revealed = Boolean(current && (bothSubmitted || (deadline !== null && now >= deadline)));
  const exactMatch = Boolean(
    revealed && current?.playerOneWord && current?.playerTwoWord &&
    normalizeWord(current.playerOneWord) === normalizeWord(current.playerTwoWord),
  );
  const manualMatch = Boolean(revealed && current?.playerOneMatch && current?.playerTwoMatch);
  const matched = exactMatch || manualMatch;

  return {
    room: {
      code,
      slot,
      phase: !room.playerTwoToken ? "waiting" : matched ? "matched" : revealed ? "revealed" : "thinking",
      roundNumber: room.currentRound,
      deadline,
      serverNow: now,
      myWord: current ? (slot === 1 ? current.playerOneWord : current.playerTwoWord) : null,
      mySubmitted: current ? Boolean(slot === 1 ? current.playerOneWord : current.playerTwoWord) : false,
      otherSubmitted: current ? Boolean(slot === 1 ? current.playerTwoWord : current.playerOneWord) : false,
      myReady: current ? Boolean(slot === 1 ? current.playerOneReady : current.playerTwoReady) : false,
      otherReady: current ? Boolean(slot === 1 ? current.playerTwoReady : current.playerOneReady) : false,
      myMatchVote: current ? Boolean(slot === 1 ? current.playerOneMatch : current.playerTwoMatch) : false,
      otherMatchVote: current ? Boolean(slot === 1 ? current.playerTwoMatch : current.playerOneMatch) : false,
      matchReason: matched ? (exactMatch ? "exact" : "manual") : null,
      words: revealed ? [current?.playerOneWord || "（未提交）", current?.playerTwoWord || "（未提交）"] : null,
      history: allRounds.filter((round) => round.number < room.currentRound).map((round) => ({
        number: round.number,
        words: [round.playerOneWord || "（未提交）", round.playerTwoWord || "（未提交）"],
      })),
    },
  } as const;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = cleanCode(url.searchParams.get("code"));
    const token = String(url.searchParams.get("token") ?? "");
    if (!code || !token) return fail("缺少房间信息。", 400);
    const result = await stateFor(code, token);
    if ("error" in result) return fail(result.error, result.status);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return fail("服务暂时开小差了，请稍后再试。", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const db = getDb();

    if (action === "create") {
      const token = crypto.randomUUID();
      const now = new Date().toISOString();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = randomCode();
        try {
          await db.insert(rooms).values({ code, playerOneToken: token, createdAt: now, updatedAt: now });
          return Response.json({ code, token }, { status: 201 });
        } catch (error) {
          if (attempt === 7) throw error;
        }
      }
    }

    const code = cleanCode(body.code);
    if (!code) return fail("请输入 6 位房间码。", 400);
    const room = await db.query.rooms.findFirst({ where: eq(rooms.code, code) });
    if (!room) return fail("没有找到这个房间。", 404);

    if (action === "join") {
      if (room.playerTwoToken) return fail("房间已经满员啦。", 409);
      const token = crypto.randomUUID();
      const now = new Date().toISOString();
      const updated = await db.update(rooms)
        .set({ playerTwoToken: token, status: "active", updatedAt: now })
        .where(and(eq(rooms.code, code), eq(rooms.status, "waiting"))).returning();
      if (!updated.length) return fail("刚刚有人抢先加入了这个房间。", 409);
      await db.insert(rounds).values({ roomCode: code, number: 1, startedAt: now });
      return Response.json({ code, token });
    }

    const token = String(body.token ?? "");
    const slot = slotFor(room, token);
    if (!slot) return fail("无权操作这个房间。", 403);
    const current = await db.query.rounds.findFirst({
      where: and(eq(rounds.roomCode, code), eq(rounds.number, room.currentRound)),
    });
    if (!current) return fail("还在等另一位玩家加入。", 409);

    if (action === "submit") {
      const word = cleanWord(body.word);
      if (!word) return fail("先写下一个词语吧。", 400);
      const deadline = new Date(current.startedAt).getTime() + ROUND_MS;
      if (Date.now() >= deadline || (slot === 1 ? current.playerOneWord : current.playerTwoWord)) {
        return fail("这一轮已经不能修改了。", 409);
      }
      const now = new Date().toISOString();
      await db.update(rounds)
        .set(slot === 1 ? { playerOneWord: word, playerOneSubmittedAt: now } : { playerTwoWord: word, playerTwoSubmittedAt: now })
        .where(and(eq(rounds.roomCode, code), eq(rounds.number, room.currentRound)));
    } else if (action === "match") {
      const deadline = new Date(current.startedAt).getTime() + ROUND_MS;
      const revealed = Boolean((current.playerOneWord && current.playerTwoWord) || Date.now() >= deadline);
      if (!revealed) return fail("还没到揭晓时间。", 409);
      await db.update(rounds)
        .set(slot === 1 ? { playerOneMatch: true } : { playerTwoMatch: true })
        .where(and(eq(rounds.roomCode, code), eq(rounds.number, room.currentRound)));
    } else if (action === "ready") {
      const deadline = new Date(current.startedAt).getTime() + ROUND_MS;
      const revealed = Boolean((current.playerOneWord && current.playerTwoWord) || Date.now() >= deadline);
      if (!revealed) return fail("还没到揭晓时间。", 409);
      const matched = Boolean(
        (current.playerOneWord && current.playerTwoWord && normalizeWord(current.playerOneWord) === normalizeWord(current.playerTwoWord)) ||
        (current.playerOneMatch && current.playerTwoMatch),
      );
      if (matched) return fail("已经成功想到同一个词啦！", 409);
      await db.update(rounds)
        .set(slot === 1 ? { playerOneReady: true } : { playerTwoReady: true })
        .where(and(eq(rounds.roomCode, code), eq(rounds.number, room.currentRound)));
      const refreshed = await db.query.rounds.findFirst({
        where: and(eq(rounds.roomCode, code), eq(rounds.number, room.currentRound)),
      });
      if (refreshed?.playerOneReady && refreshed.playerTwoReady) {
        const nextNumber = room.currentRound + 1;
        const now = new Date().toISOString();
        await db.insert(rounds).values({ roomCode: code, number: nextNumber, startedAt: now }).onConflictDoNothing();
        await db.update(rooms).set({ currentRound: nextNumber, updatedAt: now })
          .where(and(eq(rooms.code, code), eq(rooms.currentRound, room.currentRound)));
      }
    } else {
      return fail("未知操作。", 400);
    }

    const result = await stateFor(code, token);
    if ("error" in result) return fail(result.error, result.status);
    return Response.json(result);
  } catch (error) {
    console.error(error);
    return fail("服务暂时开小差了，请稍后再试。", 500);
  }
}
