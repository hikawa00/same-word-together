import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { rooms, rounds } from "../../../db/schema";

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

function slotFor(room: typeof rooms.$inferSelect, token: string) {
  if (room.playerOneToken === token) return 1;
  if (room.playerTwoToken === token) return 2;
  if (room.playerThreeToken === token) return 3;
  return 0;
}

async function stateFor(code: string, token: string) {
  const db = getDb();
  const room = await db.query.rooms.findFirst({ where: eq(rooms.code, code) });
  if (!room) return { error: "房间不存在，检查一下房间码吧。", status: 404 } as const;
  const slot = slotFor(room, token);
  if (!slot) return { error: "房间已满，或当前设备尚未加入。", status: 403 } as const;

  const now = Date.now();
  const lastSeenAt = room.lastSeenAt ? Date.parse(room.lastSeenAt) : 0;
  if (room.isPublic && slot === 1 && room.status === "waiting" && now - lastSeenAt >= 30_000) {
    await db.update(rooms).set({ lastSeenAt: new Date(now).toISOString() })
      .where(and(eq(rooms.code, code), eq(rooms.playerOneToken, token), eq(rooms.isPublic, true), eq(rooms.status, "waiting"), isNull(rooms.playerTwoToken)));
  }

  const allRounds = await db.select().from(rounds).where(eq(rounds.roomCode, code)).orderBy(asc(rounds.number));
  const current = allRounds.find((round) => round.number === room.currentRound) ?? null;
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
  const joinedPlayerCount = [room.playerOneToken, room.playerTwoToken, room.playerThreeToken].slice(0, room.playerCount).filter(Boolean).length;
  const myWord = words[slot - 1] ?? null;
  const otherSubmittedCount = words.filter(Boolean).length - Number(Boolean(myWord));
  const otherReadyCount = readyFlags.filter(Boolean).length - Number(Boolean(readyFlags[slot - 1]));
  const otherMatchVoteCount = matchFlags.filter(Boolean).length - Number(Boolean(matchFlags[slot - 1]));

  return {
    room: {
      code,
      slot,
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
      history: allRounds.filter((round) => round.number < room.currentRound).map((round) => ({
        number: round.number,
        words: [round.playerOneWord, round.playerTwoWord, round.playerThreeWord].slice(0, room.playerCount).map((word) => word || "（未提交）"),
      })),
    },
  } as const;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("lobby") === "1") {
      const freshAfter = new Date(Date.now() - 90_000).toISOString();
      const publicRooms = await getDb().select({
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
      return Response.json({ rooms: publicRooms }, { headers: { "Cache-Control": "no-store" } });
    }
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

    if (action === "join" || action === "joinPublic") {
      const isPublicJoin = action === "joinPublic";
      const existingToken = String(body.token ?? "");
      if (isPublicJoin && existingToken && slotFor(room, existingToken)) {
        return Response.json({ code, token: existingToken });
      }
      const freshAfter = new Date(Date.now() - 90_000).toISOString();
      if (isPublicJoin && (!room.isPublic || room.status !== "waiting" || room.playerTwoToken || !room.lastSeenAt || room.lastSeenAt <= freshAfter)) {
        return fail("这个房间刚刚关闭或已有人加入，请选另一个房间。", 409);
      }
      if (room.status !== "waiting") return fail("房间已经开始或满员啦。", 409);
      const joinedPlayerCount = [room.playerOneToken, room.playerTwoToken, room.playerThreeToken].slice(0, room.playerCount).filter(Boolean).length;
      if (joinedPlayerCount >= room.playerCount) return fail("房间已经满员啦。", 409);
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
      if (!updated.length) return fail("刚刚有人抢先加入了这个房间。", 409);
      const gameStarts = room.playerCount === 2 || joiningThirdPlayer;
      if (gameStarts) await db.insert(rounds).values({ roomCode: code, number: 1, startedAt: now }).onConflictDoNothing();
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
      if (matched) return fail("已经成功想到同一个词啦！", 409);
      await db.update(rounds)
        .set(slot === 1 ? { playerOneReady: true } : slot === 2 ? { playerTwoReady: true } : { playerThreeReady: true })
        .where(and(eq(rounds.roomCode, code), eq(rounds.number, room.currentRound)));
      const refreshed = await db.query.rounds.findFirst({
        where: and(eq(rounds.roomCode, code), eq(rounds.number, room.currentRound)),
      });
      if (refreshed?.playerOneReady && refreshed.playerTwoReady && (room.playerCount !== 3 || refreshed.playerThreeReady)) {
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
