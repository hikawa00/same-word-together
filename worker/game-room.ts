import { DurableObject } from "cloudflare:workers";

/**
 * Realtime transport: keep game state in D1 and use one
 * hibernatable WebSocket per room to tell connected players when to refresh.
 */
export class GameRoom extends DurableObject<Cloudflare.Env> {
  async fetch(request: Request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname.endsWith("/notify")) {
      const message = JSON.stringify({ type: "changed" });
      let delivered = 0;
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(message);
          delivered += 1;
        } catch {
          // A stale socket should not make the game action fail.
        }
      }
      return Response.json({ delivered });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, ["game"]);
    server.send(JSON.stringify({ type: "connected" }));

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage() {
    // The prototype is server-push only. No client messages are needed.
  }

  webSocketClose() {
    // Hibernation keeps the room object idle when nobody is connected.
  }

  webSocketError() {
    // The browser reconnects and continues with the existing D1 fallback.
  }
}
