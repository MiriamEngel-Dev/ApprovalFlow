import { getSecret } from '@approvalflow/shared';
import { StubProvider } from './stub-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import type { AgentProvider } from './types.js';

const SECRET_STORE = 'local-secret-store';

/**
 * Provider selection via `LLM_PROVIDER` (stub | gemini) — swappable by configuration, never a
 * code change (M15). `stub` is the CI/eval default (ADR-008's fail-open path never needs a live
 * key to run in a pipeline).
 */
export async function createProvider(): Promise<AgentProvider> {
  const providerName = process.env.LLM_PROVIDER ?? 'stub';

  if (providerName === 'stub') {
    return new StubProvider();
  }

  if (providerName === 'gemini') {
    const secret = await getSecret(SECRET_STORE, 'LLM_API_KEY');
    const apiKey = secret.LLM_API_KEY;
    if (!apiKey) {
      throw new Error('LLM_PROVIDER=gemini but LLM_API_KEY secret is empty');
    }
    return new GeminiProvider(apiKey);
  }

  throw new Error(`Unknown LLM_PROVIDER: ${providerName}`);
}

export type { AgentProvider } from './types.js';
export { LlmProviderError } from './types.js';
