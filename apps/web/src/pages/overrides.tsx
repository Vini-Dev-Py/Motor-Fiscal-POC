import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileCode2, FlaskConical, Play, Plus, Scale, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { overrideInputSchema, type BlockMeta, type PortDef } from '@motor-fiscal/shared';
import { api, errorMessage, type Override, type OverrideTestResult } from '@/lib/api';
import { zodErrors } from '@/lib/forms';
import { useBlocks, useInvalidate, useOverrides } from '@/lib/queries';
import { formatDate, pretty, safeJsonParse } from '@/lib/utils';
import {
  Badge, Button, Card, Code, Dialog, EmptyState, ErrorBox, Field, Input, JsonBlock, Loading, PageHeader, Select, Switch, Tabs, TabsContent, TabsList,
  TabsTrigger,
} from '@/components/ui';
import { CodeEditor } from '@/components/code-editor';

const today = () => new Date().toISOString().slice(0, 10);

function sampleReturn(p: PortDef): string {
  switch (p.type) {
    case 'tributo': return `{ base: '0.00', aliquota: '0', valor: '0.00', aplicavel: true }`;
    case 'decimal': case 'percent': return `'0.00'`;
    case 'integer': return '0';
    case 'boolean': return 'true';
    default: return '{}';
  }
}

/** Gera um modelo de código com as entradas e saídas do bloco. */
function codeTemplate(b: BlockMeta): string {
  const ins = b.inputs.map((p) => `//   inputs.${p.id}  (${p.type}${p.required === false ? ', opcional' : ''})`).join('\n');
  const ret = b.outputs.map((p) => `    ${p.id}: ${sampleReturn(p)},`).join('\n');
  return `// Substitui o bloco "${b.label}". Entradas disponíveis:
${ins}
// D(x) cria decimais exatos · tabela(nome, chaves) consulta as tabelas de referência.
// Valores decimais trafegam como string ("189.00"). A saída é validada pelo contrato do bloco.
function calcular({ inputs, params, D, tabela }) {
  return {
${ret}
  };
}
`;
}

interface Form {
  id?: string; blockKey: string; name: string; code: string; params: string; validFrom: string; validTo: string;
  legalBasis: string; active: boolean;
}

const emptyForm = (): Form => ({ blockKey: '', name: '', code: '', params: '{}', validFrom: today(), validTo: '', legalBasis: '', active: true });

