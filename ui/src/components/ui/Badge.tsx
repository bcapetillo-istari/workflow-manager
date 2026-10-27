import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' | 'muted';

/** Soft pills: tinted background, darker text of the same hue. Blues lead; status colors stay desaturated. */
const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  muted: 'bg-ink-100 text-ink-500',
  info: 'bg-cloud-blue text-istari-blue',
  accent: 'bg-cloud-blue text-istari-blue',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium leading-5 whitespace-nowrap
        ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
