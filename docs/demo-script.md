# Demo script — "The Chaos Watcher"

Target: ~5 minutes. Everything happens on the journal page
(`/journal`, Access-gated). Rehearse once before presenting; the demo contract
is CI-tested (`pnpm test`), but the live model and Web Push are not.

## Pre-flight checklist (10 minutes before)

- [ ] `https://chaos-watcher.jsherron-test-account.workers.dev/journal` loads after Access sign-in; `pnpm exec wrangler deploy` is current (runbook §0)
- [ ] Chaos flag at **v1** (or press ⚡ until the badge reads v1, then reset journal)
- [ ] Journal pre-seeded: trigger 2–3 agent runs now so the audience sees overnight-style history
- [ ] Push enabled on the demo machine's browser (🔔 Enable push), volume/silent state as desired
- [ ] Access session active in the demo browser (no login surprise mid-demo)
- [ ] `pnpm exec wrangler tail --format pretty` running in a spare terminal for emergencies

## The moments

### 1. Open the journal — "it's been working while we talked" (≈45s)
Show the runs list. Lines that land:
- "Nobody clicked these — the agent wakes itself on an hourly alarm."
- "Between runs it hibernates; idle cost is effectively zero."

### 2. Run the script watcher (▶ Run script watcher) — green (≈30s)
- "This is the Workers-app version: a human wrote every step — fetch, select,
  diff, report. On a stable site, this is the *right* engineering."

### 3. Run the agent watcher (▶ Run agent watcher) — green (≈45s)
Open the trace. Point at the steps:
- "Same goal — but look at the trace: the *model* chose these steps. I never
  wrote a navigation sequence. Its first line says SIGNIFICANT — that's the
  contract for what gets pushed."

### 4. CHAOS → v2, run both (≈60s) — the first kill
Press ⚡ CHAOS (badge → v2: redesigned layout, reworded text, classes renamed).
- Script: **red** — `selector .announcement-headline not found on homepage`.
- Agent: **green** — and the trace differs from run 3 (different report; it read
  the promo banner instead).
- "The site changed shape. The script's assumptions broke. The agent re-planned —
  that's the difference between an application and an agent: who writes the
  if-statements."

### 5. CHAOS → v3, run the agent (≈45s) — the navigation
- Script: structurally impossible (the announcement isn't on the homepage).
- Agent: trace shows two browses — homepage, then `/details` — it *followed
  the link*, read the real announcement, and reported it.
- "No code knew that page existed."

### 6. CHAOS → v4, run the agent (≈45s) — prose + the push
- No markup at all; the facts live in a quarterly letter.
- Agent reads the prose, reports SIGNIFICANT — **and the push notification
  arrives on your screen mid-sentence.**
- "It decided that was worth knowing, remembered it hadn't said it before,
  and told me without being asked."

### 7. Wrap on the platform story (≈45s)
- "All of this is one `wrangler deploy`: the site, the script, the agent, the journal."
- "State = Durable Object + SQLite. Triggers = alarms + hibernation. Eyes = Browser
  Rendering. Brain = Workers AI — no API keys anywhere. Auth = Access — no auth code.
  Voice = Web Push."

## Recovery playbook

| Symptom | Move |
|---|---|
| Agent run fails live | Press ▶ Run agent again (transient model/browser blips happen). If repeated: check `wrangler tail`; reduce chaos to a variant it handles |
| Push doesn't arrive in moment 6 | The finding is already visible in the journal — show it there: "and it pushed this to my device — normally you'd see it arrive." Then: Send test push to verify the pipe |
| Script unexpectedly green on v2+ | Chaos flag didn't flip — check the v badge, press ⚡ again |
| Journal looks empty | Pre-seed runs (pre-flight); Reset journal only between rehearsals, not mid-demo |
| Browser session errors (429/422) | Close waiting period; meanwhile show a previous run's trace from the journal |

## Rehearsal notes

- The trace-divergence moment (4) is the demo's thesis — rehearse that the
  v1→v2 trace change is *visible at a glance* (different report text).
- Verify push delivery end-to-end once before any audience (🔔 Enable push →
  Send test push).
- Keep `pnpm test` green before presenting: CI proves the contract the demo
  then shows live.
