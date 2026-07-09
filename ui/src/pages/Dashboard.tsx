import { useEffect, useState } from 'react';
import { getDashboard, ApiError, type DashboardStats } from '../api.js';

const ROUTE_COLORS: Record<string, string> = {
  auto_approve: '#2b8a3e',
  human_review: '#e8590c',
  reject: '#c92a2a',
  duplicate: '#4263eb',
};

// F8: stat tiles + a small bar chart of byRoute counts. No charting dependency — 4 static bars is
// simple enough for inline SVG, and pulling in a library for one chart would contradict this
// project's "minimal, no global state library" signal.
export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDashboard()
      .then(setStats)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load dashboard.'),
      );
  }, []);

  if (error) return <p className="error-text">{error}</p>;
  if (!stats) return <p className="muted">Loading…</p>;

  const autoApprovalRate = stats.totalDecisions
    ? ((stats.byRoute.auto_approve ?? 0) / stats.totalDecisions) * 100
    : 0;

  const routes = Object.entries(stats.byRoute);
  const maxCount = Math.max(1, ...routes.map(([, count]) => count));
  const barHeight = 22;
  const gap = 14;
  const chartWidth = 360;

  return (
    <div>
      <h2>Dashboard</h2>
      <div className="tiles">
        <Tile label="Total submissions" value={String(stats.totalDecisions)} />
        <Tile label="Auto-approval %" value={`${autoApprovalRate.toFixed(1)}%`} />
        <Tile label="Auto-approved amount" value={`$${stats.moneyAutoApproved.toFixed(2)}`} />
        <Tile label="Human-approved amount" value={`$${stats.moneyHumanApproved.toFixed(2)}`} />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Decisions by route</h3>
        {routes.length === 0 ? (
          <p className="muted">No decisions yet.</p>
        ) : (
          <svg
            width={chartWidth}
            height={routes.length * (barHeight + gap)}
            role="img"
            aria-label="Bar chart of decisions by route"
          >
            {routes.map(([route, count], i) => {
              const width = (count / maxCount) * (chartWidth - 120);
              const y = i * (barHeight + gap);
              return (
                <g key={route}>
                  <text x={0} y={y + barHeight / 2 + 4} fontSize={12} fill="#1a1d23">
                    {route}
                  </text>
                  <rect
                    x={100}
                    y={y}
                    width={Math.max(width, 2)}
                    height={barHeight}
                    rx={5}
                    fill={ROUTE_COLORS[route] ?? '#868e96'}
                  />
                  <text x={104 + width} y={y + barHeight / 2 + 4} fontSize={12} fill="#1a1d23">
                    {count}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
    </div>
  );
}
