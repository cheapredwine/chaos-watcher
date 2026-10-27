# The chaos ladder — demo contract

ChaosCo serves one of four variants, switched by the DO's chaos flag (the
journal's **⚡ CHAOS** button cycles them; `POST /api/chaos {version}` sets one).
Underlying facts never change — only presentation degrades:

| v | Site | Script watcher | Agent watcher |
|---|------|----------------|---------------|
| 1 | clean, classed markup (`.announcement-headline`, `.announcement-detail`, `.pricing-note`) | ✓ extracts fields, diffs snapshot | ✓ reads, reports |
| 2 | redesign: classes renamed (`.promo-*`), sections reordered, text reworded | ✗ selector gone | ✓ reads the promo, judges substance unchanged |
| 3 | announcement moved behind `Read the full announcement` → `/details` | ✗ homepage-only, structurally impossible | ✓ follows the link, reads the real page |
| 4 | facts dissolved into prose (quarterly letter), zero markup hooks | ✗ nothing to select | ✓ reads prose, extracts the facts |

## Contract details tests assert

- Script failure message on v2/v3/v4 (exact):
  `selector .announcement-headline not found on homepage`
- Script success on v1 extracts `FACTS.headline` exactly; second identical run
  reports `No changes since last snapshot` (snapshot dedupe).
- Agent reports must start with `SIGNIFICANT:` or `NO CHANGE:` — the prefix
  decides whether a finding is recorded and pushed.
- Agent step sequences (canned in tests): v1/v2/v4 → `[/]`; v3 → `[/, /details]`.
- **Trace divergence**: recorded traces differ between v1 vs v2 (same shape,
  different observations/report) and v1 vs v3 (different step count). This is
  the demo's thesis — the model wrote different if-statements.

## Demo implications

- The script must stay a fair baseline — build it the obvious way against v1
  and never patch it for later variants.
- The agent path must stay generic: goal + `browse` tool only.
- When adding a variant (v5+), update `src/chaosco.ts`, this file, and the
  tests in the same change. `cycleChaos` and validation assume versions 1..4 —
  update `CHAOS_VERSIONS`, `setChaosVersion`, and the UI badge text together.
