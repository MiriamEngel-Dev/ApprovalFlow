import { useEffect, useState } from 'react';
import { getToken, decodeToken } from '../auth.js';
import { getQueue, approve, reject, requestInfo, ApiError, type QueueItem } from '../api.js';

// F4/F5: escalated items with the agent's own recommendation/confidence/cited rules, plus the 3
// resolution actions. Polls every 10s; re-fetches immediately after any action instead of waiting
// for the next tick.
export function Queue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const token = getToken();
  const claims = token ? decodeToken(token) : null;

  const fetchQueue = async (): Promise<void> => {
    try {
      const data = await getQueue();
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the queue.');
    }
  };

  useEffect(() => {
    void fetchQueue();
    const timer = window.setInterval(() => void fetchQueue(), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const runAction = async (action: () => Promise<unknown>, queueId: string): Promise<void> => {
    setBusyId(queueId);
    try {
      await action();
      await fetchQueue();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <h2>Approval queue</h2>
      {error && <p className="error-text">{error}</p>}
      {items.length === 0 && <p className="muted">No pending items.</p>}
      {items.map((item) => {
        const approverId = claims?.sub ?? 'unknown';
        const busy = busyId === item.queueId;
        return (
          <div key={item.queueId} className="card">
            <p className="muted">
              Submission <code>{item.submissionId}</code>
            </p>
            <p>
              <strong>{item.submitter}</strong> — {item.department} — ${item.amount}
            </p>
            <p>
              Agent recommendation:{' '}
              <span className="badge badge-neutral">{item.agentRecommendation ?? '—'}</span>{' '}
              <span className="muted">confidence {item.agentConfidence?.toFixed(2) ?? '—'}</span>
            </p>
            {item.agentReasoning && <p>{item.agentReasoning}</p>}
            {item.rulesCited && item.rulesCited.length > 0 && (
              <p className="muted">Rules cited: {item.rulesCited.join(', ')}</p>
            )}
            {item.violations && item.violations.length > 0 && (
              <p className="muted">Violations: {item.violations.map((v) => v.ruleId).join(', ')}</p>
            )}
            <div className="button-row" style={{ marginTop: '0.75rem' }}>
              <button
                disabled={busy}
                onClick={() =>
                  void runAction(() => approve(item.queueId, approverId), item.queueId)
                }
              >
                Approve
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => void runAction(() => reject(item.queueId, approverId), item.queueId)}
              >
                Reject
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  const note = window.prompt('What information is needed?');
                  if (note) void runAction(() => requestInfo(item.queueId, note), item.queueId);
                }}
              >
                Request info
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
