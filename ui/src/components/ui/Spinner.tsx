type Size = 'sm' | 'md' | 'lg';
type Tone = 'brand' | 'inverse';

const sizeClasses: Record<Size, string> = {
  sm: 'h-3.5 w-3.5 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-8 w-8 border-[3px]',
};

/** Digital Blue arc on a neutral track; `inverse` sits on a primary button. */
const toneClasses: Record<Tone, string> = {
  brand: 'border-ink-200 border-t-digital-blue',
  inverse: 'border-white/30 border-t-white',
};

export function Spinner({
  size = 'md',
  label = 'Loading',
  tone = 'brand',
}: {
  size?: Size;
  label?: string;
  tone?: Tone;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-block animate-spin rounded-full ${toneClasses[tone]} ${sizeClasses[size]}`}
    />
  );
}
