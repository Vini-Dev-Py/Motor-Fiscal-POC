import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { REGIMES, REGIME_LABELS, UFS, tenantInputSchema, type Regime } from '@motor-fiscal/shared';
import { api, errorMessage, type Tenant } from '@/lib/api';
import { zodErrors } from '@/lib/forms';
import { useTenant } from '@/lib/tenant';
import { formatCnpj } from '@/lib/utils';
import { Badge, Button, Card, Dialog, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Select } from '@/components/ui';

interface FormState {
  cnpj: string; razaoSocial: string; ie: string; uf: string; codMunicipio: string; regime: Regime; rbt12: string;
  anexo: 'I' | 'II'; banco: string; agencia: string; conta: string; carteira: string; beneficiario: string;
}

const empty: FormState = {
  cnpj: '', razaoSocial: '', ie: '', uf: 'SP', codMunicipio: '', regime: 'PRESUMIDO', rbt12: '', anexo: 'I',
  banco: '', agencia: '', conta: '', carteira: '', beneficiario: '',
};

const fromTenant = (t: Tenant): FormState => ({
  cnpj: t.cnpj, razaoSocial: t.razaoSocial, ie: t.ie ?? '', uf: t.uf, codMunicipio: t.codMunicipio, regime: t.regime,
  rbt12: t.rbt12 ?? '', anexo: t.config?.anexoSimples ?? 'I', banco: t.config?.boleto?.banco ?? '',
  agencia: t.config?.boleto?.agencia ?? '', conta: t.config?.boleto?.conta ?? '', carteira: t.config?.boleto?.carteira ?? '',
  beneficiario: t.config?.boleto?.beneficiario ?? '',
});

const toPayload = (f: FormState) => {
  const boleto = Object.fromEntries(
    Object.entries({ banco: f.banco, agencia: f.agencia, conta: f.conta, carteira: f.carteira, beneficiario: f.beneficiario }).filter(([, v]) => v.trim()),
  );
  return {
    cnpj: f.cnpj.trim(), razaoSocial: f.razaoSocial.trim(), ie: f.ie.trim() || null, uf: f.uf, codMunicipio: f.codMunicipio.trim(),
    regime: f.regime, rbt12: f.regime === 'SIMPLES' && f.rbt12.trim() ? f.rbt12.trim() : null,
    config: { ...(f.regime === 'SIMPLES' ? { anexoSimples: f.anexo } : {}), ...(Object.keys(boleto).length ? { boleto } : {}) },
  };
};

