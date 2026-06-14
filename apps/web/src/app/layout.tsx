/**
 * App shell (HELIX-175): the header + nav that wraps every authenticated screen, with the
 * signed-in principal and a sign-out action. Screens render into the {@link Outlet}.
 */
import { type ReactElement } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/approvals', label: 'Approvals' },
  { to: '/integrations', label: 'Integrations' },
];

export function Layout(): ReactElement {
  const { principal, signOut } = useAuth();
  const { pathname } = useLocation();

  return (
    <div className="helix-shell">
      <header className="helix-header">
        <span className="helix-brand">Helix</span>
        <nav className="helix-nav" aria-label="Primary">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} aria-current={pathname === item.to ? 'page' : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="helix-user">
          {principal && (
            <span className="helix-principal">
              {principal.email ?? principal.userId} · {principal.org}
            </span>
          )}
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="helix-main">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
