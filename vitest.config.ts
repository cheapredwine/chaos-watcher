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
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
