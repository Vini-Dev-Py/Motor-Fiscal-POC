import { useState } from 'react';
import { ChevronRight, Plus, Settings2, Trash2 } from 'lucide-react';
import {
  FIELD_FORMATS, FIELD_TYPES, FORMAT_VALIDATORS, type FieldDef, type FieldFormat, type FieldType, type RequestSchemaDsl,
} from '@motor-fiscal/shared';
import { cn } from '@/lib/utils';
import { Button, Field, Input, Select, Switch } from '@/components/ui';

const TYPE_LABELS: Record<FieldType, string> = {
  string: 'Texto', number: 'Número', integer: 'Inteiro', decimal: 'Decimal (número ou texto "10.50")', boolean: 'Booleano',
  date: 'Data (AAAA-MM-DD)', datetime: 'Data e hora (ISO 8601)', enum: 'Lista de valores', object: 'Objeto', array: 'Lista',
};

const newField = (name = ''): FieldDef => ({ name, type: 'string', required: true });

/** Ajusta os campos dependentes ao trocar o tipo. */
function withType(f: FieldDef, type: FieldType): FieldDef {
  const base: FieldDef = { name: f.name, type, required: f.required, ...(f.description ? { description: f.description } : {}) };
  if (type === 'object') return { ...base, fields: f.fields?.length ? f.fields : [newField('campo')] };
  if (type === 'array') return { ...base, items: f.items ?? { name: 'item', type: 'string', required: true } };
  if (type === 'enum') return { ...base, enum: f.enum ?? [] };
  if (type === 'string') return { ...base, ...(f.format ? { format: f.format } : {}), ...(f.regex ? { regex: f.regex } : {}), ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}) };
  if (['number', 'integer', 'decimal'].includes(type)) return { ...base, ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}) };
  return base;
}

const numOrUndef = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

