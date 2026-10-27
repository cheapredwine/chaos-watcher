// ChaosCo — the fake company site the watchers watch.
//
// This module is the single source of truth for all four variants. The
// watchers never see this file: they only see rendered HTML. Every mutation
// here is specified in docs/chaos-ladder.md and asserted by the
// demo-contract tests — change a variant there, not just here.

export type ChaosVersion = 1 | 2 | 3 | 4;
export const CHAOS_VERSIONS: readonly ChaosVersion[] = [1, 2, 3, 4];

export function isChaosVersion(v: unknown): v is ChaosVersion {
  return typeof v === "number" && (CHAOS_VERSIONS as readonly number[]).includes(v);
}

// The underlying facts — constant across variants; only presentation changes.
export const FACTS = {
  headline: "Widget 2.0 is now generally available",
  detail:
    "After a five-week beta with 400 customers, Widget 2.0 is available to every plan.",
  pricing: "Widget Pro moved from the $49 beta rate to $59/mo.",
  product: "Widget connects your data to wherever decisions happen.",
};

function page(title: string, body: string, version: ChaosVersion): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#1d1d1f}
section{margin:2.5rem 0}h1{font-size:1.6rem}footer{margin-top:3rem;color:#888;font-size:.85rem;border-top:1px solid #eee;padding-top:1rem}
a{color:#f6821f}</style></head>
<body>
<h1>ChaosCo</h1>
${body}
<footer>ChaosCo — internal build v${version}</footer>
<!-- chaosco version: ${version} -->
</body></html>`;
}

/** Homepage for each chaos variant. */
export function renderChaosCo(version: ChaosVersion): string {
  switch (version) {
    // v1 — clean, classed markup. The script watcher is built against THIS.
    case 1:
      return page(
        "ChaosCo — Home",
        `<section class="announcements">
  <h2 class="announcement-headline">${FACTS.headline}</h2>
  <p class="announcement-detail">${FACTS.detail}</p>
</section>
<section class="product">
  <h3>What we make</h3>
  <p>${FACTS.product}</p>
</section>
<section class="pricing">
  <span class="pricing-note">${FACTS.pricing}</span>
</section>`,
        version,
      );

    // v2 — redesign: classes renamed, sections reordered, text reworded.
    // Facts identical; the script's selectors no longer exist.
    case 2:
      return page(
        "ChaosCo — Home",
        `<section class="pricing">
  <span class="promo-rate">Widget Pro: $59/mo (beta rate $49 retired)</span>
</section>
<section class="promo">
  <h2 class="promo-title">Introducing Widget 2.0 — out of beta and available on every plan</h2>
  <p class="promo-copy">Built with 400 beta customers over five weeks; Widget 2.0 ships to all plans starting today.</p>
</section>
<section class="product">
  <h3>What we make</h3>
  <p>${FACTS.product}</p>
</section>`,
        version,
      );

    // v3 — the announcement content moved to a second page. The homepage
    // only teases it. A homepage-only script cannot possibly find it.
    case 3:
      return page(
        "ChaosCo — Home",
        `<section class="news">
  <h3>Company news</h3>
  <p>Big product news this week — details on the announcement page.</p>
  <a class="cta" href="/details">Read the full announcement</a>
</section>
<section class="product">
  <h3>What we make</h3>
  <p>${FACTS.product}</p>
</section>
<section class="pricing">
  <span class="pricing-note">${FACTS.pricing}</span>
</section>`,
        version,
      );

    // v4 — no markup hooks at all: the facts are dissolved into prose.
    case 4:
      return page(
        "ChaosCo — Home",
        `<article>
  <h3>Quarterly update</h3>
  <p>Hello from the whole ChaosCo team. Alongside our quarterly update: after a
  five-week beta with 400 customers, Widget 2.0 left beta this week and is
  available to every plan. With general availability, Widget Pro also moved
  from the $49 beta rate to $59/mo. As always, Widget connects your data to
  wherever decisions happen — thanks for building with us.</p>
</article>`,
        version,
      );
  }
}

/** The v3 second page. Other versions don't use it. */
export function renderDetails(version: ChaosVersion): string {
  if (version !== 3) {
    return page("ChaosCo — Details", `<p>No additional announcements.</p>`, version);
  }
  return page(
    "ChaosCo — Full announcement",
    `<article>
  <h2>${FACTS.headline}</h2>
  <p>${FACTS.detail}</p>
  <p>${FACTS.pricing}</p>
</article>`,
    version,
  );
}
