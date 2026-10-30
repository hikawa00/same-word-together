import { and, asc, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { createDbSession, type GameDb, type GameDbSession } from "../../../db";
import { rooms, rounds } from "../../../db/schema";
import { D1_BOOKMARK_HEADER } from "../../d1-bookmark";
import { PUBLIC_LOBBY_ENABLED } from "../../../lib/site-features";
import { isRealtimeEnabledForRoom } from "../../../worker/realtime-config";

function cleanCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function cleanWord(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
}

function cleanDescription(value: unknown) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").slice(0, 60);
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

function dbJson(session: GameDbSession, body: unknown, status = 200) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  const bookmark = session.getBookmark();
  if (bookmark) headers.set(D1_BOOKMARK_HEADER, bookmark);
  return Response.json(body, { status, headers });
}

function dbFail(session: GameDbSession, error: string, status = 400) {
  return dbJson(session, { error }, status);
}

function requestBookmark(request: Request) {
  const bookmark = request.headers.get(D1_BOOKMARK_HEADER);
  return bookmark && bookmark.length <= 512 ? bookmark : null;
}

async function notifyRealtimeRoom(code: string) {
  const namespace = env.GAME_ROOMS;
  if (!namespace || !isRealtimeEnabledForRoom(code, env)) return;
  try {
    const room = namespace.get(namespace.idFromName(code));
    await room.fetch("https://game-room/notify", { method: "POST" });
  } catch (error) {
    // The WebSocket prototype is an enhancement. A notification failure must
    // never turn a successful D1 game action into a failed request.
    console.warn({
      event: "game_room_notification_failed",
      errorName: error instanceof Error ? error.name : "Error",
    });
  }
}

function errorLogDetails(error: unknown) {
  const outer = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const cause = outer?.cause && typeof outer.cause === "object" ? outer.cause as Record<string, unknown> : null;
  const safeText = (value: unknown) => {
    if (typeof value !== "string") return undefined;
    // Drizzle may include bound values after "params:". They can contain player input.
    return value.replace(/\s*params:\s*[\s\S]*$/i, " params: [redacted]").slice(0, 600);
  };

  return {
    errorName: typeof outer?.name === "string" ? outer.name : undefined,
    errorCode: typeof outer?.code === "string" || typeof outer?.code === "number" ? outer.code : undefined,
    errorMessage: safeText(outer?.message) ?? (typeof error === "string" ? safeText(error) : undefined),
    causeName: typeof cause?.name === "string" ? cause.name : undefined,
    causeCode: typeof cause?.code === "string" || typeof cause?.code === "number" ? cause.code : undefined,
    causeMessage: safeText(cause?.message),
  };
}

function slotFor(room: typeof rooms.$inferSelect, token: string) {
  if (room.playerOneToken === token) return 1;
  if (room.playerTwoToken === token) return 2;
  if (room.playerThreeToken === token) return 3;
  return 0;
}

function tokenForSlot(room: typeof rooms.$inferSelect, slot: number) {
  return [room.playerOneToken, room.playerTwoToken, room.playerThreeToken][slot - 1] ?? null;
}

async function ensureRematchRoom(room: typeof rooms.$inferSelect, db: GameDb) {
  const latestRoom = await db.query.rooms.findFirst({ where: eq(rooms.code, room.code) });
  if (!latestRoom || latestRoom.rematchCode) return;

  const now = new Date().toISOString();
  let nextCode: string | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidateCode = randomCode();
    try {
      await db.insert(rooms).values({
        code: candidateCode,
        playerOneToken: crypto.randomUUID(),
        playerTwoToken: latestRoom.playerTwoToken ? crypto.randomUUID() : null,
        playerThreeToken: latestRoom.playerThreeToken ? crypto.randomUUID() : null,
        currentRound: 1,
        durationSeconds: latestRoom.durationSeconds,
        playerCount: latestRoom.playerCount,
        status: "active",
        isPublic: false,
        description: null,
        lastSeenAt: null,
        createdAt: now,
        updatedAt: now,
      });
      nextCode = candidateCode;
      break;
    } catch (error) {
      if (attempt === 7) throw error;
    }
  }
  if (!nextCode) throw new Error("无法创建下一局房间。");

  try {
    await db.insert(rounds).values({ roomCode: nextCode, number: 1, startedAt: now });
    const claimed = await db.update(rooms)
      .set({ rematchCode: nextCode, updatedAt: now })
      .where(and(eq(rooms.code, latestRoom.code), isNull(rooms.rematchCode)))
      .returning({ code: rooms.code });
    if (claimed.length) return;
  } catch (error) {
    const latest = await db.query.rooms.findFirst({ where: eq(rooms.code, latestRoom.code) });
    if (latest?.rematchCode === nextCode) return;
    await db.delete(rooms).where(eq(rooms.code, nextCode));
    const winner = await db.query.rooms.findFirst({ where: eq(rooms.code, latestRoom.code) });
    if (winner?.rematchCode) return;
    throw error;
  }

  await db.delete(rooms).where(eq(rooms.code, nextCode));
  const winner = await db.query.rooms.findFirst({ where: eq(rooms.code, latestRoom.code) });
  if (winner?.rematchCode) return;
  throw new Error("无法确认下一局房间，请重试。");
}

