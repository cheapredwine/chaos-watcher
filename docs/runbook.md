# Runbook — deploy, Access, VAPID, push, logs

## 1. Deploy

```bash
pnpm install
pnpm exec wrangler login          # or CLOUDFLARE_API_TOKEN env
pnpm test                          # prove the contract first
pnpm exec wrangler deploy          # first deploy (SITE_ORIGIN is placeholder)
```

Note the deployed URL from the deploy output
(`https://chaos-watcher.<your-subdomain>.workers.dev`), then redeploy with it:

```bash
pnpm exec wrangler deploy --var SITE_ORIGIN:https://chaos-watcher.<your-subdomain>.workers.dev
```

`SITE_ORIGIN` is what the script watcher's self-fetch and the agent's browse
tool target. Sanity-check: `curl <url>/` shows ChaosCo v1.

## 2. Access (control plane only)

ChaosCo (`/`, `/details`) must stay public so the script's self-fetch and the
agent's browser are never challenged. Gate the control plane:

1. Zero Trust dashboard → **Access → Applications → Add → Self-hosted**.
2. Application domain: `chaos-watcher.<your-subdomain>.workers.dev`, path
   patterns: `/journal` and `/api/*` (Add two path rules).
3. Policy: Allow → Include → Emails → `<your email>` (add demo viewers as needed).
4. Flip the in-code belt-and-suspenders check:
   `wrangler deploy --var REQUIRE_ACCESS:true`
5. Verify: `curl <url>/api/state` → 401-ish redirect to Access; browser opens
   `/journal` after login.

Hardening (optional, later): verify the `Cf-Access-Jwt-Assertion` JWT signature
against the team's certs (`<team>.cloudflareaccess.com/cdn-cgi/access/certs`)
with the application's AUD tag, instead of the presence check in `src/index.ts`.

## 3. VAPID keys (Web Push)

```bash
npx web-push generate-vapid-keys      # prints a public + private key pair
```

Store as secrets (never in source, never echoed):

```bash
pnpm exec wrangler secret put VAPID_PUBLIC_KEY
pnpm exec wrangler secret put VAPID_PRIVATE_KEY
pnpm exec wrangler secret put VAPID_SUBJECT        # e.g. mailto:you@example.com
```

Local dev: copy `.dev.vars.example` → `.dev.vars` (gitignored) and fill it.

## 4. Enable push on a device

Open `<url>/journal` → **🔔 Enable push** → grant permission. The service
worker (`/sw.js`) registers, the subscription is stored in the DO. Verify with
**Send test push**. Notes:

- Works on desktop Chrome/Edge/Safari (macOS) while the browser runs.
- iOS needs an installed PWA — out of scope for this demo.
- Stale endpoints: the agent deletes subscriptions on push 404/410.

## 5. Day-to-day

```bash
pnpm exec wrangler tail --format pretty   # live logs
pnpm test                                  # demo contract
pnpm run dev                               # local: journal at :8787/journal
```

- **Reset the journal** (between rehearsals): journal UI → Reset journal —
  wipes runs/findings/snapshots; subscriptions survive by design.
- **Scheduled runs**: the DO arms itself (`0 * * * *`) on first contact;
  `alarmConfigured` badge shows armed state. Failures overnight are journaled
  and pushed (deduped per identical error).
- **Model**: `MODEL_ID` in `src/config.ts`. llama-3.3-70b (fp8-fast) supports
  function calling non-streaming; ~24k context. If you swap models, rerun a
  smoke agent run from the journal and check the trace.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `push not configured` in traces | VAPID secrets unset — step 3 |
| `/api/push/public-key` → 503 | same |
| Script watcher fails even on v1 | SITE_ORIGIN wrong or not reachable (check `wrangler deploy --var`) |
| Access loop / 401 in browser | Access app paths must cover `/journal` and `/api/*`; REQUIRE_ACCESS var matches |
| Agent trace shows model errors | Check AI binding + quota; try again; consider alternate model per config comment |
| Tests fail with remote-looking state | `remoteBindings: false` must be set in vitest.config.ts |
