import { describe, expect, it } from "vitest";
import { runAgentWatcher } from "../../src/watchers";
import { browseStep, finalStep, fixtureBrowser, scriptedModel } from "../helpers";

describe("agent loop", () => {
  it("records the model's chosen steps in order", async () => {
    const result = await runAgentWatcher({
      model: scriptedModel([
        browseStep("https://chaosco.test/"),
        browseStep("https://chaosco.test/details"),
        finalStep("SIGNIFICANT: found it."),
      ]),
      browser: fixtureBrowser(3),
      task: "check the site",
      memorySummary: "(none)",
      maxSteps: 6,
    });
    expect(result.steps).toBe(3);
    expect(result.report).toBe("SIGNIFICANT: found it.");
    expect(result.trace.map((t) => `${t.kind}:${t.name ?? ""}:${JSON.stringify(t.args ?? null)}`)).toEqual([
      `tool:browse:{"url":"https://chaosco.test/"}`,
      `tool:browse:{"url":"https://chaosco.test/details"}`,
      "final::null",
    ]);
    // The trace carries what the model saw: the v3 homepage only teases,
    // and the second browse (the details page) has the actual announcement.
    expect(result.trace[0].preview).toContain("Read the full announcement");
    expect(result.trace[0].ok).toBe(true);
    expect(result.trace[1].preview).toContain("Widget 2.0");
  });

  it("rejects unknown tools", async () => {
    await expect(
      runAgentWatcher({
        model: scriptedModel([{ kind: "tool", name: "screenshot", args: {} }]),
        browser: fixtureBrowser(1),
        task: "x",
        memorySummary: "",
        maxSteps: 4,
      }),
    ).rejects.toThrow('unknown tool "screenshot"');
  });

  it("rejects non-absolute browse URLs", async () => {
    await expect(
      runAgentWatcher({
        model: scriptedModel([browseStep("/relative")]),
        browser: fixtureBrowser(1),
        task: "x",
        memorySummary: "",
        maxSteps: 4,
      }),
    ).rejects.toThrow("absolute http(s) URL");
  });

  it("fails when the model exceeds its step budget", async () => {
    await expect(
      runAgentWatcher({
        model: scriptedModel([
          browseStep("https://fixture.test/"),
          browseStep("https://fixture.test/"),
          browseStep("https://fixture.test/"),
          browseStep("https://fixture.test/"),
        ]),
        browser: fixtureBrowser(1),
        task: "x",
        memorySummary: "",
        maxSteps: 3,
      }),
    ).rejects.toThrow("exceeded step budget");
  });
});
