import type { PushPayload, PushSender, PushSubRecord } from "./adapters";

/**
 * Web Push via the `web-push` npm library, which works in Workers with
 * `nodejs_compat` (see the Agents SDK push-notifications guide).
 * Lazy-imported so tests never load its Node crypto stack.
 */
export function createPushSender(vapid: {
  subject: string;
  publicKey: string;
  privateKey: string;
}): PushSender {
  return {
    async send(sub: PushSubRecord, payload: PushPayload): Promise<void> {
      const mod = (await import("web-push")) as unknown as {
        default: typeof import("web-push");
      } & typeof import("web-push");
      const webpush = mod.default ?? mod;
      webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
      await webpush.sendNotification(sub as never, JSON.stringify(payload));
    },
  };
}
