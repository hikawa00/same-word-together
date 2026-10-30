declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    GAME_ROOMS?: DurableObjectNamespace;
    GAME_REALTIME_MODE?: string;
    GAME_REALTIME_CANARY_ROOM?: string;
  }
}
