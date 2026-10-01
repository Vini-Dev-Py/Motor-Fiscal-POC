import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Globe, Pencil, Plus, Send, Sparkles, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  EXEMPLO_REQUEST_SCHEMA, EXEMPLO_RESPONSE_TEMPLATE, inferSchemaFromJson, requestSchemaDslSchema, webhookInputSchema, type RequestSchemaDsl,
} from '@motor-fiscal/shared';
import { api, errorMessage, type Flow, type Webhook } from '@/lib/api';
import { zodErrors } from '@/lib/forms';
import { useBlocks, useFlows, useInvalidate, useMeta, useTenantQuery, useWebhooks, webhookUrl } from '@/lib/queries';
import { cn, pretty, safeJsonParse } from '@/lib/utils';
import {
  Badge, Button, Card, CopyButton, Dialog, EmptyState, ErrorBox, Field, Input, JsonBlock, Loading, PageHeader, Select, Switch, Tabs, TabsContent,
  TabsList, TabsTrigger, Textarea,
} from '@/components/ui';
import { CodeEditor } from '@/components/code-editor';
import { SchemaBuilder, sampleFromDsl } from '@/features/webhooks/schema-builder';

interface Form {
  id?: string; name: string; slug: string; description: string; flowId: string; token: string; active: boolean;
  dateField: string; idempotencyField: string; schema: RequestSchemaDsl; template: string;
}

const emptyForm = (): Form => ({
  name: '', slug: '', description: '', flowId: '', token: '', active: true, dateField: 'dataEmissao', idempotencyField: 'id',
  schema: { fields: [{ name: 'id', type: 'string', required: true }] }, template: pretty({ status: 'ok' }),
});

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------------------------------------------------------------------------
// Console de teste
// ---------------------------------------------------------------------------

