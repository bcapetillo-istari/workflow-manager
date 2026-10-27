import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCurrentUser } from './useCurrentUser';

const logoUrl = `${import.meta.env.BASE_URL}brand/istari-logo-white.svg`;

/** Header nav: white/70 at rest, white with a Digital Blue underline when active. */
const navClass = ({ isActive }: { isActive: boolean }) =>
  `relative flex h-14 items-center px-1 text-sm font-medium transition-colors
   focus:outline-none focus-visible:ring-2 focus-visible:ring-digital-blue focus-visible:ring-offset-2 focus-visible:ring-offset-istari-blue
   after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-t-sm after:transition-colors ${
     isActive ? 'text-white after:bg-digital-blue' : 'text-white/70 after:bg-transparent hover:text-white'
   }`;

export function AppShell() {
  const auth = useAuth();
  const user = useCurrentUser();
  const userLabel = user.data?.displayName ?? user.data?.email ?? (user.isPending ? '…' : 'Signed in');

  return (
    <div className="min-h-screen bg-ink-50 text-apple-black">
      <header className="sticky top-0 z-10 bg-istari-blue text-white shadow-[0_1px_0_rgb(255_255_255/0.08),0_1px_3px_rgb(18_18_18/0.2)]">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-6">
          <div className="flex min-w-0 items-center gap-6">
            <NavLink
              to="/"
              className="flex shrink-0 items-center gap-3 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-digital-blue focus-visible:ring-offset-2 focus-visible:ring-offset-istari-blue"
              aria-label="Istari Digital Workflow Manager, home"
            >
              <img src={logoUrl} alt="Istari Digital" className="h-7 w-auto" draggable={false} />
              <span className="h-6 w-px bg-white/25" aria-hidden="true" />
              <span className="font-heading text-[15px] font-semibold tracking-tight text-white">
                Workflow Manager
              </span>
            </NavLink>
            <nav aria-label="Primary" className="flex items-center gap-5">
              <NavLink to="/" end className={navClass}>
                Workflows
              </NavLink>
              <NavLink to="/runs" className={navClass}>
                Runs
              </NavLink>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs">
            {auth.provider.kind === 'dev-token' && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-warning-soft/40 bg-warning-soft/15 px-2 py-0.5 text-[11px] font-medium text-warning-soft"
                title="Development authentication: a pasted bearer token"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-warning-soft" aria-hidden="true" />
                dev auth
              </span>
            )}
            <span className="hidden max-w-[16rem] truncate text-white/80 sm:inline" title={user.data?.email}>
              {userLabel}
            </span>
            <button
              type="button"
              onClick={auth.signOut}
              className="rounded-md px-2 py-1 font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white
                focus:outline-none focus-visible:ring-2 focus-visible:ring-digital-blue focus-visible:ring-offset-2 focus-visible:ring-offset-istari-blue"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
