import { useState } from 'react';
import type { Role } from '@approvalflow/shared';
import { setToken } from '../auth.js';
import { login, ApiError } from '../api.js';

const ROLES: Role[] = ['submitter', 'approver', 'admin'];

interface Props {
  onLoggedIn: () => void;
}

// N1: this project has no real user accounts (self-signed role tokens only, "no external
// identity provider needed") — name is display-only, role is what the backend actually enforces.
export function LoginScreen({ onLoggedIn }: Props) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('submitter');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token } = await login(name, role);
      setToken(token);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed — is the backend running?');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <h1>ApprovalFlow</h1>
      <div className="card">
        <form onSubmit={handleSubmit} className="form-grid">
          <div className="field">
            <label htmlFor="login-name">Name</label>
            <input
              id="login-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dana"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="login-role">Role</label>
            <select id="login-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  );
}
