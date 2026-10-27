import type { Env } from "./env";
import { MODEL_ID } from "./config";
import { createPushSender } from "./push";

// ---------------------------------------------------------------------------
// The seams. Everything environment-specific (Workers AI, Browser Rendering,
// web-push, self-fetch) sits behind these interfaces. Tests inject fixture
// implementations via __setTestAdapters; production always uses the real ones.
// See AGENTS.md ("The seams") before changing this contract.
// ---------------------------------------------------------------------------

export interface PageFetcher {
  /** Returns rendered HTML for a site path, e.g. "/" or "/details". */
  fetch(path: string): Promise<string>;
}

export interface BrowseResult {
  url: string;
  title: string;
  /** Visible page text, truncated. */
  text: string;
  links: { text: string; href: string }[];
}

export interface BrowserAdapter {
  browse(url: string): Promise<BrowseResult>;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** One decision from the model: call a tool, or finish with a report. */
export type ModelStep =
  | { kind: "tool"; name: string; args: Record<string, unknown> }
  | { kind: "final"; report: string };

export interface ModelInput {
  system: string;
  messages: { role: "user" | "assistant" | "system" | "tool"; content: string }[];
  tools: ToolSpec[];
}

export interface ModelAdapter {
  decide(input: ModelInput): Promise<ModelStep>;
}

export interface PushSubRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export interface PushSender {
  send(sub: PushSubRecord, payload: PushPayload): Promise<void>;
}

export interface Adapters {
  pageFetcher: PageFetcher;
  browser: BrowserAdapter;
  model: ModelAdapter;
  push: PushSender;
}

// Test override registry.
let overrides: Partial<Adapters> | null = null;

/** TESTS ONLY — inject fixture adapters. */
export function __setTestAdapters(o: Partial<Adapters>): void {
  overrides = o;
}

/** TESTS ONLY — restore production adapters. */
export function __resetTestAdapters(): void {
  overrides = null;
}

export function getAdapters(env: Env): Adapters {
  const prod = prodAdapters(env);
  return overrides ? { ...prod, ...overrides } : prod;
}

function prodAdapters(env: Env): Adapters {
  return {
    pageFetcher: createSelfFetcher(env),
    browser: createPuppeteerBrowser(env),
    model: createWorkersAIModel(env),
    push: createPushSenderFromEnv(env),
  };
}

/** Prod: the script watcher fetches ChaosCo over HTTP like any client would. */
function createSelfFetcher(env: Env): PageFetcher {
  return {
    async fetch(path: string): Promise<string> {
      const res = await fetch(`${env.SITE_ORIGIN}${path}`, { redirect: "follow" });
      if (!res.ok) throw new Error(`fetch ${path} -> HTTP ${res.status}`);
      return res.text();
    },
  };
}

/**
 * Prod: the agent's eyes — Browser Rendering (headless Chromium at the edge).
 * Lazy-imported so test modules never load puppeteer.
 */
function createPuppeteerBrowser(env: Env): BrowserAdapter {
  return {
    async browse(url: string): Promise<BrowseResult> {
      const puppeteer = (await import("@cloudflare/puppeteer")).default;
      const browser = await puppeteer.launch(env.BROWSER as never);
      try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "load" });
        const title = await page.title();
        const rawText = await page.$eval("body", (el) => el.textContent);
        const text = (rawText ?? "").replace(/\s+/g, " ").trim().slice(0, 4000);
        const rawLinks = await page.$$eval("a", (as) =>
          as.map((a) => ({ text: (a.textContent ?? "").trim(), href: a.href })),
        );
        const links = rawLinks.filter((l) => !!l.href);
        return { url, title, text, links };
      } finally {
        await browser.close();
      }
    },
  };
}

/**
 * Prod: the agent's brain — Workers AI function calling (non-streaming).
 * Maps the raw AI.run response to a ModelStep.
 */
function createWorkersAIModel(env: Env): ModelAdapter {
  return {
    async decide(input) {
      const ai = env.AI as unknown as {
        run(model: string, input: unknown): Promise<unknown>;
      };
      const res = (await ai.run(MODEL_ID, {
        messages: [{ role: "system", content: input.system }, ...input.messages],
        tools: input.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        max_tokens: 800,
        temperature: 0.2,
      })) as {
        response?: string;
        tool_calls?: Array<{
          name?: string;
          function?: { name: string; arguments?: string };
        }>;
      };

      const calls = res.tool_calls ?? [];
      if (calls.length > 0) {
        const c = calls[0];
        const fn = c.function ?? { name: c.name ?? "", arguments: undefined };
        let args: Record<string, unknown> = {};
        const raw = fn.arguments;
        if (typeof raw === "string") {
          try {
            args = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            args = {};
          }
        } else if (raw && typeof raw === "object") {
          args = raw as Record<string, unknown>;
        }
        return { kind: "tool", name: fn.name, args };
      }
      return { kind: "final", report: String(res.response ?? "") };
    },
  };
}

function createPushSenderFromEnv(env: Env): PushSender {
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = env;
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return {
      async send() {
        throw new Error("push not configured: set VAPID_* secrets (docs/runbook.md)");
      },
    };
  }
  return createPushSender({
    subject: VAPID_SUBJECT,
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
  });
}
