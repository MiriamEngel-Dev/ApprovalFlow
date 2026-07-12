import type { Invoice } from '@approvalflow/shared';

const CATEGORIES = ['meals', 'saas', 'travel', 'hardware', 'other'];

export type ValidationResult =
  { valid: true; invoice: Invoice } | { valid: false; errors: string[] };

/** Minimal structural validation at the system boundary (M15). Business-rule validation is the
 * router's job (services/decision-service/src/router), not this service's. */
export function validateInvoice(body: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof body !== 'object' || body === null) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }
  const b = { ...(body as Record<string, unknown>) };

  // Trim free-text fields before validating/storing — a stray leading/trailing space (easy to
  // introduce via copy-paste) would otherwise silently break the vendor+invoiceNumber+total dedup
  // match (F3) and the stub/eval fixture lookup (StubProvider keys on exact string equality),
  // making an already-seen invoice look brand new to both.
  for (const field of ['vendor', 'invoiceNumber', 'currency', 'department', 'submitter'] as const) {
    if (typeof b[field] === 'string') b[field] = (b[field] as string).trim();
  }

  if (typeof b.vendor !== 'string' || !b.vendor) errors.push('vendor is required');
  if (typeof b.vendorKnown !== 'boolean') errors.push('vendorKnown must be a boolean');
  if (typeof b.invoiceNumber !== 'string' || !b.invoiceNumber)
    errors.push('invoiceNumber is required');
  if (typeof b.currency !== 'string' || b.currency.length !== 3) {
    errors.push('currency must be a 3-letter code');
  }
  if (typeof b.category !== 'string' || !CATEGORIES.includes(b.category)) {
    errors.push(`category must be one of ${CATEGORIES.join(', ')}`);
  }
  if (typeof b.department !== 'string' || !b.department) errors.push('department is required');
  if (typeof b.submitter !== 'string' || !b.submitter) errors.push('submitter is required');
  if (!Array.isArray(b.lineItems) || b.lineItems.length === 0) {
    errors.push('lineItems must be a non-empty array');
  }
  if (typeof b.taxAmount !== 'number') errors.push('taxAmount must be a number');
  if (typeof b.total !== 'number') errors.push('total must be a number');
  if (typeof b.receiptPresent !== 'boolean') errors.push('receiptPresent must be a boolean');
  if (typeof b.date !== 'string' || !b.date) errors.push('date is required');
  // `notes` is free text that reaches the LLM prompt verbatim (gemini-provider.ts) — the prompt
  // itself instructs the model to treat it as untrusted, but bounding its length here is a cheap
  // additional technical control, not just a verbal one, against a submitter trying to pad it
  // with steering text.
  if (b.notes !== undefined && (typeof b.notes !== 'string' || b.notes.length > 2048)) {
    errors.push('notes must be a string of at most 2048 characters');
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, invoice: b as unknown as Invoice };
}
