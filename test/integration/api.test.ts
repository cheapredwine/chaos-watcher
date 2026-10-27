import { beforeEach, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { __resetTestAdapters } from "../../src/adapters";
import { FACTS } from "../../src/chaosco";
import { AGENT_SCRIPTS, scriptedModel, setAdapters } from "../helpers";

// Integration tests drive the real Worker routes (SELF), which exercise the
// real Durable Object, its SQLite journal, and the adapter seams.

interface RunSummary {
  runId: number;
  ok: boolean;
  summary: string;
}
interface StateResponse {
  chaosVersion: number;
  alarmConfigured: boolean;
  runCount: number;
  findingCount: number;
  subscriptionCount: number;
  vapidConfigured: boolean;
  runs: { id: number; mode: string; ok: number | null; summary: string | null; chaos_version: number }[];
  findings: { id: number; text: string }[];
}
interface RunDetail {
  trace: string | null;
}
interface ChaosResponse {
  chaosVersion: number;
}

async function jbody<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`jbody: status=${res.status} body=${text || "(empty)"}`);
  }
}

beforeEach(async () => {
  __resetTestAdapters();
  await SELF.fetch("https://self.test/api/reset", { method: "POST" });
});

async function state(): Promise<StateResponse> {
  const res = await SELF.fetch("https://self.test/api/state");
  expect(res.status).toBe(200);
  return jbody<StateResponse>(res);
}

it("round-trips the chaos flag", async () => {
  setAdapters(1);
  const set = await SELF.fetch("https://self.test/api/chaos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 3 }),
  });
  expect((await jbody<ChaosResponse>(set)).chaosVersion).toBe(3);
  expect((await state()).chaosVersion).toBe(3);

  const cycle = await SELF.fetch("https://self.test/api/chaos", { method: "POST" });
  expect((await jbody<ChaosResponse>(cycle)).chaosVersion).toBe(4);
  const cycle2 = await SELF.fetch("https://self.test/api/chaos", { method: "POST" });
  expect((await jbody<ChaosResponse>(cycle2)).chaosVersion).toBe(1);
});

it("rejects invalid chaos versions", async () => {
  setAdapters(1);
  const res = await SELF.fetch("https://self.test/api/chaos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 7 }),
  });
  expect(res.status).toBe(500);
  expect((await jbody<{ error: string }>(res)).error).toContain("1-4");
});

it("serves ChaosCo from the active variant", async () => {
  setAdapters(1);
  await SELF.fetch("https://self.test/api/chaos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 3 }),
  });
  const home = await (await SELF.fetch("https://self.test/")).text();
  expect(home).toContain("internal build v3");
  expect(home).toContain('href="/details"');
  const details = await (await SELF.fetch("https://self.test/details")).text();
  expect(details).toContain(FACTS.headline);
});

it("records a successful script run, then a no-change run", async () => {
  setAdapters(1);
  const first = await jbody<RunSummary>(
    await SELF.fetch("https://self.test/api/run/script", { method: "POST" }),
  );
  expect(first.ok).toBe(true);
  expect(first.summary).toContain(FACTS.headline);

  let s = await state();
  expect(s.findingCount).toBe(1);

  const second = await jbody<RunSummary>(
    await SELF.fetch("https://self.test/api/run/script", { method: "POST" }),
  );
  expect(second.ok).toBe(true);
  expect(second.summary).toBe("No changes since last snapshot");
  s = await state();
  expect(s.findingCount).toBe(1); // deduped
  expect(s.runCount).toBe(2);
});

it("records a script failure on v2 and pushes the failure", async () => {
  const { sent } = setAdapters(2);
  // Register a subscriber so the failure notification has somewhere to go.
  await SELF.fetch("https://self.test/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: "https://push.example/endpoint-1",
      keys: { p256dh: "k1", auth: "a1" },
    }),
  });
  const run = await jbody<RunSummary>(
    await SELF.fetch("https://self.test/api/run/script", { method: "POST" }),
  );
  expect(run.ok).toBe(false);
  expect(run.summary).toContain("selector .announcement-headline not found");

  const s = await state();
  expect(s.runCount).toBe(1);
  expect(s.findingCount).toBe(1); // the failure is recorded as a finding
  expect(s.findings[0].text).toContain("Failure (script)");
  expect(sent.length).toBe(1); // ...and pushed
});

it("runs the agent end-to-end with a scripted model and dedupes findings", async () => {
  const { sent } = setAdapters(1, scriptedModel(AGENT_SCRIPTS[1]));
  // Register a subscriber so finding notifications are observable.
  await SELF.fetch("https://self.test/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: "https://push.example/endpoint-1",
      keys: { p256dh: "k1", auth: "a1" },
    }),
  });

  const run = await jbody<RunSummary>(
    await SELF.fetch("https://self.test/api/run/agent", { method: "POST" }),
  );
  expect(run.ok).toBe(true);
  expect(run.summary.startsWith("SIGNIFICANT:")).toBe(true);

  const detail = await jbody<RunDetail>(
    await SELF.fetch(`https://self.test/api/runs/${run.runId}`),
  );
  const trace = JSON.parse(detail.trace ?? "[]");
  expect(trace.length).toBe(2);
  expect(trace[0].kind).toBe("tool");
  expect(trace[1].kind).toBe("final");

  let s = await state();
  expect(s.findingCount).toBe(1);
  expect(s.findings[0].text).toContain("Agent watcher:");
  expect(sent.length).toBe(1);

  // Same observation again → same fingerprint → no new finding, no push.
  const second = await jbody<RunSummary>(
    await SELF.fetch("https://self.test/api/run/agent", { method: "POST" }),
  );
  expect(second.ok).toBe(true);
  s = await state();
  expect(s.findingCount).toBe(1);
  expect(s.runCount).toBe(2);
  expect(sent.length).toBe(1);
});

it("fails an agent run gracefully when the model plan is exhausted", async () => {
  // A model that never finishes: every decision is another browse call.
  const endlessModel = {
    decide: async () => ({ kind: "tool", name: "browse", args: { url: "https://self.test/" } }),
  };
  setAdapters(3, endlessModel as never);
  const run = await jbody<RunSummary>(
    await SELF.fetch("https://self.test/api/run/agent", { method: "POST" }),
  );
  expect(run.ok).toBe(false);
  expect(run.summary).toContain("exceeded step budget");

  const detail = await jbody<RunDetail>(
    await SELF.fetch(`https://self.test/api/runs/${run.runId}`),
  );
  const trace = JSON.parse(detail.trace ?? "[]");
  expect(trace.length).toBeGreaterThan(0); // partial trace survived the failure
});

it("arms the hourly alarm on first contact", async () => {
  setAdapters(1);
  expect((await state()).alarmConfigured).toBe(true);
});

it("returns 503 for the push public key when VAPID is unconfigured", async () => {
  setAdapters(1);
  const res = await SELF.fetch("https://self.test/api/push/public-key");
  expect(res.status).toBe(503);
  expect((await jbody<{ error: string }>(res)).error).toContain("VAPID_PUBLIC_KEY");
});

it("stores push subscriptions and reports them in state", async () => {
  setAdapters(1);
  const res = await SELF.fetch("https://self.test/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: "https://push.example/endpoint-1",
      keys: { p256dh: "k1", auth: "a1" },
    }),
  });
  expect((await jbody<{ ok: boolean }>(res)).ok).toBe(true);
  const s = await state();
  expect(s.subscriptionCount).toBe(1);
});

it("404s unknown routes", async () => {
  const res = await SELF.fetch("https://self.test/api/nope");
  expect(res.status).toBe(404);
});
