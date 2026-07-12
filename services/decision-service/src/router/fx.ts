import type { Invoice, NormalizedInvoice } from '@approvalflow/shared';

/** Static rate table — matches `sample-invoices.json`'s `fxRates` (M15: no paid FX API). */
const FX_RATES: Record<string, number> = {
  EUR: 1.08,
  GBP: 1.27,
};

/**
 * Converts an amount to USD. An unknown currency deliberately returns +Infinity rather than a
 * silent 1:1 default, so it always trips the GLOBAL-FX hard stop instead of slipping through.
 */
export function convertToUsd(currency: string, amount: number): number {
  if (currency === 'USD') return amount;
  const rate = FX_RATES[currency];
  if (rate === undefined) return Number.POSITIVE_INFINITY;
  return amount * rate;
}

export function normalizeInvoice(invoice: Invoice): NormalizedInvoice {
  return { ...invoice, convertedTotal: convertToUsd(invoice.currency, invoice.total) };
}
