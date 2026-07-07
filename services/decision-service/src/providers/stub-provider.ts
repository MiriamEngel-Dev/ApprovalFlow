import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AgentAssessment, NormalizedInvoice } from '@approvalflow/shared';
import { FIXTURE_ASSESSMENTS } from '../router/fixture-assessments.js';
import type { AgentProvider } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../../../sample-invoices.json');

interface RawFixture {
  id: string;
  vendor: string;
  invoiceNumber: string;
  total: number;
}

/** `vendor::invoiceNumber::total` -> fixture id (same tuple submission-service's dedup constraint
 * uses), so a real invoice submitted through the API can be matched back to its canonical
 * fixture-assessment even though the wire payload never carries the fixture's `id` field. */
function buildFixtureKeyIndex(): Map<string, string> {
  const { fixtures } = JSON.parse(readFileSync(fixturesPath, 'utf-8')) as {
    fixtures: RawFixture[];
  };
  const index = new Map<string, string>();
  for (const fixture of fixtures) {
    index.set(`${fixture.vendor}::${fixture.invoiceNumber}::${fixture.total}`, fixture.id);
  }
  return index;
}

const FIXTURE_KEY_INDEX = buildFixtureKeyIndex();

const NO_FIXTURE_MATCH_ASSESSMENT: AgentAssessment = {
  recommendation: 'review',
  confidence: 0,
  reasoning: 'Stub provider: no matching fixture assessment for this invoice.',
  rulesCited: [],
  violations: [],
};

/**
 * Deterministic, fixture-mapped responses for CI/eval (no network calls) — reuses the single
 * canonical `FIXTURE_ASSESSMENTS` map (router/fixture-assessments.ts) so `StubProvider`, the
 * router's own tests, and `npm run eval` never drift. An invoice not in `sample-invoices.json`
 * (e.g. manually submitted via the UI while `LLM_PROVIDER=stub`) is not a provider *error* — it's
 * just untested input — so this returns a conservative low-confidence assessment directly rather
 * than throwing `LlmProviderError`; the router still fails safe (`human_review`) either way.
 */
export class StubProvider implements AgentProvider {
  async assess(invoice: NormalizedInvoice): Promise<AgentAssessment> {
    const key = `${invoice.vendor}::${invoice.invoiceNumber}::${invoice.total}`;
    const fixtureId = FIXTURE_KEY_INDEX.get(key);
    const assessment = fixtureId ? FIXTURE_ASSESSMENTS[fixtureId] : undefined;
    return Promise.resolve(assessment ?? NO_FIXTURE_MATCH_ASSESSMENT);
  }
}
