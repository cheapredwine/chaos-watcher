import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Hermetic tests: run every binding (including the Durable Object)
      // locally in workerd. The AI binding is never called in tests — the
      // model seam supplies canned decisions.
      remoteBindings: false,
      // .dev.vars (real deployment secrets) is picked up automatically and
      // would leak VAPID_* into the test environment. Force them empty so
      // the unconfigured-path tests see the intended state.
      miniflare: {
        bindings: { VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", VAPID_SUBJECT: "" },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
