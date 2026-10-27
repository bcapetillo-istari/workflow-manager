import { Button } from './Button';
import { AlertIcon } from './icons';

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unexpected error';
}

export function ErrorState({
  title = 'Something went wrong',
  error,
  onRetry,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-[var(--radius-card)] border border-danger/20 bg-danger-soft/60 px-5 py-4"
    >
      <AlertIcon size={18} className="mt-0.5 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-danger">{title}</p>
        {error !== undefined && <p className="mt-1 break-words text-sm text-ink-700">{errorMessage(error)}</p>}
        {onRetry && (
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
