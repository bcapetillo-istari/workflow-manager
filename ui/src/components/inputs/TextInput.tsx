import { controlClasses } from '../ui/Field';
import type { InputComponentProps } from '../../renderer/types';

export function TextInput({ id, input, value, onChange, disabled, invalid }: InputComponentProps) {
  const text = typeof value === 'string' ? value : '';
  const filter = input.filter;
  const common = {
    id,
    name: input.key,
    value: text,
    disabled,
    maxLength: filter?.max_length,
    'aria-invalid': invalid,
    'aria-describedby': input.help ? `${id}-help` : undefined,
    placeholder: input.help ? undefined : input.label,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value === '' ? undefined : e.target.value),
  };
  if (filter?.multiline) return <textarea rows={4} className={`${controlClasses} resize-y`} {...common} />;
  return <input type={input.secret ? 'password' : 'text'} className={controlClasses} {...common} />;
}
