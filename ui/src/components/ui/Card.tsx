import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padded?: boolean;
  /** Elevate slightly on hover: for cards that act as links or contain a primary action. */
  interactive?: boolean;
}

export function Card({ children, padded = true, interactive = false, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-ink-200 bg-white shadow-[var(--shadow-card)]
        ${interactive ? 'transition-shadow hover:shadow-md hover:border-ink-300' : ''}
        ${padded ? 'p-5' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h3 className={`font-sans text-base font-semibold text-apple-black ${className}`}>{children}</h3>;
}
