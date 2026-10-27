# Chaos Watcher

> ⚠️ **NOT OFFICIAL CLOUDFLARE.** Not affiliated with or endorsed by Cloudflare, Inc.
> NO WARRANTIES, EXPRESS OR IMPLIED. Effectively untested demo code — read everything
> and dry-run before you run. You assume all risk. See [DISCLAIMER.md](./DISCLAIMER.md).

One Cloudflare Worker contains a fake company website (**ChaosCo**), a **script
watcher** that monitors it, an **agent watcher** that monitors it, and the
**journal** that proves what each one did. The site can be mutated live
("chaos"), and that's the whole point:

> Break the website in front of an audience. The script — whose every step a
> human enumerated — dies. The agent — whose only input is a goal and a set of
> tools — adapts, and its trace shows it choosing *different steps* than before.

That trace divergence is what "an agent" means here: **the model writes the
control flow at runtime**. If you could have written the if-statements ahead of
time, it's just an application. The chaos ladder (v1→v4) makes the boundary
visible instead of asserted.

## Why Cloudflare

Every platform claim has a visible moment in the demo, not a slide:

| Claim | Where you see it |
|---|---|
| Agents are stateful | The DO's findings memory — the journal dedupes across runs |
| Agents need triggers | Overnight runs in the journal nobody clicked (DO alarm + hibernation) |
| Agents need tools, incl. a browser | Browser Rendering sessions in the agent trace |
| One deploy, no orchestration stack | Site + script + agent + journal in a single `wrangler deploy` |
| Auth included | The journal is Access-gated; zero auth code in the repo |
| Inference colocated | Workers AI only — no API keys anywhere |

## Quickstart

```bash
pnpm install
pnpm test          # 36 tests, incl. the demo contract — CI proves the story
pnpm exec wrangler login
pnpm run dev       # http://localhost:8787/journal
```

Deploy + Access + VAPID setup: **[docs/runbook.md](docs/runbook.md)**.
The demo itself, moment by moment: **[docs/demo-script.md](docs/demo-script.md)**.

## Repository tour

- `src/chaosco.ts` — the fake site, all four variants, single source of truth
- `src/watchers.ts` — the script watcher (enumerated) + the agent loop (goal + tools)
- `src/agent.ts` — the Durable Object: journal, memory, chaos flag, alarm, push
- `src/adapters.ts` — the seams (model / browser / fetch / push) that make the loop testable
- `docs/` — architecture, the chaos ladder contract, demo script, runbook

## Cost & honest limitations

At demo scale this costs pennies: the DO hibernates between runs, browser
sessions are seconds long, and Workers AI tokens are small. Limitations, on
the record: the browser tools path is deliberately simple (one tool, text and
links); the live model is only exercised in rehearsal — tests replay canned
decisions through the same loop via the model seam; Web Push needs the browser
running on the demo machine; Browser Rendering requires Workers Paid.
