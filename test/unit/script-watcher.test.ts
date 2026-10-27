import { describe, expect, it } from "vitest";
import { FACTS } from "../../src/chaosco";
import { runScriptWatcher, ScriptFailure, normalizeSnapshot } from "../../src/watchers";
import { fixtureFetcher } from "../helpers";

// The script watcher's failure modes are part of the demo contract
// (docs/chaos-ladder.md): it must succeed on v1 and fail, for the documented
// reason, on every later variant.
describe("script watcher", () => {
  it("extracts the v1 fields and reports a change on first sight", async () => {
    const r = await runScriptWatcher(fixtureFetcher(1), null);
    expect(r.output.headline).toBe(FACTS.headline);
    expect(r.output.detail).toBe(FACTS.detail);
    expect(r.output.pricing).toContain("$59/mo");
    expect(r.changed).toBe(true);
  });

  it("reports no change when the snapshot is identical", async () => {
    const first = await runScriptWatcher(fixtureFetcher(1), null);
    const second = await runScriptWatcher(fixtureFetcher(1), first.snapshot);
    expect(second.changed).toBe(false);
  });

  it("is order-sensitive: a reverted change is a change again", async () => {
    const first = await runScriptWatcher(fixtureFetcher(1), null);
    await runScriptWatcher(fixtureFetcher(2), first.snapshot).catch(() => undefined);
    const back = await runScriptWatcher(fixtureFetcher(1), normalizeSnapshot("different site"));
    expect(back.changed).toBe(true);
  });

  it.each([2, 3, 4] as const)(
    "fails on v%d with the documented selector failure",
    async (v) => {
      await expect(runScriptWatcher(fixtureFetcher(v), null)).rejects.toThrow(ScriptFailure);
      await expect(runScriptWatcher(fixtureFetcher(v), null)).rejects.toThrow(
        "selector .announcement-headline not found on homepage",
      );
    },
  );
});
