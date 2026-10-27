import type { BrowserAdapter, ModelAdapter, PageFetcher, ToolSpec } from "./adapters";

// ---------------------------------------------------------------------------
// The two watchers. The script watcher is an honest, enumerated baseline —
// a developer wrote every step. The agent watcher provides a goal and tools;
// the model writes the control flow at runtime.
// ---------------------------------------------------------------------------

// ---------- Script watcher (the fair, enumerated baseline) ----------

export class ScriptFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptFailure";
  }
}

export interface ScriptOutput {
  headline: string;
  detail: string;
  pricing: string | null;
}

export interface ScriptRunResult {
  output: ScriptOutput;
  snapshot: string;
  changed: boolean;
}

function extractByClass(html: string, cls: string): string | null {
  const re = new RegExp(`class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<`, "i");
  const m = html.match(re);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

export function normalizeSnapshot(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The obvious script: fetch the homepage, pull the fields it was built
 * against (v1 CSS classes), diff against the last snapshot.
 * It breaks — honestly — the moment the site stops matching (v2/v3/v4).
 */
export async function runScriptWatcher(
  fetcher: PageFetcher,
  lastSnapshot: string | null,
): Promise<ScriptRunResult> {
  const html = await fetcher.fetch("/"); // the obvious script fetches the homepage, and only the homepage
  const headline = extractByClass(html, "announcement-headline");
  if (!headline) {
    throw new ScriptFailure("selector .announcement-headline not found on homepage");
  }
  const detail = extractByClass(html, "announcement-detail");
  if (!detail) {
    throw new ScriptFailure("selector .announcement-detail not found on homepage");
  }
  const output: ScriptOutput = {
    headline,
    detail,
    pricing: extractByClass(html, "pricing-note"),
  };
  const snapshot = normalizeSnapshot(`${headline} ${detail}`);
  return { output, snapshot, changed: lastSnapshot !== snapshot };
}

// ---------- Agent watcher (goal + tools; the model decides the steps) ----------

export const AGENT_TOOLS: ToolSpec[] = [
  {
    name: "browse",
    description:
      "Fetch a URL and return its page title, visible text (truncated), and outbound links. " +
      "Use it to read ChaosCo's pages, including any page a link points to.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute URL to fetch" } },
      required: ["url"],
    },
  },
];

export interface TraceEntry {
  n: number;
  kind: "tool" | "final" | "error";
  name?: string;
  args?: unknown;
  ok: boolean;
  preview?: string;
  error?: string;
  ms: number;
}

export interface AgentRunResult {
  report: string;
  trace: TraceEntry[];
  steps: number;
}

export interface AgentLoopDeps {
  model: ModelAdapter;
  browser: BrowserAdapter;
  task: string;
  memorySummary: string;
  maxSteps: number;
  /** Called for every trace entry as it happens, so partial traces survive errors. */
  onTrace?: (entry: TraceEntry) => void;
}

export function agentSystemPrompt(input: { task: string; memorySummary: string; tools: ToolSpec[] }): string {
  const toolLines = input.tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");
  return [
    "You are Chaos Watcher, an autonomous watcher of a company website.",
    "",
    `Your goal: ${input.task}`,
    "",
    "Tools available:",
    toolLines,
    "",
    "Your memory of previous findings (do NOT re-report something already in this list unless it has changed):",
    input.memorySummary,
    "",
    "Rules:",
    "- Investigate the site however you see fit. If the homepage only teases content, follow its links.",
    "- Judge for yourself what is worth reporting.",
    "- When you are done, reply with your final report (no tool call). The FIRST LINE of the report must be exactly one of:",
    '  "SIGNIFICANT: <what changed and why it matters>"',
    '  "NO CHANGE: <why nothing is worth reporting>"',
  ].join("\n");
}

function preview(s: string, n = 160): string {
  return s.replace(/\s+/g, " ").trim().slice(0, n);
}

/**
 * The agent loop. The ONLY structure here is: ask the model, do what it
 * chose, show it the result, repeat until it finishes or the budget runs out.
 * Which tools get called, in what order, and when to stop — those are the
 * model's decisions, not ours.
 */
export async function runAgentWatcher(deps: AgentLoopDeps): Promise<AgentRunResult> {
  const trace: TraceEntry[] = [];
  const emit = (entry: TraceEntry) => {
    trace.push(entry);
    deps.onTrace?.(entry);
  };
  const messages: { role: "user" | "assistant" | "system" | "tool"; content: string }[] = [
    { role: "user", content: "Begin your check now." },
  ];
  const system = agentSystemPrompt({
    task: deps.task,
    memorySummary: deps.memorySummary,
    tools: AGENT_TOOLS,
  });

  for (let n = 1; n <= deps.maxSteps; n++) {
    const t0 = Date.now();
    let step;
    try {
      step = await deps.model.decide({ system, messages, tools: AGENT_TOOLS });
    } catch (err) {
      emit({ n, kind: "error", ok: false, error: `model error: ${(err as Error).message}`, ms: Date.now() - t0 });
      throw new Error(`agent failed at step ${n}: model error: ${(err as Error).message}`);
    }

    if (step.kind === "final") {
      emit({ n, kind: "final", ok: true, preview: preview(step.report), ms: Date.now() - t0 });
      return { report: step.report, trace, steps: n };
    }

    if (step.name !== "browse") {
      emit({ n, kind: "error", name: step.name, ok: false, error: `unknown tool "${step.name}"`, ms: Date.now() - t0 });
      throw new Error(`agent tried to call unknown tool "${step.name}"`);
    }
    const url = String((step.args as { url?: unknown }).url ?? "");
    if (!/^https?:\/\//.test(url)) {
      emit({
        n,
        kind: "error",
        name: "browse",
        args: step.args,
        ok: false,
        error: "browse requires an absolute http(s) URL",
        ms: Date.now() - t0,
      });
      throw new Error("browse requires an absolute http(s) URL");
    }

    try {
      const r = await deps.browser.browse(url);
      emit({ n, kind: "tool", name: "browse", args: { url }, ok: true, preview: preview(r.text), ms: Date.now() - t0 });
      messages.push({
        role: "user",
        content:
          `TOOL RESULT browse(${url}):\nTITLE: ${r.title}\nTEXT: ${r.text}\n` +
          `LINKS: ${r.links.map((l) => `"${l.text}" -> ${l.href}`).join("; ") || "(none)"}`,
      });
    } catch (err) {
      emit({ n, kind: "tool", name: "browse", args: { url }, ok: false, error: (err as Error).message, ms: Date.now() - t0 });
      messages.push({ role: "user", content: `TOOL RESULT browse(${url}) FAILED: ${(err as Error).message}` });
    }
  }
  throw new Error(`agent exceeded step budget (${deps.maxSteps} steps) without finishing`);
}
