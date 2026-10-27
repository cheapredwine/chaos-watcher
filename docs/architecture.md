# Architecture

```
                        ┌──────────── TRIGGERS ────────────┐
                        │  hourly DO alarm (cron 0 * * * *)│
                        │  manual "run now" (journal UI)   │
                        └───────┬──────────────┬───────────┘
                                ▼              │
┌───────────────────────────────────────────────────────────────────────┐
│ Worker — one deploy, Access-gated on /journal + /api/*                 │
│   GET  /            ChaosCo homepage (variant from DO flag)            │
│   GET  /details     ChaosCo v3 second page                             │
│   GET  /journal     journal UI (static) · GET /sw.js push service wkr  │
│   POST /api/chaos   flip/cycle variant · POST /api/run/:mode           │
│   GET  /api/state|runs|runs/:id|findings · /api/push/* · /api/reset    │
└───────────────────────────────┬───────────────────────────────────────┘
                                ▼  (DO RPC, instance "chaos-demo")
┌───────────────────────────────────────────────────────────────────────┐
│ Durable Object — WatcherAgent (agents SDK)                             │
│   • script watcher: fetch → parse v1 classes → diff snapshot → report  │
│   • agent loop: Workers AI decides steps over the browse tool          │
│   • runs journal + findings memory (fingerprint dedupe) → DO SQLite    │
│   • push subscriptions + web-push delivery (dead-endpoint cleanup)     │
│   • hourly alarm → agent-mode run (proactive behavior)                 │
└─────┬──────────────────┬──────────────────┬───────────────────────────┘
      ▼                  ▼                  ▼
 Workers AI       Browser Rendering      web-push (VAPID)
 (brain)          (eyes — Chromium)      (voice)
```

## The two watchers, and where agency lives

**Script watcher** (`runScriptWatcher`) — the fair baseline. A developer
enumerated the steps: fetch homepage, extract `.announcement-headline` /
`.announcement-detail`, diff against the last snapshot, report changes. It is
a legitimate Worker application. It breaks — honestly — the moment the site
stops matching.

**Agent watcher** (`runAgentWatcher`) — the only structure in code is the loop
itself:

```
ask the model → do what it chose → show it the result → repeat
```

The goal and tools are inputs; the *sequence of tool calls* is the model's
decision, made at runtime. `AGENT_TASK` (src/config.ts) is the only "if-statement"
we write. The model must begin its final report with `SIGNIFICANT:` or
`NO CHANGE:` — that prefix is the contract for what gets pushed.

## Data model (DO SQLite)

- `runs` — every trigger: mode, chaos version, ok, summary, **trace** (JSON:
  every step the model chose, with previews and timings)
- `findings` — significant results + failures, SHA-256-fingerprint-deduped
- `snapshots` — script-watcher diff baseline per mode
- `subscriptions` — Web Push endpoints + keys

## The seams

| Adapter | Production | Tests |
|---|---|---|
| `ModelAdapter` | Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (function calling, non-streaming) | canned step sequences |
| `BrowserAdapter` | `@cloudflare/puppeteer` over the BROWSER binding | renders the real ChaosCo HTML |
| `PageFetcher` | self-fetch `SITE_ORIGIN` | fixture |
| `PushSender` | `web-push` | recorder array |

## ChaosCo + Access split

ChaosCo (`/`, `/details`) is **public on purpose**: the script's self-fetch and
the agent's browser session must never be Access-challenged. The control plane
(`/journal`, `/api/*`) is gated by the edge Access application plus an
in-code JWT presence check. See the runbook for the Access app config.

## "Why Cloudflare" → visible demo moment

| Platform claim | Visible moment |
|---|---|
| Stateful agents (DO + SQLite) | journal memory; findings dedupe across runs |
| Triggers + hibernation | overnight runs nobody clicked; ~zero idle cost |
| Tools incl. a browser | Browser Rendering in the trace |
| One deploy | site + script + agent + journal in one `wrangler deploy` |
| Auth included | Access on the journal; zero auth code |
| Colocated inference | Workers AI; no external keys |

## Decision log

- Headless, trigger-driven; no chat UI (the journal is the interface).
- Browser push over Slack for findings (zero-setup, mid-demo arrival).
- Workers AI only (no external keys; part of the platform story).
- `agents` SDK for the DO (schedules, sql, state) — the learning spike's point.
- Puppeteer over the experimental `agents/browser` tools for the browser path
  (stability), hidden behind the `BrowserAdapter` seam so it can be swapped.
