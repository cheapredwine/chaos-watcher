import { getAgentByName } from "agents";
import type { Env } from "./env";
import { WatcherAgent } from "./agent";
import { AGENT_NAME } from "./config";
import { isChaosVersion, renderChaosCo, renderDetails, type ChaosVersion } from "./chaosco";

// The Durable Object class must be exported for the DO binding to work.
export { WatcherAgent };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Defense in depth: the real gate is the edge-level Access application
    // (docs/runbook.md). ChaosCo itself ("/", "/details") stays public so the
    // script's self-fetch and the agent's browser session are never challenged.
    const requireAccess: string = env.REQUIRE_ACCESS;
    if (requireAccess === "true" && (path === "/journal" || path.startsWith("/api"))) {
      if (!request.headers.get("Cf-Access-Jwt-Assertion")) {
        return json(
          { error: "missing Cloudflare Access JWT — configure Access per docs/runbook.md" },
          401,
        );
      }
    }

    const agent = (await getAgentByName(env.WATCHER, AGENT_NAME)) as unknown as WatcherAgent;

    const chaosVersion = async (): Promise<ChaosVersion> => {
      const n = await agent.getChaosVersion();
      return isChaosVersion(n) ? n : 1;
    };

    try {
      if (request.method === "GET") {
        if (path === "/") return html(renderChaosCo(await chaosVersion()));
        if (path === "/details") return html(renderDetails(await chaosVersion()));
        if (path === "/journal") return await asset(env, "/journal.html");
        if (path === "/sw.js") return await asset(env, "/sw.js");

        if (path === "/api/state") {
          return json({
            ...(await agent.getInfo()),
            vapidConfigured: Boolean(env.VAPID_PUBLIC_KEY),
            runs: await agent.listRuns(20),
            findings: await agent.listFindings(10),
          });
        }
        if (path === "/api/runs") return json(await agent.listRuns(50));
        if (path.startsWith("/api/runs/")) {
          const id = Number(path.split("/")[3]);
          const run = Number.isInteger(id) ? await agent.getRun(id) : null;
          return run ? json(run) : json({ error: `run ${id} not found` }, 404);
        }
        if (path === "/api/findings") return json(await agent.listFindings(50));
        if (path === "/api/push/public-key") {
          return env.VAPID_PUBLIC_KEY
            ? json({ publicKey: env.VAPID_PUBLIC_KEY })
            : json({ error: "VAPID_PUBLIC_KEY not configured (docs/runbook.md)" }, 503);
        }
      }

      if (request.method === "POST") {
        if (path === "/api/chaos") {
          const body = await readJson(request);
          const v =
            body.version != null
              ? await agent.setChaosVersion(Number(body.version))
              : await agent.cycleChaos();
          return json({ chaosVersion: v });
        }
        if (path === "/api/run/script") return json(await agent.runNow("script"));
        if (path === "/api/run/agent") return json(await agent.runNow("agent"));
        if (path === "/api/push/subscribe") {
          const body = (await readJson(request)) as {
            endpoint?: string;
            keys?: { p256dh?: string; auth?: string };
          };
          return json(
            await agent.addSubscription({
              endpoint: String(body.endpoint ?? ""),
              keys: {
                p256dh: String(body.keys?.p256dh ?? ""),
                auth: String(body.keys?.auth ?? ""),
              },
            }),
          );
        }
        if (path === "/api/push/test") return json(await agent.pushTest());
        if (path === "/api/reset") {
          await agent.resetJournal();
          return json({ ok: true });
        }
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function html(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function asset(env: Env, p: string): Promise<Response> {
  return env.ASSETS.fetch(new Request(`https://assets.local${p}`));
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
