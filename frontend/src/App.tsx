import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { NavShell } from './components/NavShell.js';
import { Login } from './pages/Login.js';
import { Dashboard } from './pages/Dashboard.js';
import { LayoutList } from './pages/LayoutList.js';
import { LayoutEditor } from './pages/LayoutEditor.js';
import { PrinterList } from './pages/PrinterList.js';
import { PrinterCreate } from './pages/PrinterCreate.js';
import { PrinterDetail } from './pages/PrinterDetail.js';
import { ChurchToolsSettings } from './pages/ChurchToolsSettings.js';
import { Webhooks } from './pages/Webhooks.js';
import { DocumentPrinters } from './pages/DocumentPrinters.js';
import { AppConfigSettings } from './pages/AppConfigSettings.js';
import { SummaryLayouts } from './pages/SummaryLayouts.js';
import { AUTH_EXPIRED_EVENT } from './api/client.js';

type AuthStatus = { setupRequired: boolean; authenticated: boolean };

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  async function refreshStatus() {
    try {
      const res = await fetch('/api/auth/status');
      if (!res.ok) throw new Error(String(res.status));
      setStatus(await res.json());
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    }
  }

  useEffect(() => {
    refreshStatus();
    // Abgelaufene Sitzung: zurück zur Anmeldung statt Fehlermeldungen auf jeder Seite.
    const onExpired = () => refreshStatus();
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  if (unreachable && !status) {
    return (
      <main className="login">
        <div className="panel login-card" role="alert">
          <h1>Server nicht erreichbar</h1>
          <p className="hint">Der Dienst antwortet gerade nicht. Läuft der Container?</p>
          <button className="btn btn-primary" onClick={refreshStatus}>
            Erneut versuchen
          </button>
        </div>
      </main>
    );
  }
  if (!status) return null;
  if (status.setupRequired) return <Login mode="setup" onSuccess={refreshStatus} />;
  if (!status.authenticated) return <Login mode="login" onSuccess={refreshStatus} />;

  return (
    <Routes>
      <Route element={<NavShell onLoggedOut={refreshStatus} />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/layouts" element={<LayoutList />} />
        <Route path="/layouts/:id" element={<LayoutEditor />} />
        <Route path="/printers" element={<PrinterList />} />
        <Route path="/printers/new" element={<PrinterCreate />} />
        <Route path="/printers/:id" element={<PrinterDetail />} />
        <Route path="/churchtools" element={<ChurchToolsSettings />} />
        <Route path="/webhooks" element={<Webhooks />} />
        <Route path="/document-printers" element={<DocumentPrinters />} />
        <Route path="/summary-layouts" element={<SummaryLayouts />} />
        <Route path="/settings" element={<AppConfigSettings />} />
      </Route>
    </Routes>
  );
}
