#!/usr/bin/env -S npx tsx
// D5 (required, Milestone 14): one-command verification against a live cluster.
//
//   docker compose up -d
//   npm run verify
//
// Runs Journeys A/B/C/D + both anti-cheese guards + "≥2 auto-approvals" (all named in
// docs/IMPLEMENTATION-PLAN.md's Verification section) against the real gateway API — the same
// surface any real client uses, not an internal shortcut. Mints its own JWTs via the public
// POST /api/auth/login (no local secret-store access needed, same as the UI). Prints PASS/FAIL
// per check; exits 1 if any failed, so this is a real CI gate, not decoration.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Invoice, Role } from '@approvalflow/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.VERIFY_API_BASE ?? 'http://localhost:8080';
// Matches docker-compose.yml's own `${TEST_HARNESS_SECRET:-...}` fallback, so this lines up with
// zero extra config both in CI (no .env present) and a local `docker compose up`.
const TEST_HARNESS_SECRET = process.env.TEST_HARNESS_SECRET ?? 'change-me-to-a-long-random-string';

// --- fixtures (sample-invoices.json is the ground truth every journey/guard is defined against) ---

interface RawFixture extends Invoice {
  id: string;
}

const fixturesPath = path.resolve(__dirname, '../sample-invoices.json');
const { fixtures } = JSON.parse(readFileSync(fixturesPath, 'utf-8')) as { fixtures: RawFixture[] };

// Same explicit whitelist as services/decision-service/src/router/router.test.ts's toInvoice() —
// the fixture objects also carry `id`/`scenario`/`expected` fields that aren't part of Invoice
// and must never be sent to the API.
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

function fixture(id: string): Invoice {
  const found = fixtures.find((f) => f.id === id);
  if (!found) throw new Error(`Fixture ${id} not found in sample-invoices.json`);
  return toInvoice(found);
}

// --- thin API client ---

class VerifyError extends Error {}

async function apiFetch<T>(
  urlPath: string,
  opts: {
    method?: string;
    body?: unknown;
    token?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${urlPath}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as T) : (undefined as T);
  return { status: res.status, body };
}

async function login(role: Role): Promise<string> {
  const { status, body } = await apiFetch<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: { name: `verify-${role}`, role },
  });
  if (status !== 200) throw new VerifyError(`login as ${role} failed: HTTP ${status}`);
  return body.token;
}

interface SubmissionStatus {
  id: string;
  trackingId: string;
  status: string;
  reason: string;
}

// Statuses where the system is done acting on its own and won't change without an external
// action — the right point for pollStatus to stop, whether or not it's the *final* outcome a
// given check cares about. `human_review`/`info_requested` are included because they wait on an
// approver/submitter indefinitely (Journey B/D poll for human_review specifically in order to
// then act on it; the two anti-cheese guards poll for it and assert it's exactly what they land
// on, since nobody ever approves those two in this script). `approved` is deliberately *not*
// included — it's still transient, on its way to `payment_succeeded`/`payment_failed` once the
// saga catches up; stopping there early would look like success/failure prematurely.
const STABLE_STATUSES = new Set([
  'rejected',
  'reject',
  'duplicate',
  'payment_succeeded',
  'payment_failed',
  'human_review',
  'info_requested',
]);

interface SubmitResult {
  trackingId: string;
  status?: string;
}

