import type {
  BrowserAdapter,
  BrowseResult,
  ModelAdapter,
  ModelStep,
  PageFetcher,
  PushPayload,
  PushSender,
} from "../src/adapters";
import { __setTestAdapters } from "../src/adapters";
import { renderChaosCo, renderDetails, type ChaosVersion } from "../src/chaosco";

// ---------------------------------------------------------------------------
// Fixture adapters. The browser "renders" the real ChaosCo HTML (so the tests
// exercise the genuine page bytes), the model replays canned decisions, and
// push messages are recorded instead of sent.
// ---------------------------------------------------------------------------

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function fixtureBrowser(version: ChaosVersion): BrowserAdapter {
  return {
    async browse(url: string): Promise<BrowseResult> {
      const path = new URL(url).pathname;
      const html = path === "/details" ? renderDetails(version) : renderChaosCo(version);
      const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(
        (m) => ({
          href: m[1],
          text: m[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
        }),
      );
      const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
      return { url, title, text: htmlToText(html).slice(0, 4000), links };
    },
  };
}

export function fixtureFetcher(version: ChaosVersion): PageFetcher {
  return {
    async fetch(path: string): Promise<string> {
      return path === "/details" ? renderDetails(version) : renderChaosCo(version);
    },
  };
}

export function scriptedModel(steps: ModelStep[]): ModelAdapter {
  const queue = [...steps];
  return {
    async decide() {
      return queue.length > 0
        ? (queue.shift() as ModelStep)
        : { kind: "final", report: "NO CHANGE: (scripted model exhausted its plan)" };
    },
  };
}

export function recordingPush(): { sent: PushPayload[]; sender: PushSender } {
  const sent: PushPayload[] = [];
  return {
    sent,
    sender: {
      async send(_sub, payload) {
        sent.push(payload);
      },
    },
  };
}

export const browseStep = (url: string): ModelStep => ({ kind: "tool", name: "browse", args: { url } });
export const finalStep = (report: string): ModelStep => ({ kind: "final", report });

/** The origin the fixture browser serves; canned model decisions use absolute URLs. */
export const FIXTURE_ORIGIN = "https://chaosco.test";
export const fixtureUrl = (path: string): string => `${FIXTURE_ORIGIN}${path}`;

/**
 * Canned model decisions per chaos variant. In tests these stand in for the
 * live model; they encode the adaptation story the demo presents:
 * v3 forces navigation to the details page, the others finish from the
 * homepage. The trace-divergence test asserts the recorded steps differ.
 */
export const AGENT_SCRIPTS: Record<ChaosVersion, ModelStep[]> = {
  1: [browseStep(fixtureUrl("/")), finalStep("SIGNIFICANT: Widget 2.0 is now generally available — fresh announcement on the homepage.")],
  2: [browseStep(fixtureUrl("/")), finalStep("SIGNIFICANT: The site was redesigned — the announcement is now a promo banner; same facts (Widget 2.0 GA).")],
  3: [
    browseStep(fixtureUrl("/")),
    browseStep(fixtureUrl("/details")),
    finalStep("SIGNIFICANT: The announcement moved behind a 'Read the full announcement' link; the full text confirms Widget 2.0 is generally available."),
  ],
  4: [browseStep(fixtureUrl("/")), finalStep("SIGNIFICANT: Quarterly letter: Widget 2.0 left beta and Widget Pro moved from the $49 beta rate to $59/mo.")],
};

/** Wire fixture adapters for a variant; returns the recorded push messages. */
export function setAdapters(version: ChaosVersion, model?: ModelAdapter): { sent: PushPayload[] } {
  const { sender, sent } = recordingPush();
  __setTestAdapters({
    pageFetcher: fixtureFetcher(version),
    browser: fixtureBrowser(version),
    model: model ?? scriptedModel([]),
    push: sender,
  });
  return { sent };
}