export function TenantsPage() {
  const { tenants, loading, current, setCurrentId } = useTenant();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Tenant | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const open = (t: Tenant | 'new') => {
    setEditing(t);
    setForm(t === 'new' ? empty : fromTenant(t));
    setErrors({});
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = toPayload(form);
      const parsed = tenantInputSchema.safeParse(payload);
      if (!parsed.success) {
        setErrors(zodErrors(parsed.error));
        throw new Error('Corrija os campos destacados');
      }
      if (form.regime === 'SIMPLES' && !payload.rbt12) {
        setErrors({ rbt12: 'Informe a RBT12 (receita dos últimos 12 meses) para calcular o Simples' });
        throw new Error('Corrija os campos destacados');
      }
      return editing === 'new' ? api.post<Tenant>('/api/tenants', payload) : api.put<Tenant>(`/api/tenants/${(editing as Tenant).id}`, payload);
    },
    onSuccess: (t) => {
      toast.success(editing === 'new' ? 'Empresa criada' : 'Empresa atualizada');
      void qc.invalidateQueries({ queryKey: ['tenants'] });
      if (editing === 'new') setCurrentId(t.id);
      setEditing(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/tenants/${id}`),
    onSuccess: () => {
      toast.success('Empresa removida');
      void qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <PageHeader
        title="Empresas"
        description="Cada empresa (tenant) tem seus próprios fluxos, webhooks, overrides e tabelas. Os dados fiscais abaixo alimentam os blocos de imposto."
        actions={
          <Button variant="primary" onClick={() => open('new')}>
            <Plus className="size-4" /> Nova empresa
          </Button>
        }
      />
      {loading ? (
        <Loading />
      ) : tenants.length === 0 ? (
        <EmptyState icon={<Building2 className="size-8" />} title="Nenhuma empresa" action={<Button variant="primary" onClick={() => open('new')}>Cadastrar empresa</Button>} />
      ) : (
        <div className="grid gap-3">
          {tenants.map((t) => (
            <Card key={t.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold">{t.razaoSocial}</span>
                  {t.id === current?.id && <Badge tone="accent">Selecionada</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
                  <span className="font-mono">{formatCnpj(t.cnpj)}</span>
                  <span>{t.uf} · mun. {t.codMunicipio}</span>
                  <Badge tone={t.regime === 'SIMPLES' ? 'warn' : t.regime === 'REAL' ? 'info' : 'neutral'}>{REGIME_LABELS[t.regime]}</Badge>
                  {t.rbt12 && <span>RBT12 R$ {Number(t.rbt12).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                  <span>Próx. NF-e nº {t.nfeProximoNumero}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {t.id !== current?.id && (
                  <Button size="sm" onClick={() => setCurrentId(t.id)}>
                    Usar esta
                  </Button>
                )}
                <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => open(t)}>
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost" size="icon" aria-label="Excluir"
                  onClick={() => window.confirm(`Excluir "${t.razaoSocial}" e todos os seus fluxos, webhooks e execuções?`) && remove.mutate(t.id)}
                >
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'Nova empresa' : 'Editar empresa'}
        description="O CNPJ aceita o formato alfanumérico (vigente a partir de julho/2026)."
        size="lg"
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Salvar
            </Button>
          </>
        }
      >
        {save.error && !Object.keys(errors).length && <ErrorBox error={save.error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CNPJ" required error={errors.cnpj}>
            <Input value={form.cnpj} onChange={(e) => set('cnpj', e.target.value.toUpperCase())} placeholder="11.222.333/0001-81" invalid={!!errors.cnpj} />
          </Field>
          <Field label="Razão social" required error={errors.razaoSocial}>
            <Input value={form.razaoSocial} onChange={(e) => set('razaoSocial', e.target.value)} invalid={!!errors.razaoSocial} />
          </Field>
          <Field label="Inscrição estadual" error={errors.ie}>
            <Input value={form.ie} onChange={(e) => set('ie', e.target.value)} />
          </Field>
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <Field label="UF" required error={errors.uf}>
              <Select value={form.uf} onValueChange={(v) => set('uf', v)} options={UFS.map((u) => ({ value: u, label: u }))} />
            </Field>
            <Field label="Cód. município (IBGE)" required error={errors.codMunicipio}>
              <Input value={form.codMunicipio} onChange={(e) => set('codMunicipio', e.target.value)} placeholder="3550308" invalid={!!errors.codMunicipio} />
            </Field>
          </div>
          <Field label="Regime tributário" required>
            <Select value={form.regime} onValueChange={(v) => set('regime', v as Regime)} options={REGIMES.map((r) => ({ value: r, label: REGIME_LABELS[r] }))} />
          </Field>
          {form.regime === 'SIMPLES' && (
            <>
              <Field label="RBT12 (R$)" required error={errors.rbt12} hint="Receita bruta dos últimos 12 meses">
                <Input inputMode="decimal" value={form.rbt12} onChange={(e) => set('rbt12', e.target.value)} placeholder="300000.00" invalid={!!errors.rbt12} />
              </Field>
              <Field label="Anexo do Simples">
                <Select value={form.anexo} onValueChange={(v) => set('anexo', v as 'I' | 'II')} options={[{ value: 'I', label: 'Anexo I — Comércio' }, { value: 'II', label: 'Anexo II — Indústria' }]} />
              </Field>
            </>
          )}
        </div>

        <div className="mt-6 border-t border-border pt-4">
          <div className="mb-3 text-[13px] font-semibold">Boleto (opcional)</div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Banco" error={errors['config.boleto.banco']}><Input value={form.banco} onChange={(e) => set('banco', e.target.value)} placeholder="341" /></Field>
            <Field label="Agência"><Input value={form.agencia} onChange={(e) => set('agencia', e.target.value)} /></Field>
            <Field label="Conta"><Input value={form.conta} onChange={(e) => set('conta', e.target.value)} /></Field>
            <Field label="Carteira"><Input value={form.carteira} onChange={(e) => set('carteira', e.target.value)} /></Field>
            <Field label="Beneficiário" className="sm:col-span-2"><Input value={form.beneficiario} onChange={(e) => set('beneficiario', e.target.value)} /></Field>
          </div>
        </div>
      </Dialog>
    </>
  );
}
