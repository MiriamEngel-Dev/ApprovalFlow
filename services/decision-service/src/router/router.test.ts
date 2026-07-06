import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentAssessment, Invoice, PolicyConfig, Route } from '@approvalflow/shared';
import { route } from './router.js';
import { normalizeInvoice } from './fx.js';
import { FIXTURE_ASSESSMENTS } from './fixture-assessments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../../../sample-invoices.json');

interface RawFixture extends Invoice {
  id: string;
  scenario?: string;
  expected: { route: Route; violations: string[]; reason: string };
}

interface FixturesFile {
  fixtures: RawFixture[];
}

const fixturesFile: FixturesFile = JSON.parse(readFileSync(fixturesPath, 'utf-8'));

const DEFAULT_POLICY: PolicyConfig = { ceiling: 250, confidenceThreshold: 0.8, policyVersion: 1 };

function toInvoice(fixture: RawFixture): Invoice {
  const invoice: Invoice = {
    vendor: fixture.vendor,
    vendorKnown: fixture.vendorKnown,
    invoiceNumber: fixture.invoiceNumber,
    currency: fixture.currency,
    category: fixture.category,
    department: fixture.department,
    submitter: fixture.submitter,
    lineItems: fixture.lineItems,
    taxAmount: fixture.taxAmount,
    total: fixture.total,
    receiptPresent: fixture.receiptPresent,
    date: fixture.date,
  };
  if (fixture.notes !== undefined) invoice.notes = fixture.notes;
  if (fixture.attendees !== undefined) invoice.attendees = fixture.attendees;
  if (fixture.clientName !== undefined) invoice.clientName = fixture.clientName;
  if (fixture.billingPeriod !== undefined) invoice.billingPeriod = fixture.billingPeriod;
  if (fixture.fareClass !== undefined) invoice.fareClass = fixture.fareClass;
  return invoice;
}

function getAssessment(id: string): AgentAssessment {
  const assessment = FIXTURE_ASSESSMENTS[id];
  if (!assessment) throw new Error(`No fixture assessment defined for ${id}`);
  return assessment;
}

describe('router — all 22 shipped fixtures', () => {
  for (const fixture of fixturesFile.fixtures) {
    it(`${fixture.id}: routes to ${fixture.expected.route}`, () => {
      const assessment = getAssessment(fixture.id);

      const normalized = normalizeInvoice(toInvoice(fixture));
      const context = fixture.id === 'INV-1007' ? { isDuplicate: true } : {};
      const result = route(normalized, assessment, DEFAULT_POLICY, context);

      expect(result.route).toBe(fixture.expected.route);
    });
  }
});

describe('router — named anti-cheese guards', () => {
  const byId = new Map(fixturesFile.fixtures.map((f) => [f.id, f]));

  it('INV-1013: ceiling beats a 0.95-confidence "approve me" agent recommendation', () => {
    const fixture = byId.get('INV-1013')!;
    const result = route(
      normalizeInvoice(toInvoice(fixture)),
      getAssessment('INV-1013'),
      DEFAULT_POLICY,
    );
    expect(result.route).toBe('human_review');
  });

  it('INV-1011: an unknown-vendor hard stop fires even under the ceiling', () => {
    const fixture = byId.get('INV-1011')!;
    const result = route(
      normalizeInvoice(toInvoice(fixture)),
      getAssessment('INV-1011'),
      DEFAULT_POLICY,
    );
    expect(result.route).toBe('human_review');
  });

  it('INV-1021: business-class fare hard stop fires under both TRAVEL-02 and the ceiling', () => {
    const fixture = byId.get('INV-1021')!;
    const result = route(
      normalizeInvoice(toInvoice(fixture)),
      getAssessment('INV-1021'),
      DEFAULT_POLICY,
    );
    expect(result.route).toBe('human_review');
  });

  it('INV-1020: low confidence alone escalates an otherwise-clean, under-ceiling item', () => {
    const fixture = byId.get('INV-1020')!;
    const result = route(
      normalizeInvoice(toInvoice(fixture)),
      getAssessment('INV-1020'),
      DEFAULT_POLICY,
    );
    expect(result.route).toBe('human_review');
  });

  it('INV-1015: alcohol-only rejects regardless of amount or confidence', () => {
    const fixture = byId.get('INV-1015')!;
    const result = route(
      normalizeInvoice(toInvoice(fixture)),
      getAssessment('INV-1015'),
      DEFAULT_POLICY,
    );
    expect(result.route).toBe('reject');
  });

  it('at least 2 fixtures auto-approve with zero human involvement', () => {
    const autoApproved = fixturesFile.fixtures.filter((fixture) => {
      const result = route(
        normalizeInvoice(toInvoice(fixture)),
        getAssessment(fixture.id),
        DEFAULT_POLICY,
      );
      return result.route === 'auto_approve';
    });
    expect(autoApproved.length).toBeGreaterThanOrEqual(2);
  });
});