async function stateFor(db: GameDb, code: string, token: string, options: {
  compact?: boolean;
  knownRound?: number;
  includeHistory?: boolean;
} = {}) {
  const foundRoom = await db.query.rooms.findFirst({ where: eq(rooms.code, code) });
  if (!foundRoom) return { error: "房间不存在，检查一下房间码吧。", status: 404 } as const;
  let room: typeof rooms.$inferSelect = foundRoom;
  const slot = slotFor(room, token);
  if (!slot) return { error: "房间已满，或当前设备尚未加入。", status: 403 } as const;

  const now = Date.now();
  const lastSeenAt = room.lastSeenAt ? Date.parse(room.lastSeenAt) : 0;
  if (room.isPublic && slot === 1 && room.status === "waiting" && now - lastSeenAt >= 30_000) {
    await db.update(rooms).set({ lastSeenAt: new Date(now).toISOString() })
      .where(and(eq(rooms.code, code), eq(rooms.playerOneToken, token), eq(rooms.isPublic, true), eq(rooms.status, "waiting"), isNull(rooms.playerTwoToken)));
  }

  const includeHistory = !options.compact || options.includeHistory === true ||
    (options.knownRound !== undefined && options.knownRound !== room.currentRound);
  let current: typeof rounds.$inferSelect | null;
  let historyRounds: (typeof rounds.$inferSelect)[] = [];
  if (options.compact) {
    current = (await db.query.rounds.findFirst({
      where: and(eq(rounds.roomCode, code), eq(rounds.number, room.currentRound)),
    })) ?? null;
    if (includeHistory) {
      historyRounds = await db.select().from(rounds).where(and(
        eq(rounds.roomCode, code),
        lt(rounds.number, room.currentRound),
      )).orderBy(asc(rounds.number));
    }
  } else {
    const allRounds = await db.select().from(rounds).where(eq(rounds.roomCode, code)).orderBy(asc(rounds.number));
    current = allRounds.find((round) => round.number === room.currentRound) ?? null;
    historyRounds = allRounds.filter((round) => round.number < room.currentRound);
  }
  const deadline = current && room.durationSeconds > 0
    ? new Date(current.startedAt).getTime() + room.durationSeconds * 1000
    : null;
  const words = current ? [current.playerOneWord, current.playerTwoWord, current.playerThreeWord].slice(0, room.playerCount) : [];
  const readyFlags = current ? [current.playerOneReady, current.playerTwoReady, current.playerThreeReady].slice(0, room.playerCount) : [];
  const matchFlags = current ? [current.playerOneMatch, current.playerTwoMatch, current.playerThreeMatch].slice(0, room.playerCount) : [];
  const allSubmitted = words.length === room.playerCount && words.every(Boolean);
  const revealed = Boolean(current && (allSubmitted || (deadline !== null && now >= deadline)));
  const exactMatch = Boolean(revealed && allSubmitted && words.every((word) => normalizeWord(word) === normalizeWord(words[0])));
  const manualMatch = Boolean(revealed && matchFlags.length === room.playerCount && matchFlags.every(Boolean));
  const matched = exactMatch || manualMatch;
  if (matched && readyFlags.length === room.playerCount && readyFlags.every(Boolean) && !room.rematchCode) {
    await ensureRematchRoom(room, db);
    room = (await db.query.rooms.findFirst({ where: eq(rooms.code, code) })) ?? room;
  }
  const nextRoom = room.rematchCode
    ? await db.query.rooms.findFirst({ where: eq(rooms.code, room.rematchCode) })
    : null;
  const rematchToken = nextRoom ? tokenForSlot(nextRoom, slot) : null;
  const rematch = nextRoom && rematchToken ? { code: nextRoom.code, token: rematchToken } : null;
  const joinedPlayerCount = [room.playerOneToken, room.playerTwoToken, room.playerThreeToken].slice(0, room.playerCount).filter(Boolean).length;
  const myWord = words[slot - 1] ?? null;
  const otherSubmittedCount = words.filter(Boolean).length - Number(Boolean(myWord));
  const otherReadyCount = readyFlags.filter(Boolean).length - Number(Boolean(readyFlags[slot - 1]));
  const otherMatchVoteCount = matchFlags.filter(Boolean).length - Number(Boolean(matchFlags[slot - 1]));
  return {
    room: {
      code,
      slot,
      rematch,
      phase: joinedPlayerCount < room.playerCount ? "waiting" : matched ? "matched" : revealed ? "revealed" : "thinking",
      isPublic: room.isPublic,
      description: room.description,
      playerCount: room.playerCount,
      joinedPlayerCount,
      roundNumber: room.currentRound,
      durationSeconds: room.durationSeconds,
      deadline,
      serverNow: now,
      myWord,
      mySubmitted: Boolean(myWord),
      // Keep these booleans for already-open two-player clients during deployment.
      otherSubmitted: otherSubmittedCount > 0,
      otherSubmittedCount,
      myReady: Boolean(readyFlags[slot - 1]),
      otherReady: otherReadyCount > 0,
      otherReadyCount,
      myMatchVote: Boolean(matchFlags[slot - 1]),
      otherMatchVote: otherMatchVoteCount > 0,
      otherMatchVoteCount,
      submittedCount: words.filter(Boolean).length,
      readyCount: readyFlags.filter(Boolean).length,
      matchVoteCount: matchFlags.filter(Boolean).length,
      matchReason: matched ? (exactMatch ? "exact" : "manual") : null,
      words: revealed ? words.map((word) => word || "（未提交）") : null,
      ...(includeHistory ? { history: historyRounds.map((round) => ({
        number: round.number,
        words: [round.playerOneWord, round.playerTwoWord, round.playerThreeWord]
          .slice(0, room.playerCount)
          .map((word) => word || "（未提交）"),
      })) } : {}),
    },
  } as const;
}
export async function GET(request: Request) {
  let session: GameDbSession | null = null;
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("lobby") === "1") {
      if (!PUBLIC_LOBBY_ENABLED) return fail("随机匹配大厅正在维护，私人房间仍可正常使用。", 503);
      // Lobby listings tolerate brief replica lag and are a read-only hot path.
      session = createDbSession(requestBookmark(request), "first-unconstrained");
      const freshAfter = new Date(Date.now() - 90_000).toISOString();
      const publicRooms = await session.db.select({
        code: rooms.code,
        durationSeconds: rooms.durationSeconds,
        description: rooms.description,
        lastSeenAt: rooms.lastSeenAt,
      }).from(rooms).where(and(
        eq(rooms.isPublic, true),
        eq(rooms.status, "waiting"),
        isNull(rooms.playerTwoToken),
        gt(rooms.lastSeenAt, freshAfter),
      )).orderBy(desc(rooms.lastSeenAt)).limit(50);
      return dbJson(session, { rooms: publicRooms });
    }
    const code = cleanCode(url.searchParams.get("code"));
    const token = String(url.searchParams.get("token") ?? "");
    if (!code || !token) return fail("缺少房间信息。", 400);
    session = createDbSession(requestBookmark(request));
    const knownRoundParam = url.searchParams.get("knownRound");
    const knownRoundValue = knownRoundParam === null ? Number.NaN : Number(knownRoundParam);
    const result = await stateFor(session.db, code, token, {
      compact: url.searchParams.get("compact") === "1",
      knownRound: Number.isInteger(knownRoundValue) ? knownRoundValue : undefined,
      includeHistory: url.searchParams.get("history") === "1",
    });
    if ("error" in result && typeof result.error === "string") return dbFail(session, result.error, result.status ?? 400);
    return dbJson(session, result);
  } catch (error) {
    console.error({ event: "api_request_failed", route: "GET /api/game", ...errorLogDetails(error) });
    return session ? dbFail(session, "服务暂时开小差了，请稍后再试。", 500) : fail("服务暂时开小差了，请稍后再试。", 500);
  }
}

