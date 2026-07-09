import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMySubmissions, ApiError, type MySubmissionRow } from '../api.js';
import { badgeClassFor } from '../statusBadge.js';

// F2's own history, server-backed (queried by the logged-in name's own `sub` claim, not a
// browser-local list) — fixes the gap found live-testing: once you leave the Submit page's
// one-off confirmation, there was no way back to a prior submission's status.
export function MySubmissions() {
  const [rows, setRows] = useState<MySubmissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      const data = await getMySubmissions();
      setRows(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your submissions.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>My submissions</h2>
        <button className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {rows && rows.length === 0 && <p className="muted">You haven't submitted anything yet.</p>}
      {rows?.map((row) => (
        <div key={row.id} className="card">
          <p>
            <strong>{row.vendor}</strong> — {row.invoiceNumber}
          </p>
          <p className="muted">
            {row.total} {row.currency} · {new Date(row.createdAt).toLocaleString()}
          </p>
          <p>
            <span className={`badge ${badgeClassFor(row.status)}`}>{row.status}</span>
          </p>
          <p className="muted">{row.reason}</p>
          <Link to={`/status/${row.trackingId}`}>
            <button className="secondary">View status →</button>
          </Link>
        </div>
      ))}
    </div>
  );
}
