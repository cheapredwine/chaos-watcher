import { describe, expect, it } from "vitest";
import { FACTS, renderChaosCo, renderDetails } from "../../src/chaosco";

describe("ChaosCo variants", () => {
  it("v1 renders the classed markup the script watcher is built against", () => {
    const html = renderChaosCo(1);
    expect(html).toContain('class="announcement-headline"');
    expect(html).toContain('class="announcement-detail"');
    expect(html).toContain('class="pricing-note"');
    expect(html).toContain(FACTS.headline);
    expect(html).toContain(FACTS.detail);
  });

  it("v2 renames the classes and rewords the text", () => {
    const html = renderChaosCo(2);
    expect(html).not.toContain('class="announcement-headline"');
    expect(html).toContain('class="promo-title"');
    // Facts survive, wording does not.
    expect(html).toContain("available on every plan");
    expect(html).not.toContain(FACTS.headline);
  });

  it("v3 moves the announcement behind a /details link", () => {
    const home = renderChaosCo(3);
    expect(home).toContain('href="/details"');
    expect(home).not.toContain(FACTS.headline);
    const details = renderDetails(3);
    expect(details).toContain(FACTS.headline);
    expect(details).toContain(FACTS.pricing);
  });

  it("v4 dissolves the facts into prose with no markup hooks", () => {
    const html = renderChaosCo(4);
    expect(html).toContain("available to every plan");
    expect(html).toContain("$59/mo");
    expect(html).not.toMatch(/class="announcement/);
    expect(html).not.toContain('class="pricing-note"');
  });

  it("every variant carries a visible version marker", () => {
    for (const v of [1, 2, 3, 4] as const) {
      expect(renderChaosCo(v)).toContain(`internal build v${v}`);
    }
  });

  it("non-v3 details pages carry no announcement", () => {
    for (const v of [1, 2, 4] as const) {
      expect(renderDetails(v)).not.toContain(FACTS.headline);
    }
  });
});
