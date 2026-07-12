import { useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { clearToken, decodeToken, getToken } from './auth.js';
import { LoginScreen } from './pages/LoginScreen.js';
import { Submit } from './pages/Submit.js';
import { Status } from './pages/Status.js';
import { Queue } from './pages/Queue.js';
import { Dashboard } from './pages/Dashboard.js';
import { MySubmissions } from './pages/MySubmissions.js';

export function App() {
  const [token, setTokenState] = useState(getToken());
  const claims = token ? decodeToken(token) : null;

  if (!token || !claims) {
    return <LoginScreen onLoggedIn={() => setTokenState(getToken())} />;
  }

  const logOut = (): void => {
    clearToken();
    setTokenState(null);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <div className="brand">
            <div className="brand-mark">AF</div>
            <h1>ApprovalFlow</h1>
          </div>
          <nav className="app-nav">
            <Link className="nav-link" to="/">
              Submit
            </Link>
            {claims.role === 'submitter' && (
              <Link className="nav-link" to="/my-submissions">
                My submissions
              </Link>
            )}
            <Link className="nav-link" to="/queue">
              Queue
            </Link>
            <Link className="nav-link" to="/dashboard">
              Dashboard
            </Link>
          </nav>
        </div>
        <div className="user-chip">
          <span>
            <strong>{claims.sub}</strong> · {claims.role}
          </span>
          <button className="link" onClick={logOut}>
            Log out
          </button>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<Submit />} />
        <Route path="/my-submissions" element={<MySubmissions />} />
        <Route path="/status/:trackingId" element={<Status />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </div>
  );
}
