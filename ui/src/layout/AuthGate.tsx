import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../pages/SignIn';

/** Shows the credential box until a token is present. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { signedIn } = useAuth();
  return signedIn ? <>{children}</> : <SignIn />;
}
