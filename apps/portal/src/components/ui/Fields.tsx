'use client';
/**
 * Campos de formulário. Todo campo liga rótulo, dica e erro por id/aria-describedby e marca
 * aria-invalid. O erro tem ícone + texto (estado nunca só por cor).
 */
import { Eye, EyeSlash, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import { useId, useState, type ChangeEvent, type ComponentProps, type ReactNode } from 'react';
import { Checkbox } from './shadcn/checkbox';
import { Input } from './shadcn/input';
import { Label } from './shadcn/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './shadcn/select';
import { Switch } from './shadcn/switch';
import { Textarea } from './shadcn/textarea';

export interface FieldMeta {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
}

/** Atributos que o controle recebe para ficar ligado ao rótulo, à dica e ao erro. */
export interface ControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

function useControlProps({ hint, error, required }: Omit<FieldMeta, 'label'>, idProp?: string) {
  const auto = useId();
  const id = idProp ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control: ControlProps = {
    id,
    'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
  };
  return { id, hintId, errorId, control };
}

function Hint({ id, children }: { id?: string; children: ReactNode }) {
  return <p id={id} className="text-xs text-muted">{children}</p>;
}

function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1 text-xs font-medium text-danger">
      <WarningCircle size={14} weight="fill" aria-hidden className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Estrutura comum: rótulo, controle (render prop), dica e erro. */
export function Field({ label, hint, error, required, id: idProp, className = '', children }: FieldMeta & {
  id?: string;
  className?: string;
  children: (control: ControlProps) => ReactNode;
}) {
  const { id, hintId, errorId, control } = useControlProps({ hint, error, required }, idProp);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
        {required && <span className="font-normal text-muted"> (obrigatório)</span>}
      </Label>
      {children(control)}
      {hint && <Hint id={hintId}>{hint}</Hint>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

type InputProps = Omit<ComponentProps<'input'>, 'id'> & FieldMeta & { id?: string };

export function TextInput({ label, hint, error, required, id, className, ...rest }: InputProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id}>
      {(c) => <Input {...c} required={undefined} className={className} {...rest} />}
    </Field>
  );
}

/**
 * Senha com botão de mostrar/ocultar. O valor continua só no campo (nada em estado da tela); o botão
 * só troca o `type`. `aria-pressed` diz se a senha está visível.
 */
export function PasswordInput({ label, hint, error, required, id, className = '', ...rest }: Omit<InputProps, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id}>
      {(c) => (
        <div className="relative">
          <Input {...c} required={undefined} type={visible ? 'text' : 'password'} className={`pr-11 ${className}`} {...rest} />
          <button
            type="button"
            aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={visible}
            aria-controls={c.id}
            onClick={() => setVisible((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-md text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
          >
            {visible ? <EyeSlash size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
          </button>
        </div>
      )}
    </Field>
  );
}

export function DateInput(props: Omit<InputProps, 'type'>) {
  return <TextInput {...props} type="date" />;
}

export function TimeInput(props: Omit<InputProps, 'type'>) {
  return <TextInput {...props} type="time" />;
}

export function TextArea({ label, hint, error, required, id, className, ...rest }: Omit<ComponentProps<'textarea'>, 'id'> & FieldMeta & { id?: string }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id}>
      {(c) => <Textarea {...c} className={className} {...rest} />}
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** Select do shadcn. Controlado: `value` vazio mostra o `placeholder`. */
export function SelectField({ label, hint, error, required, id, value, onValueChange, options, placeholder = 'Selecione', disabled, name }: FieldMeta & {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id}>
      {(c) => (
        <Select value={value} onValueChange={onValueChange} disabled={disabled} name={name} required={required}>
          <SelectTrigger {...c} className="h-10 w-full">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent position="popper">
            {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.ceil(bytes / 1024)} KB`);

/** Arquivo único. Recusa na hora o que passa de `maxBytes` (a api valida de novo). */
export function FileInput({ label, hint, error, required, id, accept, maxBytes, capture, onFile, disabled }: FieldMeta & {
  id?: string;
  accept?: string;
  maxBytes?: number;
  capture?: 'user' | 'environment';
  onFile: (file: File | null) => void;
  disabled?: boolean;
}) {
  const [localError, setLocalError] = useState<string | undefined>();
  const [name, setName] = useState<string | undefined>();
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file && maxBytes !== undefined && file.size > maxBytes) {
      setLocalError(`O arquivo passa do limite de ${formatSize(maxBytes)}.`);
      setName(undefined);
      e.target.value = '';
      onFile(null);
      return;
    }
    setLocalError(undefined);
    setName(file?.name);
    onFile(file);
  };
  const hintText = hint ?? (maxBytes !== undefined ? `Tamanho máximo: ${formatSize(maxBytes)}.` : undefined);
  return (
    <Field label={label} hint={hintText} error={localError ?? error} required={required} id={id}>
      {(c) => (
        <>
          <Input {...c} type="file" accept={accept} capture={capture} disabled={disabled} onChange={onChange} className="h-auto py-2" />
          {name && <p className="text-xs text-ink-2">Selecionado: {name}</p>}
        </>
      )}
    </Field>
  );
}

/** Caixa de seleção com rótulo ao lado. */
export function CheckboxField({ label, hint, error, id: idProp, checked, onCheckedChange, disabled, name }: Omit<FieldMeta, 'required'> & {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
}) {
  const { id, hintId, errorId, control } = useControlProps({ hint, error }, idProp);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Checkbox {...control} id={id} name={name} disabled={disabled} checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} />
        <Label htmlFor={id} className="text-sm font-medium text-ink">{label}</Label>
      </div>
      {hint && <Hint id={hintId}>{hint}</Hint>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/** Interruptor (role=switch) com rótulo ao lado. */
export function SwitchField({ label, hint, error, id: idProp, checked, onCheckedChange, disabled, name }: Omit<FieldMeta, 'required'> & {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
}) {
  const { id, hintId, errorId, control } = useControlProps({ hint, error }, idProp);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Switch {...control} id={id} name={name} disabled={disabled} checked={checked} onCheckedChange={onCheckedChange} />
        <Label htmlFor={id} className="text-sm font-medium text-ink">{label}</Label>
      </div>
      {hint && <Hint id={hintId}>{hint}</Hint>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/** Busca. O `label` vira o nome acessível (não há rótulo visível). */
export function SearchInput({ label, className = '', ...rest }: Omit<ComponentProps<'input'>, 'type' | 'aria-label'> & { label: string }) {
  return (
    <div className={`relative ${className}`}>
      <MagnifyingGlass size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <Input type="search" aria-label={label} className="h-10 pl-9" {...rest} />
    </div>
  );
}
