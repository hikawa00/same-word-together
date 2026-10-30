import { isRealtimeEnabledForRoom } from "./realtime-config";

export async function handleGameSocket(request: Request, env: Cloudflare.Env) {
  const namespace = env.GAME_ROOMS;
  const database = env.DB;
  if (!namespace || !database) {
    return Response.json({ error: "本地实时原型未启用。" }, { status: 404 });
  }

  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") ?? "")
    .trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const token = url.searchParams.get("token") ?? "";
  if (!code || !token || token.length > 128) {
    return Response.json({ error: "缺少房间验证信息。" }, { status: 400 });
  }
  if (!isRealtimeEnabledForRoom(code, env)) {
    return Response.json({ error: "实时连接尚未启用。" }, { status: 404 });
  }

  try {
    const membership = await database.prepare(
      `SELECT 1 AS authorized FROM rooms
       WHERE code = ? AND (player_one_token = ? OR player_two_token = ? OR player_three_token = ?)
       LIMIT 1`,
    ).bind(code, token, token, token).first<{ authorized: number }>();
    if (!membership) return Response.json({ error: "无权连接这个房间。" }, { status: 403 });

    const id = namespace.idFromName(code);
    const room = namespace.get(id);
    return room.fetch("https://game-room/socket", {
      method: "GET",
      headers: request.headers,
    });
  } catch (error) {
    console.error({ event: "game_room_socket_failed", errorName: error instanceof Error ? error.name : "Error" });
    return Response.json({ error: "实时连接暂时不可用。" }, { status: 503 });
  }
}
