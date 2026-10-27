import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-flight-blue text-white shadow-sm hover:bg-brand-700 active:bg-istari-blue ' +
    'disabled:bg-ink-200 disabled:text-ink-400 disabled:shadow-none',
  secondary:
    'bg-white text-ink-700 border border-ink-300 shadow-sm hover:bg-ink-50 hover:text-apple-black ' +
    'disabled:border-ink-200 disabled:bg-ink-50 disabled:text-ink-400 disabled:shadow-none',
  danger:
    'bg-white text-danger border border-danger/30 shadow-sm hover:bg-danger-soft ' +
    'disabled:border-ink-200 disabled:bg-ink-50 disabled:text-ink-400 disabled:shadow-none',
  ghost: 'bg-transparent text-flight-blue hover:bg-cloud-blue/60 hover:text-istari-blue disabled:text-ink-400',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-digital-blue focus-visible:ring-offset-2
        disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner size="sm" tone={variant === 'primary' ? 'inverse' : 'brand'} />}
      {children}
    </button>
  );
}
