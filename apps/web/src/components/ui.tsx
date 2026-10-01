import {
  forwardRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes,
} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, ChevronDown, Copy, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn, copyText } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Botões
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'icon';

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none whitespace-nowrap';
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'border border-border-strong bg-surface text-fg hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-danger text-white hover:opacity-90',
};
const buttonSizes: Record<ButtonSize, string> = { sm: 'h-8 px-3 text-[13px]', md: 'h-9 px-4', icon: 'h-8 w-8' };

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }
>(function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...props }, ref) {
  return (
    <button ref={ref} type="button" disabled={disabled || loading} className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)} {...props}>
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

const fieldBase =
  'w-full rounded-lg border border-border-strong bg-surface px-3 text-fg placeholder:text-faint transition-colors focus:border-accent focus:outline-2 focus:outline-accent/30 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...props }, ref,
) {
  return <input ref={ref} className={cn(fieldBase, 'h-9', invalid && 'border-danger', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; mono?: boolean }>(
  function Textarea({ className, invalid, mono, ...props }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, 'py-2', mono && 'font-mono text-[12.5px]', invalid && 'border-danger', className)} {...props} />;
  },
);

export function Field({
  label, hint, error, children, className, required,
}: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="flex items-center gap-1 text-[13px] font-medium text-fg">
        {label}
        {required && <span className="text-danger">*</span>}
      </span>
      {children}
      {error ? <span className="block text-[12px] text-danger">{error}</span> : hint ? <span className="block text-[12px] text-muted">{hint}</span> : null}
    </label>
  );
}

export interface Option {
  value: string;
  label: ReactNode;
  hint?: string;
}

export function Select({
  value, onValueChange, options, placeholder = 'Selecione…', className, disabled, invalid,
}: {
  value: string | undefined;
  onValueChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <SelectPrimitive.Root value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        className={cn(fieldBase, 'flex h-9 cursor-pointer items-center justify-between gap-2 text-left data-[placeholder]:text-faint', invalid && 'border-danger', className)}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-faint" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className="z-[70] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border-strong bg-surface shadow-xl">
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pr-3 pl-7 text-[13px] outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-fg"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2">
                  <Check className="size-3.5 text-accent" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                {o.hint && <span className="ml-auto pl-3 text-[11px] text-faint">{o.hint}</span>}
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function Switch({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
      <SwitchPrimitive.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-border-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
      >
        <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
      </SwitchPrimitive.Root>
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface', className)} {...props}>
      {children}
    </div>
  );
}

const badgeTones = {
  neutral: 'bg-surface-2 text-muted',
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
} as const;

export function Badge({ tone = 'neutral', children, className }: { tone?: keyof typeof badgeTones; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium', badgeTones[tone], className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-faint', className)} />;
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted">
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-14 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <div className="text-[15px] font-semibold">{title}</div>
      {children && <div className="max-w-md text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger">{msg}</div>;
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

const dialogSizes = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' } as const;

export function Dialog({
  open, onOpenChange, title, description, children, footer, size = 'md',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof dialogSizes;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] data-[state=open]:animate-[fade-in_120ms_ease-out]" />
        <DialogPrimitive.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-surface shadow-2xl focus:outline-none',
            dialogSizes[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-[16px] font-semibold">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className={cn('mt-0.5 text-muted', !description && 'sr-only')}>{description ?? String(title)}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Fechar">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Tabs / Tooltip
// ---------------------------------------------------------------------------

export const Tabs = TabsPrimitive.Root;

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return <TabsPrimitive.List className={cn('flex gap-1 border-b border-border', className)}>{children}</TabsPrimitive.List>;
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg"
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <TabsPrimitive.Content value={value} className={cn('focus:outline-none', className)}>
      {children}
    </TabsPrimitive.Content>
  );
}

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content sideOffset={6} className="z-[80] max-w-xs rounded-md bg-fg px-2.5 py-1.5 text-[12px] text-bg shadow-lg">
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

// ---------------------------------------------------------------------------
// Utilitários de conteúdo
// ---------------------------------------------------------------------------

export function CopyButton({ text, label = 'Copiar', className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } else toast.error('Não foi possível copiar');
      }}
    >
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      {done ? 'Copiado' : label}
    </Button>
  );
}

export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn('rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px]', className)}>{children}</code>;
}

export function JsonBlock({ value, maxHeight = 320, className }: { value: unknown; maxHeight?: number; className?: string }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <pre
      style={{ maxHeight }}
      className={cn('overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all', className)}
    >
      {text}
    </pre>
  );
}
