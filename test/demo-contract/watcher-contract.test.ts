import { describe, expect, it } from "vitest";
import { FACTS } from "../../src/chaosco";
import { runAgentWatcher, runScriptWatcher } from "../../src/watchers";
import {
  AGENT_SCRIPTS,
  fixtureBrowser,
  fixtureFetcher,
  fixtureUrl,
  scriptedModel,
} from "../helpers";

/**
 * The demo contract (docs/chaos-ladder.md), as tests. CI proves the story
 * before anyone presents it:
 *
 *   v1: script ✓  agent ✓            — "both green"
 *   v2: script ✗  agent ✓ (adapted)  — "the site changed shape"
 *   v3: script ✗  agent ✓ (navigates)— "the data moved pages"
 *   v4: script ✗  agent ✓ (reads)    — "there is no field left"
 *
 * plus the trace-divergence assertion: the agent's recorded steps differ
 * between variants — the model wrote different if-statements.
 */
describe("demo contract", () => {
  describe("script watcher", () => {
    it("v1: succeeds", async () => {
      const r = await runScriptWatcher(fixtureFetcher(1), null);
      expect(r.output.headline).toBe(FACTS.headline);
      expect(r.changed).toBe(true);
    });

    it.each([2, 3, 4] as const)("v%d: fails with the documented selector error", async (v) => {
      await expect(runScriptWatcher(fixtureFetcher(v), null)).rejects.toThrow(
        "selector .announcement-headline not found on homepage",
      );
    });
  });

  describe("agent watcher", () => {
    async function runAgent(v: 1 | 2 | 3 | 4) {
      return runAgentWatcher({
        model: scriptedModel(AGENT_SCRIPTS[v]),
        browser: fixtureBrowser(v),
        task: "check ChaosCo",
        memorySummary: "(none yet — first check)",
        maxSteps: 6,
      });
    }

    it("succeeds on every variant", async () => {
      for (const v of [1, 2, 3, 4] as const) {
        const r = await runAgent(v);
        expect(r.report.startsWith("SIGNIFICANT:")).toBe(true);
      }
    });

    it("v3: navigates to the details page the homepage links to", async () => {
      const r = await runAgent(3);
      const urls = r.trace.filter((t) => t.kind === "tool").map((t) => (t.args as { url: string }).url);
      expect(urls).toEqual([fixtureUrl("/"), fixtureUrl("/details")]);
      // What it read on the second page is what it reported.
      expect(r.report).toContain("Widget 2.0");
    });

    it("v1/v2/v4: finishes from the homepage alone", async () => {
      for (const v of [1, 2, 4] as const) {
        const r = await runAgent(v);
        const urls = r.trace.filter((t) => t.kind === "tool").map((t) => (t.args as { url: string }).url);
        expect(urls).toEqual([fixtureUrl("/")]);
      }
    });
  });

  describe("trace divergence — the demo's thesis", () => {
    it("the agent takes different steps when the site changes", async () => {
      const t1 = (await (async () =>
        runAgentWatcher({
          model: scriptedModel(AGENT_SCRIPTS[1]),
          browser: fixtureBrowser(1),
          task: "check ChaosCo",
          memorySummary: "",
          maxSteps: 6,
        }))()).trace;
      const t3 = (await (async () =>
        runAgentWatcher({
          model: scriptedModel(AGENT_SCRIPTS[3]),
          browser: fixtureBrowser(3),
          task: "check ChaosCo",
          memorySummary: "",
          maxSteps: 6,
        }))()).trace;

      expect(t1.length).toBe(2);
      expect(t3.length).toBe(3);
      expect(JSON.stringify(t1)).not.toBe(JSON.stringify(t3));
    });

    it("even the homepage-only variants diverge in what was seen and said", async () => {
      const t1 = (await (async () =>
        runAgentWatcher({
          model: scriptedModel(AGENT_SCRIPTS[1]),
          browser: fixtureBrowser(1),
          task: "check ChaosCo",
          memorySummary: "",
          maxSteps: 6,
        }))()).trace;
      const t2 = (await (async () =>
        runAgentWatcher({
          model: scriptedModel(AGENT_SCRIPTS[2]),
          browser: fixtureBrowser(2),
          task: "check ChaosCo",
          memorySummary: "",
          maxSteps: 6,
        }))()).trace;
      // Same step count, different observations and a different report.
      expect(t1.length).toBe(t2.length);
      expect(JSON.stringify(t1)).not.toBe(JSON.stringify(t2));
      expect(AGENT_SCRIPTS[1][1]).not.toEqual(AGENT_SCRIPTS[2][1]);
    });
  });
});
