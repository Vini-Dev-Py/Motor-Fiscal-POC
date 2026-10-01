import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { referenceRowInputSchema } from '@motor-fiscal/shared';
import { api, errorMessage, type RefRow, type RefTableInfo } from '@/lib/api';
import { zodErrors } from '@/lib/forms';
import { useInvalidate, useRefTables, useTenantQuery } from '@/lib/queries';
import { cn, formatDate } from '@/lib/utils';
import { Badge, Button, Card, Dialog, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Switch } from '@/components/ui';

const today = () => new Date().toISOString().slice(0, 10);

interface RowForm {
  id?: string;
  keys: Record<string, string>;
  value: Record<string, string>;
  validFrom: string;
  validTo: string;
  tenantSpecific: boolean;
  note: string;
}

export function TablesPage() {
  const { data: tables, isLoading, error } = useRefTables();
  const [sel, setSel] = useState<string | null>(null);
  const table: RefTableInfo | undefined = tables?.find((t) => t.key === sel) ?? tables?.[0];
  const invalidate = useInvalidate();

  const rows = useTenantQuery(['ref-rows', table?.key], () => api.get<RefRow[]>(`/api/reference-rows?table=${table!.key}`), !!table);
  const [form, setForm] = useState<RowForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => setForm(null), [table?.key]);

  const openNew = () => {
    if (!table) return;
    setErrors({});
    setForm({
      keys: Object.fromEntries(table.keyFields.map((k) => [k, ''])),
      value: Object.fromEntries(table.valueFields.map((k) => [k, ''])),
      validFrom: today(), validTo: '', tenantSpecific: true, note: '',
    });
  };

  const openEdit = (r: RefRow) => {
    setErrors({});
    setForm({
      id: r.id, keys: { ...r.keys }, value: Object.fromEntries(Object.entries(r.value).map(([k, v]) => [k, String(v)])),
      validFrom: r.validFrom, validTo: r.validTo ?? '', tenantSpecific: r.tenantSpecific, note: r.note ?? '',
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      const f = form!;
      const payload = {
        table: table!.key,
        keys: Object.fromEntries(Object.entries(f.keys).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])),
        value: Object.fromEntries(Object.entries(f.value).map(([k, v]) => [k, v.trim()])),
        validFrom: f.validFrom, validTo: f.validTo || null, tenantSpecific: f.tenantSpecific, note: f.note || null,
      };
      const parsed = referenceRowInputSchema.safeParse(payload);
      if (!parsed.success) {
        setErrors(zodErrors(parsed.error));
        throw new Error('Corrija os campos destacados');
      }
      const missing = table!.valueFields.find((k) => !payload.value[k]);
      if (missing) {
        setErrors({ [`value.${missing}`]: 'Obrigatório' });
        throw new Error('Corrija os campos destacados');
      }
      return f.id ? api.put(`/api/reference-rows/${f.id}`, payload) : api.post('/api/reference-rows', payload);
    },
    onSuccess: () => {
      toast.success('Linha salva');
      void invalidate('ref-rows');
      void invalidate('ref-tables');
      setForm(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/reference-rows/${id}`),
    onSuccess: () => {
      toast.success('Linha removida');
      void invalidate('ref-rows');
      void invalidate('ref-tables');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const now = today();
  const effective = (r: RefRow) => r.validFrom <= now && (!r.validTo || now <= r.validTo);

  return (
    <>
      <PageHeader
        title="Tabelas de referência"
        description="Alíquotas, MVA, TIPI e faixas do Simples com vigência. Uma alíquota nova é só uma linha nova com data de início — sem mexer no código. Linhas da empresa têm prioridade sobre as globais."
      />
      <Card className="mb-5 border-warn/40 bg-warn-soft p-3 text-[12.5px] text-warn">
        Valores do seed são de <b>referência para a POC</b> e precisam ser conferidos com o contador antes de qualquer uso real.
      </Card>

      {isLoading ? <Loading /> : error ? <ErrorBox error={error} /> : (
        <div className="grid gap-5 md:grid-cols-[17rem_1fr]">
          <nav className="space-y-1">
            {tables?.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setSel(t.key)}
                className={cn(
                  'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
                  t.key === table?.key ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                <span className="truncate">{t.name}</span>
                <span className="text-[11px] text-faint">{t.rowCount}</span>
              </button>
            ))}
          </nav>

          {table && (
            <div className="min-w-0">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{table.name}</h2>
                  <p className="text-[12.5px] text-muted">{table.description}</p>
                  <p className="mt-1 font-mono text-[11.5px] text-faint">{table.key}</p>
                </div>
                <Button variant="primary" size="sm" onClick={openNew}>
                  <Plus className="size-4" /> Nova linha
                </Button>
              </div>
              {rows.isLoading ? <Loading /> : rows.error ? <ErrorBox error={rows.error} /> : !rows.data?.length ? (
                <EmptyState title="Tabela vazia" />
              ) : (
                <Card className="overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead className="border-b border-border bg-surface-2 text-[12px] text-muted">
                      <tr>
                        {table.keyFields.map((k) => <th key={k} className="px-3 py-2 font-medium">{k}</th>)}
                        {table.valueFields.map((k) => <th key={k} className="px-3 py-2 font-medium text-accent">{k}</th>)}
                        <th className="px-3 py-2 font-medium">Vigência</th>
                        <th className="px-3 py-2 font-medium">Escopo</th>
                        <th className="w-20" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.data.map((r) => (
                        <tr key={r.id} className={cn('border-b border-border last:border-0', !effective(r) && 'text-faint')}>
                          {table.keyFields.map((k) => <td key={k} className="px-3 py-2 font-mono">{r.keys[k] ?? '*'}</td>)}
                          {table.valueFields.map((k) => <td key={k} className="px-3 py-2 font-mono">{String(r.value[k] ?? '')}</td>)}
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatDate(r.validFrom)} → {r.validTo ? formatDate(r.validTo) : 'sem fim'}
                            {effective(r) && <Badge tone="ok" className="ml-2">vigente</Badge>}
                          </td>
                          <td className="px-3 py-2">{r.tenantSpecific ? <Badge tone="accent">empresa</Badge> : <Badge>global</Badge>}</td>
                          <td className="px-2 py-1 text-right whitespace-nowrap">
                            <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => openEdit(r)}><Pencil className="size-3.5" /></Button>
                            <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => window.confirm('Excluir esta linha?') && remove.mutate(r.id)}>
                              <Trash2 className="size-3.5 text-danger" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      <Dialog
        open={!!form}
        onOpenChange={(o) => !o && setForm(null)}
        title={form?.id ? 'Editar linha' : 'Nova linha'}
        description={table ? `${table.name} — use "*" (ou deixe vazio) em uma chave para valer para qualquer valor.` : undefined}
        size="md"
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </>
        }
      >
        {form && table && (
          <div className="space-y-4">
            {table.keyFields.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {table.keyFields.map((k) => (
                  <Field key={k} label={`Chave: ${k}`}>
                    <Input value={form.keys[k] ?? ''} onChange={(e) => setForm({ ...form, keys: { ...form.keys, [k]: e.target.value } })} placeholder="*" />
                  </Field>
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {table.valueFields.map((k) => (
                <Field key={k} label={`Valor: ${k}`} required error={errors[`value.${k}`]}>
                  <Input value={form.value[k] ?? ''} onChange={(e) => setForm({ ...form, value: { ...form.value, [k]: e.target.value } })} invalid={!!errors[`value.${k}`]} />
                </Field>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Vigência — início" required error={errors.validFrom}>
                <Input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
              </Field>
              <Field label="Vigência — fim" error={errors.validTo} hint="Vazio = sem data de término">
                <Input type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
              </Field>
            </div>
            <Switch checked={form.tenantSpecific} onCheckedChange={(v) => setForm({ ...form, tenantSpecific: v })} label="Vale só para a empresa selecionada (desligado = linha global)" />
            <Field label="Observação"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Ex.: Convênio 123/2026" /></Field>
          </div>
        )}
      </Dialog>
    </>
  );
}
