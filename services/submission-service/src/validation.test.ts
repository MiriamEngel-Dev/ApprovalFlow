import { describe, expect, it } from 'vitest';
import { validateInvoice } from './validation.js';

const VALID_BODY = {
  vendor: 'Bistro 19',
  vendorKnown: true,
  invoiceNumber: 'NW-INV-7781',
  currency: 'USD',
  category: 'meals',
  department: 'engineering-2026Q2',
  submitter: 'dana.cohen@northwind.example',
  lineItems: [{ description: 'Team lunch', quantity: 1, unitPrice: 38.89 }],
  taxAmount: 3.11,
  total: 42.0,
  receiptPresent: true,
  date: '2026-05-12',
};

describe('validateInvoice — notes length bound (M15 prompt-injection hardening)', () => {
  it('accepts a missing notes field', () => {
    const result = validateInvoice(VALID_BODY);
    expect(result.valid).toBe(true);
  });

  it('accepts notes within the 2048-char bound', () => {
    const result = validateInvoice({ ...VALID_BODY, notes: 'Solo working lunch.' });
    expect(result.valid).toBe(true);
  });

  it('rejects notes over 2048 characters', () => {
    const result = validateInvoice({ ...VALID_BODY, notes: 'a'.repeat(2049) });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes('notes'))).toBe(true);
    }
  });

  it('rejects a non-string notes value', () => {
    const result = validateInvoice({ ...VALID_BODY, notes: 12345 });
    expect(result.valid).toBe(false);
  });
});

describe('validateInvoice — trims free-text fields (F3 dedup / fixture-lookup safety)', () => {
  it('trims leading/trailing whitespace from vendor and invoiceNumber', () => {
    const result = validateInvoice({
      ...VALID_BODY,
      vendor: '  Bistro 19  ',
      invoiceNumber: ' NW-INV-7781\n',
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.invoice.vendor).toBe('Bistro 19');
      expect(result.invoice.invoiceNumber).toBe('NW-INV-7781');
    }
  });

  it('still rejects a vendor that is only whitespace', () => {
    const result = validateInvoice({ ...VALID_BODY, vendor: '   ' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes('vendor'))).toBe(true);
    }
  });
});
