import { MockLLMProvider } from "./index.js";
import { OpenRouterProvider } from "./openrouter-provider.js";
import type { LLMProvider } from "./index.js";

/**
 * Picks the LLM provider from the environment. OPENROUTER_API_KEY present ->
 * OpenRouterProvider; otherwise the deterministic mock so the whole lifecycle
 * keeps working with zero credentials.
 */
export function selectLLM(): LLMProvider {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey) return new OpenRouterProvider({ apiKey });
  return new MockLLMProvider();
}
