import type { Env } from "./env";

/** The single Durable Object instance that owns the journal, memory, chaos flag and alarm. */
export const AGENT_NAME = "chaos-demo";

/** Workers AI model driving the agent loop. Supports function calling (non-streaming). */
export const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** The goal handed to the model at runtime — the only "if-statement" we write. */
export function agentTask(env: Env): string {
  return (
    `Check ChaosCo's homepage at ${env.SITE_ORIGIN}/ and report anything that changed ` +
    "since your last check and whether it is worth knowing. " +
    "If the homepage only teases content, follow its links."
  );
}
