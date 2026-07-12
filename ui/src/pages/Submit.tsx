import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Category } from '@approvalflow/shared';
import { submit, ApiError, type SubmitResponse } from '../api.js';

const CATEGORIES: Category[] = ['meals', 'saas', 'travel', 'hardware', 'other'];

// F1: the practical subset of Invoice needed for a usable form — the backend's validation.ts is
// the real gate, this is just enough to not send obviously-broken input.
export function Submit() {
  const [vendor, setVendor] = useState('');
  const [vendorKnown, setVendorKnown] = useState(true);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [category, setCategory] = useState<Category>('other');
  const [department, setDepartment] = useState('');
  const [submitter, setSubmitter] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [taxAmount, setTaxAmount] = useState('0');
  const [receiptPresent, setReceiptPresent] = useState(true);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [attendees, setAttendees] = useState('1');

  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const qty = Number(quantity) || 0;
  const price = Number(unitPrice) || 0;
  const tax = Number(taxAmount) || 0;
  const total = qty * price + tax;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Trim free-text fields — a stray leading/trailing space (easy to introduce via
      // copy-paste) would otherwise silently break the vendor+invoiceNumber dedup match (F3) and
      // any fixture lookup keyed on exact string equality, making an already-seen invoice look
      // brand new. The backend trims too (defense in depth for non-UI callers), but catching it
      // here means the invoice actually submitted matches what's shown on screen.
      const response = await submit({
        vendor: vendor.trim(),
        vendorKnown,
        invoiceNumber: invoiceNumber.trim(),
        currency: currency.trim(),
        category,
        department: department.trim(),
        submitter: submitter.trim(),
        lineItems: [{ description: description.trim(), quantity: qty, unitPrice: price }],
        taxAmount: tax,
        total,
        receiptPresent,
        date,
        ...(notes ? { notes: notes.trim() } : {}),
        ...(category === 'saas' ? { billingPeriod } : {}),
        ...(category === 'meals' ? { attendees: Number(attendees) || 1 } : {}),
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submission failed.');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="card" style={{ maxWidth: 480 }}>
        <h2>Submitted</h2>
        <p>
          Tracking ID: <code>{result.trackingId}</code>
        </p>
        <p>
          Correlation ID: <code>{result.correlationId}</code>
        </p>
        {result.status === 'duplicate' && (
          <p className="muted">This looks like a duplicate of a prior submission.</p>
        )}
        <div className="button-row" style={{ marginTop: '1rem' }}>
          <Link to={`/status/${result.trackingId}`}>
            <button>View status →</button>
          </Link>
          <Link to="/my-submissions">
            <button className="secondary">My submissions</button>
          </Link>
          <button className="secondary" onClick={() => setResult(null)}>
            Submit another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>Submit an invoice</h2>
      <form onSubmit={handleSubmit} className="form-grid">
        <div className="field">
          <label>Vendor</label>
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} required />
        </div>
        <div className="field field-check">
          <input
            id="vendor-known"
            type="checkbox"
            checked={vendorKnown}
            onChange={(e) => setVendorKnown(e.target.checked)}
          />
          <label htmlFor="vendor-known">Vendor is known</label>
        </div>
        <div className="field">
          <label>Invoice number</label>
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Currency</label>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            required
          />
        </div>
        <div className="field">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {category === 'saas' && (
          <div className="field">
            <label>Billing period</label>
            <select
              value={billingPeriod}
              onChange={(e) => setBillingPeriod(e.target.value as 'monthly' | 'annual')}
            >
              <option value="monthly">monthly</option>
              <option value="annual">annual</option>
            </select>
          </div>
        )}
        {category === 'meals' && (
          <div className="field">
            <label>Attendees</label>
            <input
              type="number"
              min={1}
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
            />
          </div>
        )}
        <div className="field">
          <label>Department</label>
          <input value={department} onChange={(e) => setDepartment(e.target.value)} required />
        </div>
        <div className="field">
          <label>Submitter</label>
          <input value={submitter} onChange={(e) => setSubmitter(e.target.value)} required />
        </div>
        <div className="field">
          <label>Line item description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} required />
        </div>
        <div className="field">
          <label>Quantity</label>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Unit price</label>
          <input
            type="number"
            step="0.01"
            min={0}
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Tax amount</label>
          <input
            type="number"
            step="0.01"
            min={0}
            value={taxAmount}
            onChange={(e) => setTaxAmount(e.target.value)}
          />
        </div>
        <div className="card" style={{ padding: '0.75rem 1rem' }}>
          Total: <strong>{total.toFixed(2)}</strong> {currency}
        </div>
        <div className="field field-check">
          <input
            id="receipt-present"
            type="checkbox"
            checked={receiptPresent}
            onChange={(e) => setReceiptPresent(e.target.checked)}
          />
          <label htmlFor="receipt-present">Receipt present</label>
        </div>
        <div className="field">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="field">
          <label>Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2048} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit'}
        </button>
      </form>
    </div>
  );
}