function DiffTable({ result }: { result: OverrideTestResult }) {
  if (!result.diferencas.length) return <div className="text-[13px] text-muted">Sem diferenças: o override devolveu exatamente o mesmo que o bloco padrão.</div>;
  return (
    <table className="w-full text-left text-[12.5px]">
      <thead className="text-muted"><tr><th className="py-1 pr-3 font-medium">Campo</th><th className="py-1 pr-3 font-medium">Padrão</th><th className="py-1 font-medium">Override</th></tr></thead>
      <tbody>
        {result.diferencas.map((d) => (
          <tr key={d.path} className="border-t border-border">
            <td className="py-1.5 pr-3 font-mono">{d.path}</td>
            <td className="py-1.5 pr-3 font-mono text-danger">{JSON.stringify(d.padrao)}</td>
            <td className="py-1.5 font-mono text-ok">{JSON.stringify(d.override)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TestPanel({ overrideId, blockKey }: { overrideId: string; blockKey: string }) {
  const [inputs, setInputs] = useState('');
  const [date, setDate] = useState('2026-09-30');
  const [result, setResult] = useState<OverrideTestResult | null>(null);

  const sample = useMutation({
    mutationFn: () => api.get<{ inputs: Record<string, unknown>; referenceDate: string }>(`/api/blocks/${blockKey}/sample-inputs`),
    onSuccess: (s) => {
      setInputs(pretty(s.inputs));
      setDate(s.referenceDate);
    },
  });
  const run = useMutation({
    mutationFn: async () => {
      const parsed = safeJsonParse<Record<string, unknown>>(inputs);
      if (!parsed.ok) throw new Error(`JSON das entradas inválido: ${parsed.error}`);
      return api.post<OverrideTestResult>(`/api/overrides/${overrideId}/test`, { inputs: parsed.value, referenceDate: date });
    },
    onSuccess: setResult,
    onError: (e) => toast.error(errorMessage(e)),
  });

  // carrega um exemplo de entradas ao abrir o painel
  useEffect(() => {
    sample.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockKey]);

  const side = (title: string, r: OverrideTestResult['padrao']) => (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold tracking-wide text-muted uppercase">
        {title} {r.ok ? <Badge tone="ok">ok · {r.durationMs} ms</Badge> : <Badge tone="danger">erro</Badge>}
      </div>
      {r.ok ? <JsonBlock value={r.outputs} maxHeight={280} /> : (
        <div className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-[12.5px] text-danger">
          <div className="font-medium">{r.error?.message}</div>
          <div className="font-mono text-[11px] opacity-80">{r.error?.code}</div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-end gap-3">
        <Field label="Data de referência (vigência)" className="w-52">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}>
          <Play className="size-4" /> Rodar padrão × override
        </Button>
        <Button variant="ghost" onClick={() => sample.mutate()}>Restaurar exemplo</Button>
      </div>
      <Field label="Entradas do bloco (JSON)" hint="O teste ignora ‘ativo’ e vigência: serve para validar o override antes de ligá-lo.">
        <CodeEditor language="json" value={inputs} onChange={setInputs} height={220} />
      </Field>
      {result && (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row">
            {side('Bloco padrão', result.padrao)}
            {side('Com override', result.override)}
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">Diferenças</div>
            <DiffTable result={result} />
          </div>
        </div>
      )}
    </div>
  );
}

export function OverridesPage() {
  const { data: overrides, isLoading, error } = useOverrides();
  const { data: blocks } = useBlocks();
  const invalidate = useInvalidate();
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState('config');

  const overridable = useMemo(() => (blocks ?? []).filter((b) => b.overridable), [blocks]);
  const block = blocks?.find((b) => b.key === form?.blockKey);
  const label = (key: string) => blocks?.find((b) => b.key === key)?.label ?? key;

  const open = (o?: Override) => {
    setErrors({});
    setTab('config');
    setForm(
      o ? { id: o.id, blockKey: o.blockKey, name: o.name, code: o.code ?? '', params: pretty(o.params), validFrom: o.validFrom, validTo: o.validTo ?? '', legalBasis: o.legalBasis ?? '', active: o.active } : emptyForm(),
    );
  };

  const save = useMutation({
    mutationFn: async () => {
      const f = form!;
      const params = safeJsonParse<Record<string, unknown>>(f.params || '{}');
      if (!params.ok) {
        setErrors({ params: `JSON inválido: ${params.error}` });
        throw new Error('Corrija os campos destacados');
      }
      const payload = {
        blockKey: f.blockKey, name: f.name.trim(), code: f.code.trim() ? f.code : null, params: params.value,
        validFrom: f.validFrom, validTo: f.validTo || null, legalBasis: f.legalBasis.trim() || null, active: f.active,
      };
      const parsed = overrideInputSchema.safeParse(payload);
      if (!parsed.success) {
        setErrors(zodErrors(parsed.error));
        throw new Error('Corrija os campos destacados');
      }
      setErrors({});
      return f.id ? api.put<Override>(`/api/overrides/${f.id}`, payload) : api.post<Override>('/api/overrides', payload);
    },
    onSuccess: (o) => {
      toast.success('Override salvo');
      void invalidate('overrides');
      setForm((f) => (f ? { ...f, id: o.id } : f));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/overrides/${id}`),
    onSuccess: () => {
      toast.success('Override excluído');
      void invalidate('overrides');
      setForm(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const paramHints = useMemo(() => {
    const props = (block?.paramsSchema as { properties?: Record<string, { type?: string; default?: unknown; enum?: unknown[] }> } | undefined)?.properties ?? {};
    return Object.entries(props).map(([k, v]) => `${k}: ${v.enum ? v.enum.join(' | ') : (v.type ?? 'json')}${v.default !== undefined ? ` = ${JSON.stringify(v.default)}` : ''}`);
  }, [block]);

  return (
    <>
      <PageHeader
        title="Overrides por empresa"
        description="Substitui um bloco padrão só para esta empresa (benefício fiscal, liminar, regime especial) trocando parâmetros e/ou com código JavaScript. Vale apenas dentro da vigência e sempre respeita o contrato de saída do bloco."
        actions={<Button variant="primary" onClick={() => open()}><Plus className="size-4" /> Novo override</Button>}
      />
      {isLoading ? <Loading /> : error ? <ErrorBox error={error} /> : !overrides?.length ? (
        <EmptyState icon={<Scale className="size-8" />} title="Esta empresa não tem overrides" action={<Button variant="primary" onClick={() => open()}>Criar override</Button>}>
          Sem override, os blocos padrão da plataforma calculam os impostos.
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {overrides.map((o) => (
            <Card key={o.id} className="cursor-pointer p-4 transition-colors hover:border-accent" onClick={() => open(o)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileCode2 className="size-4 text-accent" />
                  <span className="font-semibold">{o.name}</span>
                  {o.active ? <Badge tone="ok">ativo</Badge> : <Badge>inativo</Badge>}
                  {o.code ? <Badge tone="warn">código</Badge> : <Badge tone="info">parâmetros</Badge>}
                </div>
                <span className="text-[12px] text-muted">
                  {formatDate(o.validFrom)} → {o.validTo ? formatDate(o.validTo) : 'sem fim'}
                </span>
              </div>
              <div className="mt-1.5 text-[12.5px] text-muted">
                Bloco <b className="text-fg">{label(o.blockKey)}</b> <Code>{o.blockKey}</Code>
                {Object.keys(o.params).length > 0 && <> · <Code>{JSON.stringify(o.params)}</Code></>}
              </div>
              {o.legalBasis && <div className="mt-1 text-[12.5px] text-muted">Base legal: {o.legalBasis}</div>}
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!form}
        onOpenChange={(o) => !o && setForm(null)}
        title={form?.id ? 'Editar override' : 'Novo override'}
        size="xl"
        footer={
          <>
            {form?.id && (
              <Button variant="ghost" className="mr-auto text-danger" onClick={() => window.confirm('Excluir este override?') && remove.mutate(form.id!)}>
                <Trash2 className="size-4" /> Excluir
              </Button>
            )}
            <Button onClick={() => setForm(null)}>Fechar</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </>
        }
      >
        {form && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="config">Configuração</TabsTrigger>
              <TabsTrigger value="test"><span className="inline-flex items-center gap-1.5"><FlaskConical className="size-3.5" /> Testar</span></TabsTrigger>
            </TabsList>
            <TabsContent value="config" className="space-y-4 pt-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Bloco a sobrescrever" required error={errors.blockKey}>
                  <Select
                    value={form.blockKey}
                    onValueChange={(v) => setForm({ ...form, blockKey: v })}
                    disabled={!!form.id}
                    invalid={!!errors.blockKey}
                    options={overridable.map((b) => ({ value: b.key, label: b.label, hint: b.key }))}
                  />
                </Field>
                <Field label="Nome" required error={errors.name}>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Liminar — redução de 50% na base" invalid={!!errors.name} />
                </Field>
                <Field label="Vigência — início" required error={errors.validFrom}>
                  <Input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
                </Field>
                <Field label="Vigência — fim" error={errors.validTo} hint="Vazio = sem data de término">
                  <Input type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
                </Field>
              </div>
              <Field label="Base legal" hint="Nº do processo, liminar, convênio… aparece no trace de cada execução.">
                <Input value={form.legalBasis} onChange={(e) => setForm({ ...form, legalBasis: e.target.value })} />
              </Field>
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} label="Ativo (vale para as execuções dentro da vigência)" />

              <Field label="Parâmetros (JSON)" error={errors.params} hint={paramHints.length ? `Disponíveis: ${paramHints.join(' · ')}` : 'Escolha o bloco para ver os parâmetros disponíveis.'}>
                <CodeEditor language="json" value={form.params} onChange={(v) => setForm({ ...form, params: v })} height={100} />
              </Field>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[13px] font-medium">Código JavaScript (opcional)</span>
                  <Button size="sm" variant="ghost" disabled={!block} onClick={() => block && setForm({ ...form, code: codeTemplate(block) })}>
                    Inserir modelo do bloco
                  </Button>
                </div>
                <CodeEditor language="javascript" value={form.code} onChange={(v) => setForm({ ...form, code: v })} height={300} />
                {errors.code && <div className="mt-1 text-[12px] text-danger">{errors.code}</div>}
                <p className="mt-1.5 text-[12px] text-muted">
                  Sem código, o bloco padrão roda com os parâmetros acima trocados. Com código, ele substitui o bloco: roda isolado (1 s · 32 MB, sem rede nem arquivos) e a saída é validada.
                </p>
              </div>
            </TabsContent>
            <TabsContent value="test">
              {form.id ? <TestPanel overrideId={form.id} blockKey={form.blockKey} /> : <div className="py-12 text-center text-muted">Salve o override para poder testá-lo.</div>}
            </TabsContent>
          </Tabs>
        )}
      </Dialog>
    </>
  );
}