function FieldEditor({
  field, onChange, onRemove, isItem, depth,
}: { field: FieldDef; onChange: (f: FieldDef) => void; onRemove?: () => void; isItem?: boolean; depth: number }) {
  const [open, setOpen] = useState(false);
  const hasChildren = field.type === 'object' || field.type === 'array';
  const patch = (p: Partial<FieldDef>) => onChange({ ...field, ...p });
  const clear = (key: keyof FieldDef) => {
    const { [key]: _removed, ...rest } = field;
    void _removed;
    onChange(rest as FieldDef);
  };

  return (
    <div className={cn('rounded-lg border border-border bg-surface', depth > 0 && 'bg-surface-2/40')}>
      <div className="flex flex-wrap items-center gap-2 p-2">
        {isItem ? (
          <span className="w-36 px-2 text-[12.5px] font-medium text-muted">cada item:</span>
        ) : (
          <Input className="h-8 w-40 font-mono text-[12.5px]" placeholder="nomeDoCampo" value={field.name} onChange={(e) => patch({ name: e.target.value })} aria-label="Nome do campo" />
        )}
        <Select className="h-8 w-56" value={field.type} onValueChange={(v) => onChange(withType(field, v as FieldType))} options={FIELD_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))} />
        {!isItem && <Switch checked={field.required} onCheckedChange={(v) => patch({ required: v })} label="obrigatório" />}
        {field.format && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">{FORMAT_VALIDATORS[field.format].label}</span>}
        <div className="ml-auto flex items-center">
          <Button variant="ghost" size="icon" aria-label="Opções do campo" onClick={() => setOpen((o) => !o)}>
            <Settings2 className={cn('size-4', open && 'text-accent')} />
          </Button>
          {onRemove && (
            <Button variant="ghost" size="icon" aria-label="Remover campo" onClick={onRemove}>
              <Trash2 className="size-4 text-danger" />
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
          {field.type === 'string' && (
            <>
              <Field label="Formato brasileiro">
                <Select
                  value={field.format ?? 'none'}
                  onValueChange={(v) => (v === 'none' ? clear('format') : patch({ format: v as FieldFormat }))}
                  options={[{ value: 'none', label: 'Nenhum' }, ...FIELD_FORMATS.map((f) => ({ value: f, label: FORMAT_VALIDATORS[f].label }))]}
                />
              </Field>
              <Field label="Expressão regular">
                <Input className="font-mono text-[12.5px]" value={field.regex ?? ''} onChange={(e) => (e.target.value ? patch({ regex: e.target.value }) : clear('regex'))} placeholder="^[A-Z]{3}-\d+$" />
              </Field>
            </>
          )}
          {['string', 'number', 'integer', 'decimal'].includes(field.type) && (
            <>
              <Field label={field.type === 'string' ? 'Tamanho mínimo' : 'Valor mínimo'}>
                <Input inputMode="decimal" value={field.min ?? ''} onChange={(e) => { const n = numOrUndef(e.target.value); if (n === undefined) clear('min'); else patch({ min: n }); }} />
              </Field>
              <Field label={field.type === 'string' ? 'Tamanho máximo' : 'Valor máximo'}>
                <Input inputMode="decimal" value={field.max ?? ''} onChange={(e) => { const n = numOrUndef(e.target.value); if (n === undefined) clear('max'); else patch({ max: n }); }} />
              </Field>
            </>
          )}
          {field.type === 'enum' && (
            <Field label="Valores aceitos (separados por vírgula)" className="sm:col-span-2">
              <Input value={(field.enum ?? []).join(', ')} onChange={(e) => patch({ enum: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="A, B, C" />
            </Field>
          )}
          {field.type === 'array' && (
            <>
              <Field label="Mínimo de itens">
                <Input inputMode="numeric" value={field.minItems ?? ''} onChange={(e) => { const n = numOrUndef(e.target.value); if (n === undefined) clear('minItems'); else patch({ minItems: n }); }} />
              </Field>
              <Field label="Máximo de itens">
                <Input inputMode="numeric" value={field.maxItems ?? ''} onChange={(e) => { const n = numOrUndef(e.target.value); if (n === undefined) clear('maxItems'); else patch({ maxItems: n }); }} />
              </Field>
            </>
          )}
          <Field label="Descrição" className="sm:col-span-2 lg:col-span-3">
            <Input value={field.description ?? ''} onChange={(e) => (e.target.value ? patch({ description: e.target.value }) : clear('description'))} />
          </Field>
        </div>
      )}

      {hasChildren && (
        <div className="border-t border-border p-2 pl-5">
          {field.type === 'object' && (
            <FieldList fields={field.fields ?? []} onChange={(fields) => patch({ fields })} depth={depth + 1} />
          )}
          {field.type === 'array' && field.items && (
            <div className="flex items-start gap-1.5">
              <ChevronRight className="mt-2.5 size-3.5 shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <FieldEditor field={field.items} isItem depth={depth + 1} onChange={(items) => patch({ items })} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldList({ fields, onChange, depth }: { fields: FieldDef[]; onChange: (f: FieldDef[]) => void; depth: number }) {
  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <FieldEditor
          key={i}
          field={f}
          depth={depth}
          onChange={(nf) => onChange(fields.map((x, j) => (j === i ? nf : x)))}
          onRemove={() => onChange(fields.filter((_, j) => j !== i))}
        />
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...fields, newField()])}>
        <Plus className="size-3.5" /> Adicionar campo
      </Button>
    </div>
  );
}

/** Editor visual da DSL de validação do payload do webhook. */
export function SchemaBuilder({ value, onChange }: { value: RequestSchemaDsl; onChange: (v: RequestSchemaDsl) => void }) {
  return <FieldList fields={value.fields} onChange={(fields) => onChange({ fields })} depth={0} />;
}

// ---------------------------------------------------------------------------
// Exemplo de payload gerado a partir da DSL (para o console de teste)
// ---------------------------------------------------------------------------

const FORMAT_SAMPLES: Record<FieldFormat, string> = {
  cnpj: '11222333000181', cpf: '52998224725', cnpjOuCpf: '11222333000181', cep: '01001000', ncm: '61091000',
  cfop: '5102', uf: 'SP', chaveNfe: '35260911222333000181550010000000011378210043', email: 'contato@exemplo.com.br',
};

function sampleField(f: FieldDef): unknown {
  switch (f.type) {
    case 'string':
      return f.format ? FORMAT_SAMPLES[f.format] : f.name.toLowerCase() === 'id' ? `PED-${Date.now().toString(36).toUpperCase()}` : 'texto';
    case 'number': return f.min ?? 1.5;
    case 'integer': return f.min ?? 1;
    case 'decimal': return f.min && f.min > 0 ? f.min : 10;
    case 'boolean': return true;
    case 'date': return new Date().toISOString().slice(0, 10);
    case 'datetime': return new Date().toISOString().replace('Z', '-03:00');
    case 'enum': return f.enum?.[0] ?? '';
    case 'object': return Object.fromEntries((f.fields ?? []).map((c) => [c.name, sampleField(c)]));
    case 'array': return [f.items ? sampleField(f.items) : 'item'];
  }
}

export const sampleFromDsl = (dsl: RequestSchemaDsl): Record<string, unknown> =>
  Object.fromEntries(dsl.fields.filter((f) => f.required).map((f) => [f.name, sampleField(f)]));
