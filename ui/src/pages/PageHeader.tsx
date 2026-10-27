import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-200 pb-5">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1.5 text-xs font-medium text-ink-500 [&_a]:text-flight-blue [&_a:hover]:underline">
            {eyebrow}
          </div>
        )}
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-istari-blue">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
