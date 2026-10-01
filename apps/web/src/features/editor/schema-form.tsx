import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PORT_TYPES, PORT_TYPE_LABELS, type PortDef, type PortType } from '@motor-fiscal/shared';
import { safeJsonParse } from '@/lib/utils';
import { Button, Field, Input, Select, Switch, Textarea } from '@/components/ui';

interface JsonProp {
  type?: string | string[];
  enum?: unknown[];
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  anyOf?: unknown[];
}

/** JSON editado como texto; só propaga quando é JSON válido. */
function JsonField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value)));
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <Textarea
        mono
        rows={2}
        value={text}
        invalid={!!err}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === '') {
            setErr(null);
            onChange(undefined);
            return;
          }
          const p = safeJsonParse(e.target.value);
          if (p.ok) {
            setErr(null);
            onChange(p.value);
          } else setErr('JSON inválido');
        }}
      />
      {err && <div className="text-[12px] text-danger">{err}</div>}
    </div>
  );
}

/** Formulário de parâmetros a partir do JSON Schema do bloco (tipos simples; o resto vira JSON). */
export function SchemaForm({
  schema, value, onChange,
}: { schema: Record<string, unknown>; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const props = ((schema.properties ?? {}) as Record<string, JsonProp>);
  const keys = Object.keys(props).filter((k) => k !== 'flowId');
  if (!keys.length) return <p className="text-[12.5px] text-muted">Este bloco não tem parâmetros.</p>;

  const set = (k: string, v: unknown) => {
    const next = { ...value };
    if (v === undefined || v === '') delete next[k];
    else next[k] = v;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {keys.map((k) => {
        const p = props[k]!;
        const cur = value[k];
        const type = Array.isArray(p.type) ? p.type.find((t) => t !== 'null') : p.type;
        const hint = [p.description, p.default !== undefined ? `padrão: ${JSON.stringify(p.default)}` : undefined, p.minimum !== undefined || p.maximum !== undefined ? `${p.minimum ?? '−∞'} a ${p.maximum ?? '∞'}` : undefined]
          .filter(Boolean)
          .join(' · ');

        if (type === 'boolean') {
          return (
            <div key={k}>
              <Switch checked={(cur ?? p.default ?? false) as boolean} onCheckedChange={(v) => set(k, v)} label={<span className="font-medium">{k}</span>} />
              {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
            </div>
          );
        }
        if (p.enum && type === 'string') {
          return (
            <Field key={k} label={k} hint={hint}>
              <Select value={String(cur ?? p.default ?? '')} onValueChange={(v) => set(k, v)} options={p.enum.map((o) => ({ value: String(o), label: String(o) }))} />
            </Field>
          );
        }
        if (type === 'number' || type === 'integer') {
          return (
            <Field key={k} label={k} hint={hint}>
              <Input
                type="number"
                step="any"
                value={cur === undefined ? '' : String(cur)}
                placeholder={p.default !== undefined ? String(p.default) : ''}
                onChange={(e) => set(k, e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </Field>
          );
        }
        if (type === 'string') {
          return (
            <Field key={k} label={k} hint={hint}>
              <Input value={(cur as string | undefined) ?? ''} placeholder={p.default !== undefined ? String(p.default) : ''} onChange={(e) => set(k, e.target.value)} />
            </Field>
          );
        }
        return (
          <Field key={k} label={`${k} (JSON)`} hint={hint}>
            <JsonField value={cur ?? p.default} onChange={(v) => set(k, v)} />
          </Field>
        );
      })}
    </div>
  );
}

/** Editor das portas declaradas pelo usuário (blocos de código, entrada e saída de subfluxos). */
export function PortsEditor({ ports, onChange, title }: { ports: PortDef[]; onChange: (p: PortDef[]) => void; title: string }) {
  const update = (i: number, patch: Partial<PortDef>) => onChange(ports.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold tracking-wide text-muted uppercase">{title}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            let n = ports.length + 1;
            while (ports.some((p) => p.id === `porta${n}`)) n++;
            onChange([...ports, { id: `porta${n}`, label: `Porta ${n}`, type: 'any', required: false }]);
          }}
        >
          <Plus className="size-3.5" /> Porta
        </Button>
      </div>
      <div className="space-y-2">
        {ports.map((p, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border border-border p-2">
            <div className="flex items-center gap-1.5">
              <Input className="h-8 font-mono text-[12px]" value={p.id} onChange={(e) => update(i, { id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} aria-label="Identificador" />
              <Input className="h-8 text-[12.5px]" value={p.label} onChange={(e) => update(i, { label: e.target.value })} aria-label="Rótulo" />
              <Button variant="ghost" size="icon" aria-label="Remover porta" onClick={() => onChange(ports.filter((_, j) => j !== i))}>
                <Trash2 className="size-3.5 text-danger" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Select className="h-8 flex-1" value={p.type} onValueChange={(v) => update(i, { type: v as PortType })} options={PORT_TYPES.map((t) => ({ value: t, label: PORT_TYPE_LABELS[t] }))} />
              <Switch checked={p.required !== false} onCheckedChange={(v) => update(i, { required: v })} label="obrigatória" />
            </div>
          </div>
        ))}
        {!ports.length && <div className="text-[12.5px] text-muted">Nenhuma porta.</div>}
      </div>
    </div>
  );
}
