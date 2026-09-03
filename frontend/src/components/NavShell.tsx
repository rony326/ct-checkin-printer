import { NavLink, Outlet } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Status', end: true },
  { to: '/layouts', label: 'Etiketten-Layouts' },
  { to: '/printers', label: 'Drucker' },
  { to: '/churchtools', label: 'ChurchTools' },
  { to: '/webhooks', label: 'Webhooks' },
  { to: '/document-printers', label: 'Sammelausdruck-Drucker' },
  { to: '/settings', label: 'Einstellungen' },
];

export function NavShell() {
  return (
    <div style={{ display: 'flex', minHeight: '100%' }}>
      <nav
        style={{
          width: 200,
          flexShrink: 0,
          borderRight: '1px solid var(--line)',
          background: 'var(--surface)',
          padding: '1.25rem 0.75rem',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '1.25rem', padding: '0 0.5rem' }}>ct-checkin-printer</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={({ isActive }) => ({
                padding: '0.5rem 0.6rem',
                borderRadius: 4,
                fontSize: '0.85rem',
                textDecoration: 'none',
                color: isActive ? 'var(--accent-ink)' : 'var(--ink)',
                background: isActive ? 'var(--accent)' : 'transparent',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Outlet />
      </div>
    </div>
  );
}
