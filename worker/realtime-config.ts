type RealtimeEnvironment = {
  GAME_REALTIME_MODE?: string;
  GAME_REALTIME_CANARY_ROOM?: string;
};

function cleanRoomCode(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function isRealtimeEnabledForRoom(code: string, env: RealtimeEnvironment) {
  const mode = env.GAME_REALTIME_MODE ?? "off";
  if (mode === "on") return true;
  if (mode !== "canary") return false;
  const canaryRoom = cleanRoomCode(env.GAME_REALTIME_CANARY_ROOM);
  return Boolean(canaryRoom && cleanRoomCode(code) === canaryRoom);
}