function TestConsole({ form, url }: { form: Form; url: string }) {
  const [payload, setPayload] = useState(() => pretty(sampleFromDsl(form.schema)));
  const [idemKey, setIdemKey] = useState('');
  const [resp, setResp] = useState<{ status: number; ms: number; headers: Record<string, string>; body: unknown } | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      const t0 = performance.now();
      const res = await fetch(`/webhook/${form.slug}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(form.token ? { 'X-Webhook-Token': form.token } : {}),
          ...(idemKey ? { 'Idempotency-Key': idemKey } : {}),
        },
        body: payload,
      });
      const text = await res.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* resposta não-JSON */ }
      const headers: Record<string, string> = {};
      ['x-execution-id', 'idempotent-replay'].forEach((h) => { const v = res.headers.get(h); if (v) headers[h] = v; });
      return { status: res.status, ms: Math.round(performance.now() - t0), headers, body };
    },
    onSuccess: setResp,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const newId = () => {
    const p = safeJsonParse<Record<string, unknown>>(payload);
    if (!p.ok || typeof p.value.id !== 'string') return toast.info('O payload precisa de um campo "id" em texto');
    setPayload(pretty({ ...p.value, id: `PED-${Date.now().toString(36).toUpperCase()}` }));
  };

  return (
    <div className="space-y-4 pt-4">
      <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12.5px]">
        <span className="font-mono font-semibold">POST</span> <span className="font-mono">{url}</span>
        <div className="mt-0.5 text-muted">Este console dispara o webhook de verdade: cria uma execução e consome a numeração da NF-e (mock).</div>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <Field label="Payload (JSON)">
          <CodeEditor language="json" value={payload} onChange={setPayload} height={300} />
        </Field>
        <div className="space-y-3">
          <Field label="Idempotency-Key (opcional)" hint="Sem o header, vale o campo configurado na aba Geral.">
            <Input value={idemKey} onChange={(e) => setIdemKey(e.target.value)} />
          </Field>
          <Button className="w-full" onClick={newId}><Sparkles className="size-4" /> Novo id no payload</Button>
          <Button className="w-full" variant="primary" loading={send.isPending} disabled={!form.id} onClick={() => send.mutate()}>
            <Send className="size-4" /> Enviar
          </Button>
          {!form.id && <p className="text-[12px] text-warn">Salve o webhook antes de testar.</p>}
        </div>
      </div>
      {resp && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-[13px]">
            <Badge tone={resp.status === 200 ? 'ok' : resp.status < 500 ? 'warn' : 'danger'}>HTTP {resp.status}</Badge>
            <span className="text-muted">{resp.ms} ms</span>
            {Object.entries(resp.headers).map(([k, v]) => <span key={k} className="font-mono text-[11.5px] text-muted">{k}: {v}</span>)}
            <CopyButton className="ml-auto" text={pretty(resp.body)} />
          </div>
          <JsonBlock value={resp.body} maxHeight={360} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Caminhos disponíveis para o template
// ---------------------------------------------------------------------------

function TemplatePaths({ flowId, schema }: { flowId: string; schema: RequestSchemaDsl }) {
  const { data: blocks } = useBlocks();
  const { data: flow } = useTenantQuery(['flow', flowId], () => api.get<Flow>(`/api/flows/${flowId}`), !!flowId);
  const paths = useMemo(() => {
    const out: string[] = schema.fields.map((f) => `input.${f.name}`);
    for (const n of flow?.draftGraph.nodes ?? []) {
      const def = blocks?.find((b) => b.key === n.data.blockKey);
      const ports = n.data.outputs ?? def?.outputs ?? [];
      for (const p of ports) out.push(`nodes.${n.id}.${p.id}`);
    }
    return out;
  }, [flow, blocks, schema]);

  if (!flowId) return <p className="text-[12.5px] text-muted">Escolha o fluxo na aba Geral para ver as saídas disponíveis.</p>;
  return (
    <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
      {paths.map((p) => (
        <button
          key={p}
          type="button"
          className="cursor-pointer rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] hover:bg-accent-soft hover:text-accent"
          title="Clique para copiar"
          onClick={() => { void navigator.clipboard.writeText(`{{${p}}}`); toast.success(`Copiado: {{${p}}}`); }}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function WebhooksPage() {
  const { data: webhooks, isLoading, error } = useWebhooks();
  const { data: flows } = useFlows('PEDIDO');
  const { data: meta } = useMeta();
  const invalidate = useInvalidate();
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState('geral');
  const [schemaMode, setSchemaMode] = useState<'visual' | 'json'>('visual');
  const [schemaJson, setSchemaJson] = useState('');
  const [inferOpen, setInferOpen] = useState(false);
  const [inferText, setInferText] = useState('');

  const base = meta?.publicBaseUrl;
  const open = (w?: Webhook) => {
    setErrors({});
    setTab('geral');
    setSchemaMode('visual');
    setForm(
      w
        ? {
            id: w.id, name: w.name, slug: w.slug, description: w.description ?? '', flowId: w.flowId, token: w.token ?? '', active: w.active,
            dateField: w.config.dateField ?? 'dataEmissao', idempotencyField: w.config.idempotencyField ?? '', schema: w.requestSchema, template: pretty(w.responseTemplate),
          }
        : { ...emptyForm(), flowId: flows?.[0]?.id ?? '' },
    );
  };

  const buildPayload = (f: Form) => {
    const tpl = safeJsonParse(f.template);
    return {
      name: f.name.trim(), slug: f.slug.trim(), description: f.description.trim() || null, flowId: f.flowId, requestSchema: f.schema,
      responseTemplate: tpl.ok ? tpl.value : undefined, token: f.token.trim() || null, active: f.active,
      config: { dateField: f.dateField.trim() || 'dataEmissao', ...(f.idempotencyField.trim() ? { idempotencyField: f.idempotencyField.trim() } : {}) },
    };
  };

  const save = useMutation({
    mutationFn: async () => {
      let f = form!;
      if (schemaMode === 'json') {
        // a aba JSON é a fonte da verdade enquanto estiver ativa
        const p = safeJsonParse(schemaJson);
        const v = p.ok ? requestSchemaDslSchema.safeParse(p.value) : null;
        if (!p.ok || !v?.success) {
          setTab('schema');
          throw new Error(p.ok ? (v && !v.success ? (v.error.issues[0]?.message ?? 'Schema inválido') : 'Schema inválido') : `JSON do schema inválido: ${p.error}`);
        }
        f = { ...f, schema: v.data };
        setForm(f);
      }
      if (!safeJsonParse(f.template).ok) {
        setErrors({ template: 'O template de resposta não é um JSON válido' });
        setTab('resposta');
        throw new Error('Corrija os campos destacados');
      }
      const payload = buildPayload(f);
      const parsed = webhookInputSchema.safeParse(payload);
      if (!parsed.success) {
        const e = zodErrors(parsed.error);
        setErrors(e);
        setTab(Object.keys(e).some((k) => k.startsWith('requestSchema')) ? 'schema' : 'geral');
        throw new Error(Object.entries(e).map(([k, v]) => `${k}: ${v}`).join(' · '));
      }
      setErrors({});
      return f.id ? api.put<Webhook>(`/api/webhooks/${f.id}`, payload) : api.post<Webhook>('/api/webhooks', payload);
    },
    onSuccess: (w) => {
      toast.success('Webhook salvo');
      void invalidate('webhooks');
      setForm((f) => (f ? { ...f, id: w.id } : f));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggle = useMutation({
    mutationFn: (w: Webhook) =>
      api.put(`/api/webhooks/${w.id}`, {
        name: w.name, slug: w.slug, description: w.description, flowId: w.flowId, requestSchema: w.requestSchema, responseTemplate: w.responseTemplate,
        token: w.token, active: !w.active, config: w.config,
      }),
    onSuccess: () => void invalidate('webhooks'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/webhooks/${id}`),
    onSuccess: () => {
      toast.success('Webhook removido');
      void invalidate('webhooks');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const flowOptions = (flows ?? []).map((f) => ({ value: f.id, label: f.name, hint: f.latestVersion ? `v${f.latestVersion}` : 'não publicado' }));
  const url = form ? webhookUrl(form.slug || '<slug>', base) : '';
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const applyInfer = () => {
    const p = safeJsonParse(inferText);
    if (!p.ok) return toast.error(`JSON inválido: ${p.error}`);
    try {
      set('schema', inferSchemaFromJson(p.value));
      setInferOpen(false);
      toast.success('Schema gerado — revise os campos obrigatórios e formatos');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const switchSchemaMode = (m: 'visual' | 'json') => {
    if (m === 'json' && form) setSchemaJson(pretty(form.schema));
    if (m === 'visual') {
      const p = safeJsonParse(schemaJson);
      if (!p.ok) return toast.error(`JSON inválido: ${p.error}`);
      const v = requestSchemaDslSchema.safeParse(p.value);
      if (!v.success) return toast.error(v.error.issues[0]?.message ?? 'Schema inválido');
      set('schema', v.data);
    }
    setSchemaMode(m);
  };

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Cada webhook expõe /webhook/<slug>, valida o payload com um schema, dispara o fluxo publicado e devolve a resposta montada pelo template."
        actions={<Button variant="primary" onClick={() => open()}><Plus className="size-4" /> Novo webhook</Button>}
      />
      {isLoading ? <Loading /> : error ? <ErrorBox error={error} /> : !webhooks?.length ? (
        <EmptyState icon={<WebhookIcon className="size-8" />} title="Nenhum webhook" action={<Button variant="primary" onClick={() => open()}>Cadastrar webhook</Button>}>
          Cadastre o endpoint que o sistema X vai chamar (ex.: <code>calcular-nota-vinicius</code>).
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {webhooks.map((w) => (
            <Card key={w.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold">{w.name}</span>
                    {w.active ? <Badge tone="ok">ativo</Badge> : <Badge>inativo</Badge>}
                    {w.token && <Badge tone="info">com token</Badge>}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1 font-mono text-[12.5px] text-muted">
                    <Globe className="size-3.5" /> POST {webhookUrl(w.slug, base)}
                    <CopyButton text={webhookUrl(w.slug, base)} label="" />
                  </div>
                  <div className="mt-1 text-[12.5px] text-muted">
                    Fluxo: <b className="text-fg">{w.flowName}</b> · {w.requestSchema.fields.length} campos no schema · {w.executionCount ?? 0} execuções
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Switch checked={w.active} onCheckedChange={() => toggle.mutate(w)} label="" />
                  <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => open(w)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => window.confirm(`Excluir o webhook "${w.name}"?`) && remove.mutate(w.id)}>
                    <Trash2 className="size-4 text-danger" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!form}
        onOpenChange={(o) => !o && setForm(null)}
        title={form?.id ? 'Editar webhook' : 'Novo webhook'}
        description={form ? <span className="font-mono">{url}</span> : undefined}
        size="xl"
        footer={
          <>
            <Button onClick={() => setForm(null)}>Fechar</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </>
        }
      >
        {form && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="geral">Geral</TabsTrigger>
              <TabsTrigger value="schema">Schema do payload</TabsTrigger>
              <TabsTrigger value="resposta">Resposta</TabsTrigger>
              <TabsTrigger value="testar">Testar</TabsTrigger>
            </TabsList>

            <TabsContent value="geral" className="space-y-4 pt-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Nome" required error={errors.name}>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value, ...(!form.id && (!form.slug || form.slug === slugify(form.name)) ? { slug: slugify(e.target.value) } : {}) })}
                    invalid={!!errors.name}
                  />
                </Field>
                <Field label="Slug (final da URL)" required error={errors.slug} hint={`URL pública: ${url}`}>
                  <Input className="font-mono" value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="calcular-nota-vinicius" invalid={!!errors.slug} />
                </Field>
                <Field label="Fluxo executado" required error={errors.flowId} hint="Usa sempre a última versão publicada do fluxo.">
                  <Select value={form.flowId} onValueChange={(v) => set('flowId', v)} options={flowOptions} invalid={!!errors.flowId} />
                </Field>
                <Field label="Token (opcional)" error={errors.token} hint="Se preenchido, o sistema X deve enviar o header X-Webhook-Token.">
                  <Input value={form.token} onChange={(e) => set('token', e.target.value)} placeholder="mínimo de 8 caracteres" />
                </Field>
                <Field label="Campo da data de vigência" hint="Define qual data escolhe as alíquotas e overrides vigentes (padrão: dataEmissao).">
                  <Input className="font-mono" value={form.dateField} onChange={(e) => set('dateField', e.target.value)} />
                </Field>
                <Field label="Campo de idempotência" hint="Valor deste campo evita emitir a nota duas vezes (o header Idempotency-Key tem prioridade).">
                  <Input className="font-mono" value={form.idempotencyField} onChange={(e) => set('idempotencyField', e.target.value)} placeholder="id" />
                </Field>
              </div>
              <Field label="Descrição"><Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
              <Switch checked={form.active} onCheckedChange={(v) => set('active', v)} label="Ativo (desativado responde 404)" />
            </TabsContent>

            <TabsContent value="schema" className="space-y-3 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex rounded-lg border border-border p-0.5">
                  {(['visual', 'json'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => switchSchemaMode(m)} className={cn('cursor-pointer rounded-md px-3 py-1 text-[12.5px] font-medium', schemaMode === m ? 'bg-accent-soft text-accent' : 'text-muted')}>
                      {m === 'visual' ? 'Visual' : 'JSON'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => { setInferText(pretty(sampleFromDsl(EXEMPLO_REQUEST_SCHEMA))); setInferOpen(true); }}>
                    <Sparkles className="size-3.5" /> Inferir de JSON de exemplo
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { set('schema', EXEMPLO_REQUEST_SCHEMA); setSchemaJson(pretty(EXEMPLO_REQUEST_SCHEMA)); }}>Usar schema de pedido padrão</Button>
                </div>
              </div>
              {errors['requestSchema'] && <ErrorBox error={new Error(errors['requestSchema'])} />}
              {schemaMode === 'visual' ? (
                <SchemaBuilder value={form.schema} onChange={(s) => set('schema', s)} />
              ) : (
                <CodeEditor language="json" value={schemaJson} onChange={setSchemaJson} height={420} />
              )}
              <p className="text-[12px] text-muted">
                Campos não declarados são descartados. Tipos não são convertidos: número como texto ("5" em campo inteiro) é rejeitado com 422.
              </p>
            </TabsContent>

            <TabsContent value="resposta" className="space-y-3 pt-4">
              <Field label="Template da resposta (JSON)" error={errors.template} hint={'Use {{caminho}}. Se a string for só um token, o tipo original é mantido (objetos, listas, números).'}>
                <CodeEditor language="json" value={form.template} onChange={(v) => set('template', v)} height={300} />
              </Field>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[12px] font-semibold tracking-wide text-muted uppercase">Caminhos disponíveis (clique para copiar)</span>
                  <Button size="sm" variant="ghost" onClick={() => set('template', pretty(EXEMPLO_RESPONSE_TEMPLATE))}>Usar template padrão</Button>
                </div>
                <TemplatePaths flowId={form.flowId} schema={form.schema} />
              </div>
            </TabsContent>

            <TabsContent value="testar"><TestConsole form={form} url={url} /></TabsContent>
          </Tabs>
        )}
      </Dialog>

      <Dialog
        open={inferOpen}
        onOpenChange={setInferOpen}
        title="Inferir schema de um JSON de exemplo"
        description="Cole um payload real do sistema X. Os campos viram obrigatórios e formatos comuns (CNPJ, NCM, UF, datas) são reconhecidos."
        size="lg"
        footer={<><Button onClick={() => setInferOpen(false)}>Cancelar</Button><Button variant="primary" onClick={applyInfer}>Gerar schema</Button></>}
      >
        <CodeEditor language="json" value={inferText} onChange={setInferText} height={360} />
      </Dialog>
    </>
  );
}
