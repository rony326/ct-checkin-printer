import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { NavShell } from './components/NavShell.js';
import { Login } from './pages/Login.js';
import { LayoutList } from './pages/LayoutList.js';
import { LayoutEditor } from './pages/LayoutEditor.js';
import { PrinterList } from './pages/PrinterList.js';
import { PrinterDetail } from './pages/PrinterDetail.js';
import { ChurchToolsSettings } from './pages/ChurchToolsSettings.js';
import { Webhooks } from './pages/Webhooks.js';
import { DocumentPrinters } from './pages/DocumentPrinters.js';

type AuthStatus = { setupRequired: boolean; authenticated: boolean };

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  async function refreshStatus() {
    const res = await fetch('/api/auth/status');
    setStatus(await res.json());
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  if (!status) return null;
  if (status.setupRequired) return <Login mode="setup" onSuccess={refreshStatus} />;
  if (!status.authenticated) return <Login mode="login" onSuccess={refreshStatus} />;

  return (
    <Routes>
      <Route element={<NavShell />}>
        <Route path="/" element={<Navigate to="/layouts" replace />} />
        <Route path="/layouts" element={<LayoutList />} />
        <Route path="/layouts/:id" element={<LayoutEditor />} />
        <Route path="/printers" element={<PrinterList />} />
        <Route path="/printers/:id" element={<PrinterDetail />} />
        <Route path="/churchtools" element={<ChurchToolsSettings />} />
        <Route path="/webhooks" element={<Webhooks />} />
        <Route path="/document-printers" element={<DocumentPrinters />} />
      </Route>
    </Routes>
  );
}
