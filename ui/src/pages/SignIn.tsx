import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Button, Card } from '../components/ui';
import { controlClasses } from '../components/ui/Field';

const logoUrl = `${import.meta.env.BASE_URL}brand/istari-logo.svg`;

export function SignIn() {
  const { signIn } = useAuth();
  const [token, setToken] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (signIn && token.trim()) signIn(token);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={logoUrl} alt="Istari Digital" className="mb-5 h-8 w-auto" draggable={false} />
          <h1 className="font-heading text-xl font-semibold tracking-tight text-istari-blue">
            Sign in to Workflow Manager
          </h1>
        </div>
        <Card className="flex flex-col gap-4">
          <div
            role="note"
            className="flex gap-2.5 rounded-md bg-warning-soft px-3 py-2.5 text-xs leading-5 text-warning"
          >
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
            <p>
              <strong className="font-semibold">Development authentication:</strong> paste an Istari bearer
              token. Not for production.
            </p>
          </div>
          {signIn ? (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="dev-token" className="text-sm font-medium text-ink-700">
                  Istari bearer token
                </label>
                <textarea
                  id="dev-token"
                  name="token"
                  rows={4}
                  autoComplete="off"
                  spellCheck={false}
                  className={`${controlClasses} resize-y font-mono text-xs`}
                  placeholder="eyJhbGciOi…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={!token.trim()} className="w-full">
                Use token
              </Button>
            </form>
          ) : (
            <p className="text-sm text-ink-600">Redirecting to sign in…</p>
          )}
        </Card>
        <p className="mt-6 text-center text-xs text-ink-500">Workflow Manager runs beside the Istari platform.</p>
      </div>
    </div>
  );
}
