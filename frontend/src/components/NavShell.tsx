import { NavLink, Outlet } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

/** Nach Aufgabe gruppiert: was zusammengehört, steht beieinander. */
const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  { label: 'Übersicht', items: [{ to: '/', label: 'Status', end: true }] },
  {
    label: 'Etiketten',
    items: [
      { to: '/layouts', label: 'Etiketten-Layouts' },
      { to: '/printers', label: 'Drucker' },
    ],
  },
  {
    label: 'Sammelausdruck',
    items: [
      { to: '/summary-layouts', label: 'Sammelausdrucke' },
      { to: '/document-printers', label: 'A4-Drucker' },
    ],
  },
  {
    label: 'Verbindungen',
    items: [
      { to: '/churchtools', label: 'ChurchTools' },
      { to: '/webhooks', label: 'Webhooks' },
    ],
  },
  { label: 'System', items: [{ to: '/settings', label: 'Einstellungen' }] },
];

export function NavShell({ onLoggedOut }: { onLoggedOut: () => void }) {
  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    onLoggedOut();
  }

  return (
    <div className="shell">
      <nav className="nav" aria-label="Hauptnavigation">
        <div className="nav-brand">ct-checkin-printer</div>
        <div className="nav-groups">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label} role="group" aria-label={group.label}>
              <div className="nav-group-label" aria-hidden="true">
                {group.label}
              </div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
        <div className="nav-footer">
          <button type="button" className="nav-logout" onClick={handleLogout}>
            Abmelden
          </button>
        </div>
      </nav>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
