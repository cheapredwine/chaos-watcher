import { Agent } from "agents";
import type { PushPayload } from "./adapters";
import type { Env } from "./env";
import { AGENT_NAME, agentTask } from "./config";
import { getAdapters } from "./adapters";
import {
  normalizeSnapshot,
  runAgentWatcher,
  runScriptWatcher,
  type TraceEntry,
} from "./watchers";

/**
 * The WatcherAgent — one Durable Object instance ("chaos-demo") that owns:
 * the chaos flag, the run journal, the findings memory (fingerprint-deduped),
 * the push subscriptions, and the hourly alarm. Both watchers execute here.
 */
export interface WatcherState {
  chaosVersion: number;
  alarmConfigured: boolean;
}

export interface RunRow {
  id: number;
  mode: string;
  chaos_version: number;
  started_at: string;
  finished_at: string | null;
  ok: number | null;
  summary: string | null;
  trace: string | null;
}

export interface FindingRow {
  id: number;
  run_id: number | null;
  created_at: string;
  text: string;
  fingerprint: string;
}

export interface AgentInfo {
  chaosVersion: number;
  alarmConfigured: boolean;
  runCount: number;
  findingCount: number;
  subscriptionCount: number;
}

export class WatcherAgent extends Agent<Env, WatcherState> {
  initialState: WatcherState = { chaosVersion: 1, alarmConfigured: false };

  async onStart(): Promise<void> {
    this.query`CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      chaos_version INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      ok INTEGER,
      summary TEXT,
      trace TEXT
    )`;
    this.query`CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      created_at TEXT NOT NULL,
      text TEXT NOT NULL,
      fingerprint TEXT UNIQUE NOT NULL
    )`;
    this.query`CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`;
    this.query`CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT UNIQUE NOT NULL,
      keys TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`;

    // Proactive behavior: the agent wakes itself every hour. Once.
    if (!this.state.alarmConfigured) {
      try {
        await this.schedule("0 * * * *", "scheduledTick", {});
        this.setState({ ...this.state, alarmConfigured: true });
      } catch (err) {
        console.warn("could not schedule hourly tick:", err);
      }
    }
  }

  // ---- chaos flag -------------------------------------------------------

  getChaosVersion(): number {
    return this.state.chaosVersion;
  }

  setChaosVersion(v: number): number {
    if (!Number.isInteger(v) || v < 1 || v > 4) {
      throw new Error("chaos version must be an integer 1-4");
    }
    this.setState({ ...this.state, chaosVersion: v });
    return v;
  }

  cycleChaos(): number {
    return this.setChaosVersion((this.state.chaosVersion % 4) + 1);
  }

  // ---- runs -------------------------------------------------------------

  async runNow(mode: "script" | "agent"): Promise<{ runId: number; ok: boolean; summary: string }> {
    const runId = this.insertRun(mode);
    const result = await this.executeRun(mode, runId);
    return { runId, ok: result.ok, summary: result.summary };
  }

  listRuns(limit = 20): RunRow[] {
    return this.query<RunRow>`SELECT id, mode, chaos_version, started_at, finished_at, ok, summary
      FROM runs ORDER BY id DESC LIMIT ${limit}`;
  }

  getRun(id: number): RunRow | null {
    const rows = this.query<RunRow>`SELECT * FROM runs WHERE id = ${id}`;
    return rows.length > 0 ? rows[0] : null;
  }

  listFindings(limit = 20): FindingRow[] {
    return this.query<FindingRow>`SELECT id, run_id, created_at, text, fingerprint
      FROM findings ORDER BY id DESC LIMIT ${limit}`;
  }

  getInfo(): AgentInfo {
    const counts = this.query<{ runs: number; findings: number; subscriptions: number }>`
      SELECT
        (SELECT COUNT(*) FROM runs) AS runs,
        (SELECT COUNT(*) FROM findings) AS findings,
        (SELECT COUNT(*) FROM subscriptions) AS subscriptions`;
    return {
      chaosVersion: this.state.chaosVersion,
      alarmConfigured: this.state.alarmConfigured,
      runCount: Number(counts[0]?.runs ?? 0),
      findingCount: Number(counts[0]?.findings ?? 0),
      subscriptionCount: Number(counts[0]?.subscriptions ?? 0),
    };
  }

  async resetJournal(): Promise<void> {
    this.query`DELETE FROM runs`;
    this.query`DELETE FROM findings`;
    this.query`DELETE FROM snapshots`;
  }

  // ---- push subscriptions -------------------------------------------------

  addSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): { ok: boolean } {
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      throw new Error("subscription requires endpoint and keys.p256dh/keys.auth");
    }
    const keysJson = JSON.stringify(sub.keys);
    this.query`INSERT INTO subscriptions (endpoint, keys, created_at)
      VALUES (${sub.endpoint}, ${keysJson}, ${new Date().toISOString()})
      ON CONFLICT(endpoint) DO UPDATE SET keys = ${keysJson}`;
    return { ok: true };
  }

  async pushTest(): Promise<{ ok: boolean; subscriptions: number }> {
    const subs = this.query<{ id: number }>`SELECT id FROM subscriptions`;
    await this.pushToSubscribers({
      title: "Chaos Watcher",
      body: "Test notification — the agent can reach you.",
      url: "/journal",
    });
    return { ok: true, subscriptions: subs.length };
  }

  // ---- the hourly alarm ---------------------------------------------------

  async scheduledTick(): Promise<void> {
    await this.runNow("agent");
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Central SQL helper. The agents SDK exposes `this.sql` as a tagged
   * template; rows come back as plain objects.
   */
  private query<T = Record<string, unknown>>(
    parts: TemplateStringsArray,
    ...values: unknown[]
  ): T[] {
    return (this.sql as unknown as (p: TemplateStringsArray, ...v: unknown[]) => unknown)(
      parts,
      ...values,
    ) as T[];
  }

  private insertRun(mode: string): number {
    this.query`INSERT INTO runs (mode, chaos_version, started_at)
      VALUES (${mode}, ${this.state.chaosVersion}, ${new Date().toISOString()})`;
    const rows = this.query<{ id: number }>`SELECT id FROM runs ORDER BY id DESC LIMIT 1`;
    return Number(rows[0].id);
  }

  private async executeRun(mode: "script" | "agent", runId: number): Promise<{ ok: boolean; summary: string }> {
    const adapters = getAdapters(this.env);
    const trace: TraceEntry[] = [];
    let ok = true;
    let summary = "";
    let significantText: string | null = null;

    try {
      if (mode === "script") {
        const last = this.lastSnapshot("script");
        const r = await runScriptWatcher(adapters.pageFetcher, last);
        this.saveSnapshot("script", r.snapshot);
        summary = r.changed
          ? `Changed: ${r.output.headline} — ${r.output.detail}` +
            (r.output.pricing ? ` (${r.output.pricing})` : "")
          : "No changes since last snapshot";
        if (r.changed) {
          significantText = `Script watcher: ${r.output.headline} — ${r.output.detail}`;
        }
      } else {
        const r = await runAgentWatcher({
          model: adapters.model,
          browser: adapters.browser,
          task: agentTask(this.env),
          memorySummary: this.memorySummary(),
          maxSteps: 6,
          onTrace: (e) => trace.push(e),
        });
        summary = r.report;
        if (r.report.startsWith("SIGNIFICANT:")) {
          significantText = `Agent watcher: ${r.report.slice("SIGNIFICANT:".length).trim()}`;
        }
      }
    } catch (err) {
      ok = false;
      summary = `Failed: ${(err as Error).message}`;
    }

    this.query`UPDATE runs SET finished_at = ${new Date().toISOString()}, ok = ${ok ? 1 : 0},
      summary = ${summary}, trace = ${JSON.stringify(trace)} WHERE id = ${runId}`;

    // New significant findings — and failures — reach the user via push.
    // Fingerprints dedupe repeated identical messages.
    if (significantText) await this.recordFinding(significantText, runId);
    else if (!ok) await this.recordFinding(`Failure (${mode}): ${summary}`, runId);

    return { ok, summary };
  }

  /** Dedupe by fingerprint; push only when the finding is genuinely new. */
  private async recordFinding(text: string, runId: number | null): Promise<boolean> {
    const fp = await this.fingerprint(text);
    const existing = this.query<{ id: number }>`SELECT id FROM findings WHERE fingerprint = ${fp}`;
    if (existing.length > 0) return false;
    this.query`INSERT INTO findings (run_id, created_at, text, fingerprint)
      VALUES (${runId}, ${new Date().toISOString()}, ${text}, ${fp})`;
    await this.pushToSubscribers({
      title: "Chaos Watcher",
      body: text.length > 180 ? `${text.slice(0, 177)}...` : text,
      url: "/journal",
    });
    return true;
  }

  private async fingerprint(text: string): Promise<string> {
    const data = new TextEncoder().encode(normalizeSnapshot(text));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  private async pushToSubscribers(payload: PushPayload): Promise<void> {
    const subs = this.query<{ id: number; endpoint: string; keys: string }>`
      SELECT id, endpoint, keys FROM subscriptions`;
    if (subs.length === 0) return;
    const sender = getAdapters(this.env).push;
    const dead: number[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          const keys = JSON.parse(s.keys) as { p256dh: string; auth: string };
          await sender.send({ endpoint: s.endpoint, keys }, payload);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) dead.push(s.id);
          else console.warn(`push failed for ${s.endpoint}:`, (err as Error).message);
        }
      }),
    );
    for (const id of dead) this.query`DELETE FROM subscriptions WHERE id = ${id}`;
  }

  private memorySummary(): string {
    const rows = this.query<{ text: string }>`SELECT text FROM findings ORDER BY id DESC LIMIT 5`;
    if (rows.length === 0) return "(none yet — this is your first check)";
    return rows.map((r, i) => `${i + 1}. ${r.text}`).join("\n");
  }

  private lastSnapshot(mode: string): string | null {
    const rows = this.query<{ snapshot: string }>`
      SELECT snapshot FROM snapshots WHERE mode = ${mode} ORDER BY id DESC LIMIT 1`;
    return rows.length > 0 ? rows[0].snapshot : null;
  }

  private saveSnapshot(mode: string, snapshot: string): void {
    this.query`INSERT INTO snapshots (mode, snapshot, created_at)
      VALUES (${mode}, ${snapshot}, ${new Date().toISOString()})`;
  }
}

export { AGENT_NAME };