export async function POST(request: Request) {
  let session: GameDbSession | null = null;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (!PUBLIC_LOBBY_ENABLED && (action === "createPublic" || action === "joinPublic")) {
      return fail("随机匹配大厅正在维护，私人房间仍可正常使用。", 503);
    }
    session = createDbSession(requestBookmark(request));
    const db = session.db;

    if (action === "create" || action === "createPublic") {
      const requestedDuration = Number(body.durationSeconds ?? 60);
      if (!Number.isInteger(requestedDuration) || requestedDuration < 10 || requestedDuration > 3600) {
        return fail("每轮时长请设为 10–3600 秒。", 400);
      }
      const isPublic = action === "createPublic";
      const playerCount = isPublic ? 2 : Number(body.playerCount ?? 2);
      if (playerCount !== 2 && playerCount !== 3) return fail("房间人数只能选择 2 人或 3 人。", 400);
      const description = isPublic ? cleanDescription(body.description) : null;
      if (isPublic && !description) return fail("写一句简单的房间介绍吧。", 400);
      const token = crypto.randomUUID();
      const now = new Date().toISOString();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = randomCode();
        try {
          await db.insert(rooms).values({ code, playerOneToken: token, durationSeconds: requestedDuration, playerCount, isPublic, description, lastSeenAt: isPublic ? now : null, createdAt: now, updatedAt: now });
          return dbJson(session, { code, token }, 201);
        } catch (error) {
          if (attempt === 7) throw error;
        }
      }
    }

    const code = cleanCode(body.code);
    if (!code) return fail("请输入 6 位房间码。", 400);
    const room = await db.query.rooms.findFirst({ where: eq(rooms.code, code) });
    if (!room) return dbFail(session, "没有找到这个房间。", 404);
    if (!PUBLIC_LOBBY_ENABLED && room.isPublic && action === "join") {
      return dbFail(session, "随机匹配大厅正在维护，暂时不能加入公开房间。", 503);
    }

    if (action === "join" || action === "joinPublic") {
      const isPublicJoin = action === "joinPublic";
      const existingToken = String(body.token ?? "");
      if (isPublicJoin && existingToken && slotFor(room, existingToken)) {
        return dbJson(session, { code, token: existingToken });
      }
      const freshAfter = new Date(Date.now() - 90_000).toISOString();
      if (isPublicJoin && (!room.isPublic || room.status !== "waiting" || room.playerTwoToken || !room.lastSeenAt || room.lastSeenAt <= freshAfter)) {
        return dbFail(session, "这个房间刚刚关闭或已有人加入，请选另一个房间。", 409);
      }
      if (room.status !== "waiting") return dbFail(session, "房间已经开始或满员啦。", 409);
      const joinedPlayerCount = [room.playerOneToken, room.playerTwoToken, room.playerThreeToken].slice(0, room.playerCount).filter(Boolean).length;
      if (joinedPlayerCount >= room.playerCount) return dbFail(session, "房间已经满员啦。", 409);
      const token = crypto.randomUUID();
      const now = new Date().toISOString();
      const joiningThirdPlayer = Boolean(room.playerTwoToken && room.playerCount === 3 && !room.playerThreeToken);
      const updated = joiningThirdPlayer
        ? await db.update(rooms)
          .set({ playerThreeToken: token, status: "active", updatedAt: now })
          .where(and(
            eq(rooms.code, code),
            eq(rooms.status, "waiting"),
            eq(rooms.playerCount, 3),
            eq(rooms.playerTwoToken, room.playerTwoToken!),
            isNull(rooms.playerThreeToken),
          )).returning()
        : await db.update(rooms)
          .set({ playerTwoToken: token, status: room.playerCount === 2 ? "active" : "waiting", updatedAt: now })
          .where(and(
            eq(rooms.code, code),
            eq(rooms.status, "waiting"),
            eq(rooms.playerCount, room.playerCount),
            isNull(rooms.playerTwoToken),
            ...(isPublicJoin ? [eq(rooms.isPublic, true), gt(rooms.lastSeenAt, freshAfter)] : []),
          )).returning();
      if (!updated.length) return dbFail(session, "刚刚有人抢先加入了这个房间。", 409);
      const gameStarts = room.playerCount === 2 || joiningThirdPlayer;
      if (gameStarts) await db.insert(rounds).values({ roomCode: code, number: 1, startedAt: now }).onConflictDoNothing();
      await notifyRealtimeRoom(code);
      return dbJson(session, { code, token });
    }

    const token = String(body.token ?? "");
    const slot = slotFor(room, token);
    if (!slot) return fail("无权操作这个房间。", 403);
    const current = await db.query.rounds.findFirst({
      where: and(eq(rounds.roomCode, code), eq(rounds.number, room.currentRound)),
    });
    if (!current) return fail("还在等另一位玩家加入。", 409);

    if (action === "submit") {
      if (!PUBLIC_LOBBY_ENABLED && room.isPublic) {
        return dbFail(session, "公开房间正在整改，暂时不能提交新词。私人房间仍可正常游玩。", 503);
      }
      const word = cleanWord(body.word);
      if (!word) return fail("先写下一个词语吧。", 400);
      const deadline = room.durationSeconds > 0 ? new Date(current.startedAt).getTime() + room.durationSeconds * 1000 : null;
      const ownWord = [current.playerOneWord, current.playerTwoWord, current.playerThreeWord][slot - 1];
      const nowMs = Date.now();
      const autoSubmit = body.autoSubmit === true;
      const insideAutoSubmitGrace = autoSubmit && deadline !== null && nowMs >= deadline - 1_500 && nowMs <= deadline + 5_000;
      if ((deadline !== null && nowMs >= deadline && !insideAutoSubmitGrace) || ownWord) {
        return fail("这一轮已经不能修改了。", 409);
      }
      const now = new Date().toISOString();
      await db.update(rounds)
        .set(slot === 1
          ? { playerOneWord: word, playerOneSubmittedAt: now }
          : slot === 2
            ? { playerTwoWord: word, playerTwoSubmittedAt: now }
            : { playerThreeWord: word, playerThreeSubmittedAt: now })
        .where(and(eq(rounds.roomCode, code), eq(rounds.number, room.currentRound)));
    } else if (action === "match") {
      const deadline = room.durationSeconds > 0 ? new Date(current.startedAt).getTime() + room.durationSeconds * 1000 : null;
      const words = [current.playerOneWord, current.playerTwoWord, current.playerThreeWord].slice(0, room.playerCount);
      const revealed = Boolean((words.length === room.playerCount && words.every(Boolean)) || (deadline !== null && Date.now() >= deadline));
      if (!revealed) return fail("还没到揭晓时间。", 409);
      await db.update(rounds)
        .set(slot === 1 ? { playerOneMatch: true } : slot === 2 ? { playerTwoMatch: true } : { playerThreeMatch: true })
        .where(and(eq(rounds.roomCode, code), eq(rounds.number, room.currentRound)));
    } else if (action === "ready") {
      const deadline = room.durationSeconds > 0 ? new Date(current.startedAt).getTime() + room.durationSeconds * 1000 : null;
      const words = [current.playerOneWord, current.playerTwoWord, current.playerThreeWord].slice(0, room.playerCount);
      const revealed = Boolean((words.length === room.playerCount && words.every(Boolean)) || (deadline !== null && Date.now() >= deadline));
      if (!revealed) return fail("还没到揭晓时间。", 409);
      const matchFlags = [current.playerOneMatch, current.playerTwoMatch, current.playerThreeMatch].slice(0, room.playerCount);
      const matched = Boolean(
        (words.length === room.playerCount && words.every(Boolean) && words.every((word) => normalizeWord(word) === normalizeWord(words[0]))) ||
        (matchFlags.length === room.playerCount && matchFlags.every(Boolean)),
      );
      await db.update(rounds)
        .set(slot === 1 ? { playerOneReady: true } : slot === 2 ? { playerTwoReady: true } : { playerThreeReady: true })
        .where(and(eq(rounds.roomCode, code), eq(rounds.number, room.currentRound)));
      const refreshed = await db.query.rounds.findFirst({
        where: and(eq(rounds.roomCode, code), eq(rounds.number, room.currentRound)),
      });
      const everyoneReady = Boolean(refreshed?.playerOneReady && refreshed.playerTwoReady && (room.playerCount !== 3 || refreshed.playerThreeReady));
      if (everyoneReady && !matched) {
        const nextNumber = room.currentRound + 1;
        const now = new Date().toISOString();
        await db.insert(rounds).values({ roomCode: code, number: nextNumber, startedAt: now }).onConflictDoNothing();
        await db.update(rooms).set({ currentRound: nextNumber, updatedAt: now })
          .where(and(eq(rooms.code, code), eq(rooms.currentRound, room.currentRound)));
      }
    } else {
      return fail("未知操作。", 400);
    }

    const knownRoundValue = Number(body.knownRound);
    const result = await stateFor(db, code, token, {
      compact: body.compact === true,
      knownRound: Number.isInteger(knownRoundValue) ? knownRoundValue : undefined,
    });
    if ("error" in result && typeof result.error === "string") return dbFail(session, result.error, result.status ?? 400);
    await notifyRealtimeRoom(code);
    return dbJson(session, result);
  } catch (error) {
    console.error({ event: "api_request_failed", route: "POST /api/game", ...errorLogDetails(error) });
    return session ? dbFail(session, "服务暂时开小差了，请稍后再试。", 500) : fail("服务暂时开小差了，请稍后再试。", 500);
  }
}
