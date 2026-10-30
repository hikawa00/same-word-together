import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { handleGameSocket } from "./game-socket";
import { isRealtimeEnabledForRoom } from "./realtime-config";

export { GameRoom } from "./game-room";

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const url = new URL(request.url);
    if (url.pathname === "/api/game/realtime-config" && request.method === "GET") {
      const code = String(url.searchParams.get("code") ?? "");
      return Response.json(
        { enabled: isRealtimeEnabledForRoom(code, env) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (url.pathname === "/api/game/socket" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return handleGameSocket(request, env);
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};

export default worker;