async function submitInvoice(invoice: Invoice, token: string): Promise<SubmitResult> {
  const { status, body } = await apiFetch<SubmitResult & { correlationId: string }>(
    '/api/submissions',
    { method: 'POST', body: invoice, token },
  );
  if (status !== 202 && status !== 200) {
    throw new VerifyError(`submit failed: HTTP ${status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function pollStatus(
  trackingId: string,
  token: string,
  timeoutMs = 30_000,
): Promise<SubmissionStatus> {
  const deadline = Date.now() + timeoutMs;
  let last: SubmissionStatus | undefined;
  while (Date.now() < deadline) {
    const { status, body } = await apiFetch<SubmissionStatus>(
      `/api/submissions/tracking/${trackingId}`,
      { token },
    );
    if (status === 200) {
      last = body;
      if (STABLE_STATUSES.has(body.status)) return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new VerifyError(
    `timed out waiting for a stable status on tracking ${trackingId} (last seen: ${last?.status ?? 'none'})`,
  );
}

interface QueueItem {
  queueId: string;
  submissionId: string;
}

async function approveBySubmissionId(submissionId: string, approverToken: string): Promise<void> {
  const { body: queue } = await apiFetch<QueueItem[]>('/api/queue', { token: approverToken });
  const item = queue.find((q) => q.submissionId === submissionId);
  if (!item) throw new VerifyError(`submission ${submissionId} not found in the approval queue`);
  const { status } = await apiFetch(`/api/approve/${item.queueId}`, {
    method: 'POST',
    token: approverToken,
    body: { approverId: 'verify-approver' },
  });
  if (status !== 200) throw new VerifyError(`approve failed: HTTP ${status}`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new VerifyError(message);
}

// --- checks ---

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.log(`FAIL  ${name}\n      ${detail}`);
  }
}

async function main(): Promise<void> {
  console.log(`Verifying against ${BASE}\n`);

  const submitterToken = await login('submitter');
  const approverToken = await login('approver');

  await check('Journey A — INV-1001 auto-approves end-to-end (payment_succeeded)', async () => {
    const { trackingId } = await submitInvoice(fixture('INV-1001'), submitterToken);
    const final = await pollStatus(trackingId, submitterToken);
    assert(final.status === 'payment_succeeded', `expected payment_succeeded, got ${final.status}`);
  });

  await check('Journey B — INV-1003 escalates, approves, and pays', async () => {
    const { trackingId } = await submitInvoice(fixture('INV-1003'), submitterToken);
    const pending = await pollStatus(trackingId, submitterToken);
    assert(pending.status === 'human_review', `expected human_review, got ${pending.status}`);

    await approveBySubmissionId(pending.id, approverToken);

    const final = await pollStatus(trackingId, submitterToken);
    assert(final.status === 'payment_succeeded', `expected payment_succeeded, got ${final.status}`);
  });

  await check('Journey C — INV-1007 (duplicate of INV-1001) short-circuits at intake', async () => {
    // Depends on Journey A above having already processed INV-1001 in this same run.
    const result = await submitInvoice(fixture('INV-1007'), submitterToken);
    assert(
      result.status === 'duplicate',
      `expected an immediate duplicate response, got ${JSON.stringify(result)}`,
    );
  });

  await check('Journey D — INV-1012 forced payment failure compensates cleanly', async () => {
    const { trackingId } = await submitInvoice(fixture('INV-1012'), submitterToken);
    const pending = await pollStatus(trackingId, submitterToken);
    assert(pending.status === 'human_review', `expected human_review, got ${pending.status}`);

    // Must be set before approval — approval is what triggers the saga, so the forced-failure
    // flag has to exist before that, not before the original submission (see mock-provider.ts).
    const { status: forceFailStatus } = await apiFetch('/internal/mock-provider/force-fail', {
      method: 'POST',
      headers: { 'X-Test-Harness-Secret': TEST_HARNESS_SECRET },
      body: { submissionId: pending.id },
    });
    assert(forceFailStatus === 204, `force-fail hook failed: HTTP ${forceFailStatus}`);

    await approveBySubmissionId(pending.id, approverToken);

    const final = await pollStatus(trackingId, submitterToken);
    assert(
      final.status === 'payment_failed',
      `expected payment_failed (compensated), got ${final.status}`,
    );
  });

  await check('Anti-cheese guard — INV-1013 is not steered by adversarial notes', async () => {
    const { trackingId } = await submitInvoice(fixture('INV-1013'), submitterToken);
    const final = await pollStatus(trackingId, submitterToken);
    assert(
      final.status !== 'payment_succeeded' && final.status !== 'auto_approve',
      `adversarial "approve me" invoice was auto-approved (status: ${final.status})`,
    );
  });

  await check(
    'Anti-cheese guard — INV-1011 escalates despite being under the ceiling',
    async () => {
      const { trackingId } = await submitInvoice(fixture('INV-1011'), submitterToken);
      const final = await pollStatus(trackingId, submitterToken);
      assert(final.status === 'human_review', `expected human_review, got ${final.status}`);
    },
  );

  await check('At least 2 fixtures auto-approve with zero human involvement', async () => {
    // Journey A (INV-1001) already proved one auto_approve->payment_succeeded above; this proves
    // a second, independent one, not just a coincidence.
    const { trackingId } = await submitInvoice(fixture('INV-1002'), submitterToken);
    const final = await pollStatus(trackingId, submitterToken);
    assert(
      final.status === 'payment_succeeded',
      `INV-1002 expected payment_succeeded, got ${final.status}`,
    );
  });

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error('verify.ts crashed:', err);
  process.exitCode = 1;
});
