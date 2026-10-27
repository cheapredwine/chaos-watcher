# AGENTS.md — working in this repo

Chaos Watcher: one Worker containing a mutable fake site (ChaosCo), an
enumerated **script watcher** baseline, a **model-driven agent watcher**, and a
journal/trace UI. Start with `README.md`, then `docs/architecture.md` and
`docs/chaos-ladder.md`.

## The honesty constraints (the one rule that matters)

This project demos *why agents differ from scripts*. Three rules protect that:

1. **Never sabotage the script watcher.** It must remain the fair, obvious
   implementation a real developer would write against v1. Its failure modes
   on v2–v4 are part of the demo contract (`docs/chaos-ladder.md`) and are
   asserted by tests.
2. **Never hard-code steps into the agent path.** The agent gets a goal and
   tools (`browse` only, today); the model decides the sequence. Do not add
   site-specific logic, selectors, or navigation hints to
   `src/watchers.ts`'s loop.
3. **Never fabricate trace entries.** The trace records what the model chose
   and what the tools returned. The trace-divergence test is the demo's thesis;
   fake traces make the demo a lie.

## The seams (testability contract)

All environment-specific behavior sits behind interfaces in `src/adapters.ts`:

- `ModelAdapter` — Workers AI in prod; **canned step sequences** in tests
- `BrowserAdapter` — Browser Rendering (`@cloudflare/puppeteer`) in prod; a
  fixture that renders the *real* ChaosCo HTML in tests
- `PageFetcher` — self-fetch of `SITE_ORIGIN` in prod; fixture in tests
- `PushSender` — `web-push` in prod; a recorder in tests

Tests inject via `__setTestAdapters(...)`; production always builds the real
set. If you change the loop or tools, keep this seam intact — it's what makes
the demo deterministically testable. Canned model scripts in
`test/helpers.ts` (`AGENT_SCRIPTS`) stand in for the live model and encode the
adaptation story; the live model is only exercised in rehearsal/smoke runs.

## Conventions

- Package manager: **pnpm**. Lint: `pnpm run lint` (oxlint). Types:
  `pnpm run typecheck`. Tests: `pnpm test` (Vitest + `@cloudflare/vitest-plugin`,
  runs inside workerd).
- Env types come from `wrangler types` → `worker-configuration.d.ts`
  (`Cloudflare.Env`); `src/env.ts` layers the VAPID secrets on top. Rerun
  `pnpm exec wrangler types` after changing `wrangler.jsonc`.
- Integration tests drive the real Worker routes via `SELF`; set test adapters
  before `SELF` calls.

## SDK gotchas learned here (don't relearn them)

- Durable Object stub methods return **Promises — always `await` them**.
  Unawaited stub calls silently produce `{}`/undefined responses (this bug
  cost a debugging session already).
- Never parameterize SQL *identifiers* (table names) — SQLite rejects `?`
  there; interpolate from a whitelist instead.
- `@cloudflare/vitest-pool-workers` was renamed to **`@cloudflare/vitest-plugin`**
  (`cloudflareTest({...})` as a Vite plugin). Set `remoteBindings: false` for
  hermetic tests, otherwise bindings — including the DO — run remote and test
  adapters never reach them.
- pnpm 12: build-script approvals live in `pnpm-workspace.yaml` under
  `allowBuilds` (workerd/esbuild/core-js-pure are approved here).
- Do NOT enable `experimentalDecorators` in tsconfig (breaks `@callable`).
- One DO binding + one `new_sqlite_classes` migration entry per agent class;
  never edit old migration tags.
- `web-push` works in Workers with `nodejs_compat` (Agents SDK push docs use it).
- Browser Rendering: 10 concurrent sessions/account (Paid), sessions are
  expensive to hold — never run parallel browser sessions in tests; always
  `browser.close()` in a `finally`.
- VAPID keys are secrets: `.dev.vars` locally, `wrangler secret put` in prod.
  Never in source, never echoed.

## When you change a ChaosCo variant

Update all three, or the demo drifts from its proof:
`src/chaosco.ts` (renderer) → `docs/chaos-ladder.md` (contract) →
`test/*` (assertions, incl. the exact script-failure messages).

## Known debts

- `scheduledTick` uses prod adapters; a remote-AI failure path exists overnight
  (failures are journaled and pushed once per identical error, but consider a
  model fallback later).
- Access JWT is presence-checked in code (`Cf-Access-Jwt-Assertion`); full
  signature verification is documented in the runbook as the hardening step.
