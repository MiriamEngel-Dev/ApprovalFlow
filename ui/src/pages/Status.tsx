import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getSubmissionById,
  getSubmissionByTracking,
  ApiError,
  type SubmissionStatus,
} from '../api.js';
import { badgeClassFor } from '../statusBadge.js';

const TERMINAL_STATUSES = new Set([
  'approved',
  'rejected',
  'reject',
  'duplicate',
  'payment_succeeded',
  'payment_failed',
]);

// F2: status + plain-language reason. Resolves the tracking id once (the backend 302-redirects
// tracking->id; fetch follows it and the response body carries the resolved `id`), then polls by
// id every 5s — avoids a redirect hop on every tick — until a terminal status.
export function Status() {
  const { trackingId } = useParams<{ trackingId: string }>();
  const [data, setData] = useState<SubmissionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!trackingId) return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async (): Promise<void> => {
      try {
        const result = idRef.current
          ? await getSubmissionById(idRef.current)
          : await getSubmissionByTracking(trackingId);
        if (cancelled) return;
        idRef.current = result.id;
        setData(result);
        setError(null);
        if (!TERMINAL_STATUSES.has(result.status)) {
          timer = window.setTimeout(() => void tick(), 5000);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not load status.');
        timer = window.setTimeout(() => void tick(), 5000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [trackingId]);

  if (error && !data) return <p className="error-text">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const isTerminal = TERMINAL_STATUSES.has(data.status);

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <h2>Status</h2>
      <p>
        Tracking ID: <code>{data.trackingId}</code>
      </p>
      <p>
        <span className={`badge ${badgeClassFor(data.status)}`}>{data.status}</span>{' '}
        {!isTerminal && <span className="muted">checking every 5s…</span>}
      </p>
      <p>{data.reason}</p>
      <p className="muted">Submitted: {new Date(data.submittedAt).toLocaleString()}</p>
    </div>
  );
}
