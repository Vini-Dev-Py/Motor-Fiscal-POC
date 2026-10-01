import { useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { api, type Execution } from '@/lib/api';
import { useExecutions, useTenantQuery, useWebhooks } from '@/lib/queries';
import { formatDateTime, formatMs, pretty } from '@/lib/utils';
import {
  Button, Card, CopyButton, Dialog, EmptyState, ErrorBox, JsonBlock, Loading, PageHeader, Select, Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui';
import { ExecStatusBadge, TraceTree } from '@/components/trace';
import { CodeEditor } from '@/components/code-editor';

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos os status' },
  { value: 'OK', label: 'Sucesso' },
  { value: 'ERRO', label: 'Erro' },
  { value: 'REJEITADA', label: 'Rejeitada' },
];

function formatXml(xml: string): string {
  // indentação simples para leitura
  let depth = 0;
  return xml
    .replace(/(>)(<)(\/*)/g, '$1\n$2$3')
    .split('\n')
    .map((line) => {
      if (/^<\/.+>/.test(line)) depth = Math.max(depth - 1, 0);
      const out = `${'  '.repeat(depth)}${line}`;
      if (/^<[^!?/][^>]*[^/]>.*$/.test(line) && !/<\/.+>$/.test(line)) depth++;
      return out;
    })
    .join('\n');
}

function ExecutionDetail({ id }: { id: string }) {
  const { data, isLoading, error } = useTenantQuery(['execution', id], () => api.get<Execution>(`/api/executions/${id}`));
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error ?? new Error('Execução não encontrada')} />;
  const out = data.output as { nota?: { xml?: string } } | null;
  const xml = out?.nota?.xml;
  const errMsg = (data.output as { erro?: { mensagem?: string; codigo?: string } } | null)?.erro;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
        <ExecStatusBadge status={data.status} />
        <span className="text-muted">HTTP <b className="text-fg">{data.httpStatus ?? '—'}</b></span>
        <span className="text-muted">Duração <b className="text-fg">{formatMs(data.durationMs)}</b></span>
        <span className="text-muted">Versão do fluxo <b className="text-fg">{data.flowVersion ? `v${data.flowVersion.version}` : '—'}</b></span>
        {data.idempotencyKey && <span className="text-muted">Chave <code className="font-mono text-fg">{data.idempotencyKey}</code></span>}
        <span className="ml-auto text-faint">{formatDateTime(data.createdAt)}</span>
      </div>
      {errMsg && (
        <div className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger">
          <b>{errMsg.codigo}</b> — {errMsg.mensagem}
        </div>
      )}
      <Tabs defaultValue="trace">
        <TabsList>
          <TabsTrigger value="trace">Execução passo a passo</TabsTrigger>
          <TabsTrigger value="input">Payload recebido</TabsTrigger>
          <TabsTrigger value="output">Resposta</TabsTrigger>
          {xml && <TabsTrigger value="xml">XML da NF-e</TabsTrigger>}
        </TabsList>
        <TabsContent value="trace" className="pt-3">
          <TraceTree trace={data.trace ?? []} />
        </TabsContent>
        <TabsContent value="input" className="pt-3">
          <div className="mb-2 flex justify-end"><CopyButton text={pretty(data.input)} /></div>
          <JsonBlock value={data.input} maxHeight={460} />
        </TabsContent>
        <TabsContent value="output" className="pt-3">
          <div className="mb-2 flex justify-end"><CopyButton text={pretty(data.output)} /></div>
          <JsonBlock value={data.output} maxHeight={460} />
        </TabsContent>
        {xml && (
          <TabsContent value="xml" className="pt-3">
            <div className="mb-2 flex justify-end"><CopyButton text={xml} label="Copiar XML" /></div>
            <CodeEditor language="xml" value={formatXml(xml)} height={460} readOnly />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export function ExecutionsPage() {
  const [webhookId, setWebhookId] = useState('all');
  const [status, setStatus] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: webhooks } = useWebhooks();
  const { data, isLoading, error, refetch, isFetching } = useExecutions({
    webhookId: webhookId === 'all' ? undefined : webhookId,
    status: status === 'all' ? undefined : status,
  });

  return (
    <>
      <PageHeader
        title="Execuções"
        description="Cada chamada de webhook fica registrada com o payload, a resposta e o passo a passo de cada bloco (inclusive overrides aplicados)."
        actions={
          <Button onClick={() => void refetch()} loading={isFetching}>
            <RefreshCw className="size-4" /> Atualizar
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          className="w-64"
          value={webhookId}
          onValueChange={setWebhookId}
          options={[{ value: 'all', label: 'Todos os webhooks' }, ...(webhooks ?? []).map((w) => ({ value: w.id, label: w.name }))]}
        />
        <Select className="w-48" value={status} onValueChange={setStatus} options={STATUS_OPTIONS} />
      </div>

      {isLoading ? <Loading /> : error ? <ErrorBox error={error} /> : !data?.length ? (
        <EmptyState icon={<Activity className="size-8" />} title="Nenhuma execução ainda">
          Dispare um webhook (na tela de Webhooks há um console de teste) e o resultado aparece aqui.
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border bg-surface-2 text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Quando</th>
                <th className="px-4 py-2.5 font-medium">Webhook</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">HTTP</th>
                <th className="px-4 py-2.5 font-medium">Duração</th>
                <th className="px-4 py-2.5 font-medium">Chave de idempotência</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} onClick={() => setOpenId(e.id)} className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted">{formatDateTime(e.createdAt)}</td>
                  <td className="px-4 py-2.5">{e.webhook?.name ?? <span className="text-faint">—</span>}</td>
                  <td className="px-4 py-2.5"><ExecStatusBadge status={e.status} /></td>
                  <td className="px-4 py-2.5 font-mono">{e.httpStatus ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-muted">{formatMs(e.durationMs)}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-muted">{e.idempotencyKey ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)} title="Detalhe da execução" description={openId ? <span className="font-mono">{openId}</span> : undefined} size="xl">
        {openId && <ExecutionDetail id={openId} />}
      </Dialog>
    </>
  );
}
