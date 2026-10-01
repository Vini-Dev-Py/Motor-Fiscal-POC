import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EXEMPLO_PEDIDO, EXEMPLO_REQUEST_SCHEMA, EXEMPLO_RESPONSE_TEMPLATE, cnpjWithDv } from '@motor-fiscal/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { SeedService } from '../src/seed/seed.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * E2E contra o Postgres do docker compose (DATABASE_URL). Usa os dados de demonstração do seed
 * (criados se o banco estiver vazio) e limpa o que cria.
 */
describe('Motor Fiscal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let vinicius: { id: string };
  let industria: { id: string };
  let flowId: string;
  const run = `e2e-${Date.now()}`;

  const pedido = (id: string, over: Record<string, unknown> = {}) => ({ ...JSON.parse(JSON.stringify(EXEMPLO_PEDIDO)), id, ...over });
  const tenantHeader = (id: string) => ({ 'X-Tenant-Id': id });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await app.get(SeedService).run();
    http = request(app.getHttpServer());

    const tenants = (await http.get('/api/tenants').expect(200)).body as Array<{ id: string; cnpj: string }>;
    vinicius = tenants.find((t) => t.cnpj === '11222333000181')!;
    industria = tenants.find((t) => t.cnpj === cnpjWithDv('987654320001'))!;
    expect(vinicius).toBeDefined();
    expect(industria).toBeDefined();
    const flows = (await http.get('/api/flows?kind=PEDIDO').set(tenantHeader(vinicius.id)).expect(200)).body as Array<{ id: string }>;
    flowId = flows[0]!.id;
  });

  afterAll(async () => {
    await prisma.execution.deleteMany({ where: { idempotencyKey: { startsWith: run } } });
    await prisma.execution.deleteMany({ where: { idempotencyKey: { startsWith: 'PED-' + run } } });
    await app.close();
  });

  // -------------------------------------------------------------------------
  describe('webhook público', () => {
    it('processa o pedido: impostos, NF-e (mock), parcelas e boletos', async () => {
      const res = await http.post('/webhook/calcular-nota-vinicius').send(pedido(`${run}-1`)).expect(200);
      expect(res.headers['x-execution-id']).toBeTruthy();
      const b = res.body;
      expect(b.status).toBe('AUTORIZADA');
      expect(b.nota.chaveAcesso).toMatch(/^35\d{42}$/);
      expect(b.nota.protocolo).toHaveLength(15);
      expect(b.nota.xml).toContain('<vICMS>189.00</vICMS>');
      expect(b.totais).toMatchObject({ vProd: '1000.00', vNF: '1050.00', vICMS: '189.00' });
      expect(b.impostosPorItem[0].pis.valor).toBe('5.60');
      expect(b.financeiro.parcelas).toHaveLength(3);
      expect(b.financeiro.boletos).toHaveLength(3);
      expect(b.financeiro.boletos[0].linhaDigitavel).toMatch(/^\d{5}\.\d{5} \d{5}\.\d{6} \d{5}\.\d{6} \d \d{14}$/);
    });

    it('a numeração da NF-e avança a cada pedido novo', async () => {
      const a = (await http.post('/webhook/calcular-nota-vinicius').send(pedido(`${run}-n1`)).expect(200)).body;
      const c = (await http.post('/webhook/calcular-nota-vinicius').send(pedido(`${run}-n2`)).expect(200)).body;
      expect(Number(c.nota.numero)).toBe(Number(a.nota.numero) + 1);
    });

    it('responde 422 com os problemas do payload (tipos, formatos, obrigatórios)', async () => {
      const bad = pedido(`${run}-bad`);
      (bad.destinatario as any).documento = '123';
      (bad.itens as any[])[0].ncm = '61';
      (bad.itens as any[])[0].quantidade = 'dez';
      delete (bad as any).dataEmissao;
      const res = await http.post('/webhook/calcular-nota-vinicius').send(bad).expect(422);
      expect(res.body.erro.codigo).toBe('PAYLOAD_INVALIDO');
      const paths = res.body.erro.detalhes.map((d: any) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['dataEmissao', 'destinatario.documento', 'itens.0.ncm', 'itens.0.quantidade']));
      expect(res.body.executionId).toBeTruthy();
    });

    it('idempotência: o mesmo pedido não emite outra nota', async () => {
      const p = pedido(`${run}-idem`);
      const first = await http.post('/webhook/calcular-nota-vinicius').send(p).expect(200);
      const second = await http.post('/webhook/calcular-nota-vinicius').send(p).expect(200);
      expect(second.headers['idempotent-replay']).toBe('true');
      expect(second.headers['x-execution-id']).toBe(first.headers['x-execution-id']);
      expect(second.body.nota.chaveAcesso).toBe(first.body.nota.chaveAcesso);
      // a chave também pode vir no header
      const h1 = await http.post('/webhook/calcular-nota-vinicius').set('Idempotency-Key', `${run}-hdr`).send(pedido(`${run}-h1`)).expect(200);
      const h2 = await http.post('/webhook/calcular-nota-vinicius').set('Idempotency-Key', `${run}-hdr`).send(pedido(`${run}-h2`)).expect(200);
      expect(h2.body.nota.chaveAcesso).toBe(h1.body.nota.chaveAcesso);
    });

    it('requisições simultâneas com a mesma chave emitem uma nota só', async () => {
      const p = pedido(`${run}-conc`);
      const rs = await Promise.all([1, 2, 3].map(() => http.post('/webhook/calcular-nota-vinicius').send(p)));
      const ok = rs.filter((r) => r.status === 200);
      const chaves = new Set(ok.map((r) => r.body.nota.chaveAcesso));
      expect(ok.length).toBeGreaterThanOrEqual(1);
      expect(chaves.size).toBe(1);
      expect(rs.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    });

    it('404 para webhook inexistente', async () => {
      const res = await http.post('/webhook/nao-existe').send({}).expect(404);
      expect(res.body.erro.codigo).toBe('WEBHOOK_NAO_ENCONTRADO');
    });

    it('a liminar da Indústria reduz a base do ICMS (override) e fica registrada no trace', async () => {
      const p = pedido(`${run}-lim`, { destinatario: { ...EXEMPLO_PEDIDO.destinatario, uf: 'SP' } });
      const res = await http.post('/webhook/calcular-nota-industria').send(p).expect(200);
      expect(res.body.impostosPorItem[0].icms).toMatchObject({ base: '525.00', valor: '63.00', aliquota: '12' });
      const ex = await http.get(`/api/executions/${res.headers['x-execution-id']}`).set(tenantHeader(industria.id)).expect(200);
      const flat = JSON.stringify(ex.body.trace);
      expect(flat).toContain('Liminar');
      expect(ex.body.status).toBe('OK');
    });

    it('o Simples Nacional toma o ramo próprio (CSOSN 101)', async () => {
      const p = pedido(`${run}-sn`);
      const res = await http.post('/webhook/calcular-nota-loja-simples').send(p).expect(200);
      expect(res.body.impostosPorItem[0].icms.csosn).toBe('101');
      expect(res.body.totais.vICMS).toBe('0.00');
    });
  });

  // -------------------------------------------------------------------------
  describe('cadastro de webhooks', () => {
    let createdId: string;
    const slug = `e2e-${Date.now().toString(36)}`;
    const body = () => ({
      name: 'Webhook de teste', slug, flowId, requestSchema: EXEMPLO_REQUEST_SCHEMA,
      responseTemplate: { pedido: '{{input.id}}', total: '{{nodes.totalizar.totais.vNF}}', msg: 'Nota {{nodes.chave.numero}} emitida' },
      token: 'segredo-123456', config: { dateField: 'dataEmissao' },
    });

    afterAll(async () => {
      if (createdId) {
        await prisma.execution.deleteMany({ where: { webhookId: createdId } });
        await prisma.webhookEndpoint.deleteMany({ where: { id: createdId } });
      }
    });

    it('valida slug e schema no cadastro', async () => {
      await http.post('/api/webhooks').set(tenantHeader(vinicius.id)).send({ ...body(), slug: 'Slug Inválido' }).expect(422);
      await http.post('/api/webhooks').set(tenantHeader(vinicius.id)).send({ ...body(), requestSchema: { fields: [{ name: 'a', type: 'enum', required: true }] } }).expect(422);
      await http.post('/api/webhooks').send(body()).expect(400); // sem X-Tenant-Id
    });

    it('cria, exige o token e monta a resposta pelo template', async () => {
      const created = await http.post('/api/webhooks').set(tenantHeader(vinicius.id)).send(body()).expect(201);
      createdId = created.body.id;
      await http.post('/api/webhooks').set(tenantHeader(vinicius.id)).send(body()).expect(409); // slug repetido

      await http.post(`/webhook/${slug}`).send(pedido(`${run}-tk1`)).expect(401);
      await http.post(`/webhook/${slug}`).set('X-Webhook-Token', 'errado-errado').send(pedido(`${run}-tk2`)).expect(401);
      const res = await http.post(`/webhook/${slug}`).set('X-Webhook-Token', 'segredo-123456').send(pedido(`${run}-tk3`)).expect(200);
      expect(res.body.pedido).toBe(`${run}-tk3`);
      expect(res.body.total).toBe('1050.00');
      expect(res.body.msg).toMatch(/^Nota \d+ emitida$/);
    });

    it('webhook desativado responde 404', async () => {
      const w = (await http.get(`/api/webhooks/${createdId}`).set(tenantHeader(vinicius.id)).expect(200)).body;
      await http.put(`/api/webhooks/${createdId}`).set(tenantHeader(vinicius.id)).send({ ...body(), token: 'segredo-123456', active: false, id: w.id }).expect(200);
      await http.post(`/webhook/${slug}`).set('X-Webhook-Token', 'segredo-123456').send(pedido(`${run}-off`)).expect(404);
    });

    it('não cadastra webhook apontando para fluxo de outra empresa', async () => {
      const other = (await http.get('/api/flows?kind=PEDIDO').set(tenantHeader(industria.id)).expect(200)).body[0].id;
      await http.post('/api/webhooks').set(tenantHeader(vinicius.id)).send({ ...body(), slug: `${slug}-x`, flowId: other }).expect(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('fluxos', () => {
    it('valida o fluxo padrão e bloqueia a publicação de fluxo com erro', async () => {
      const v = await http.post(`/api/flows/${flowId}/validate`).set(tenantHeader(vinicius.id)).send({}).expect(200);
      expect(v.body.valid).toBe(true);

      const empty = await http.post('/api/flows').set(tenantHeader(vinicius.id)).send({ name: 'Fluxo vazio e2e' }).expect(201);
      const pub = await http.post(`/api/flows/${empty.body.id}/publish`).set(tenantHeader(vinicius.id)).expect(422);
      expect(pub.body.issues.some((i: any) => /Webhook recebido/.test(i.message))).toBe(true);
      await http.delete(`/api/flows/${empty.body.id}`).set(tenantHeader(vinicius.id)).expect(204);
    });

    it('teste a seco devolve o trace nó a nó e não grava execução', async () => {
      const before = await prisma.execution.count({ where: { tenantId: vinicius.id } });
      const res = await http.post(`/api/flows/${flowId}/run`).set(tenantHeader(vinicius.id)).send({ payload: pedido(`${run}-dry`) }).expect(200);
      expect(res.body.status).toBe('OK');
      expect(res.body.nodes.totalizar.totais.vNF).toBe('1050.00');
      expect(res.body.trace.find((t: any) => t.nodeId === 'itens').children).toHaveLength(1);
      expect(await prisma.execution.count({ where: { tenantId: vinicius.id } })).toBe(before);
    });

    it('publica nova versão; a versão anterior continua intacta (imutável)', async () => {
      const original = (await http.get(`/api/flows/${flowId}`).set(tenantHeader(vinicius.id)).expect(200)).body;
      const copy = await http
        .post('/api/flows')
        .set(tenantHeader(vinicius.id))
        .send({ name: 'Cópia e2e', draftGraph: original.draftGraph })
        .expect(201);
      const v1 = await http.post(`/api/flows/${copy.body.id}/publish`).set(tenantHeader(vinicius.id)).expect(201);
      const v2 = await http.post(`/api/flows/${copy.body.id}/publish`).set(tenantHeader(vinicius.id)).expect(201);
      expect(v1.body.version).toBe(1);
      expect(v2.body.version).toBe(2);
      const versions = await http.get(`/api/flows/${copy.body.id}/versions`).set(tenantHeader(vinicius.id)).expect(200);
      expect(versions.body.map((v: any) => v.version)).toEqual([2, 1]);
      await http.delete(`/api/flows/${copy.body.id}`).set(tenantHeader(vinicius.id)).expect(204);
    });

    it('não apaga fluxo que está em uso por webhook ou como subfluxo', async () => {
      await http.delete(`/api/flows/${flowId}`).set(tenantHeader(vinicius.id)).expect(409);
      const sub = (await http.get('/api/flows?kind=SUBFLUXO').set(tenantHeader(vinicius.id))).body[0];
      await http.delete(`/api/flows/${sub.id}`).set(tenantHeader(vinicius.id)).expect(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('overrides e sandbox de código', () => {
    const created: string[] = [];
    const mk = async (code: string | null, params: Record<string, unknown> = {}) => {
      const res = await http
        .post('/api/overrides')
        .set(tenantHeader(vinicius.id))
        .send({ blockKey: 'tax.icms', name: `e2e ${created.length}`, code, params, validFrom: '2026-01-01', active: false, legalBasis: 'teste e2e' })
        .expect(201);
      created.push(res.body.id);
      return res.body.id as string;
    };
    const test = async (id: string) => {
      const sample = (await http.get('/api/blocks/tax.icms/sample-inputs').set(tenantHeader(vinicius.id)).expect(200)).body;
      return (await http.post(`/api/overrides/${id}/test`).set(tenantHeader(vinicius.id)).send({ inputs: sample.inputs, referenceDate: '2026-09-30' }).expect(200)).body;
    };

    afterAll(async () => {
      await prisma.blockOverride.deleteMany({ where: { id: { in: created } } });
    });

    it('override só de parâmetros: compara padrão × override', async () => {
      const r = await test(await mk(null, { pRedBC: 50 }));
      expect(r.padrao.ok && r.override.ok).toBe(true);
      expect(r.padrao.outputs.icms.valor).toBe('189.00');
      expect(r.override.outputs.icms.valor).toBe('94.50');
      expect(r.diferencas.map((d: any) => d.path)).toEqual(expect.arrayContaining(['icms.base', 'icms.valor', 'icms.pRedBC']));
    });

    it('override com código calcula e passa pelo contrato de saída', async () => {
      const code = `function calcular({ inputs, D, tabela }) {
        const base = D(inputs.item.vProd).plus(inputs.item.vFrete).times('0.5');
        const aliq = tabela('icms_interna', { uf: 'SP' }).aliquota;
        return { icms: { base: base.toFixed(2), aliquota: aliq, valor: base.times(aliq).div(100).toFixed(2), aplicavel: true } };
      }`;
      const r = await test(await mk(code));
      expect(r.override).toMatchObject({ ok: true, override: { kind: 'codigo' } });
      expect(r.override.outputs.icms).toMatchObject({ base: '525.00', valor: '94.50' });
    });

    it('sandbox: loop infinito é interrompido pelo limite de tempo', async () => {
      const t0 = Date.now();
      const r = await test(await mk('function calcular() { while (true) {} }'));
      expect(r.override.ok).toBe(false);
      expect(r.override.error.code).toBe('CODIGO_TIMEOUT');
      expect(Date.now() - t0).toBeLessThan(8000);
      expect(r.padrao.ok).toBe(true); // o bloco padrão continua funcionando
    });

    it('sandbox: estouro de memória é barrado', async () => {
      const r = await test(await mk('function calcular() { const a = []; while (true) { a.push(new Array(1e6).fill(1)); } }'));
      expect(r.override.ok).toBe(false);
      expect(['CODIGO_MEMORIA', 'CODIGO_TIMEOUT']).toContain(r.override.error.code);
    });

    it('sandbox: sem acesso a process, require, rede ou sistema de arquivos', async () => {
      for (const probe of ['process.env.DATABASE_URL', "require('fs')", "fetch('http://localhost:3000/health')", "globalThis.process.exit()"]) {
        const r = await test(await mk(`function calcular() { return { x: String(${probe}) }; }`));
        expect(r.override.ok).toBe(false);
        expect(r.override.error.code).toBe('CODIGO_ERRO');
        expect(r.override.error.message).toMatch(/not defined|undefined|Cannot read/i);
      }
    });

    it('sandbox: saída fora do contrato e erro de sintaxe são rejeitados', async () => {
      const bad = await test(await mk("function calcular() { return { icms: { base: '1.00', aliquota: '18' } }; }"));
      expect(bad.override.error.code).toBe('SAIDA_INVALIDA');
      const syn = await test(await mk('function calcular( { return ; '));
      expect(syn.override.error.code).toBe('CODIGO_ERRO');
      const noFn = await test(await mk('const x = 1;'));
      expect(noFn.override.error.message).toMatch(/calcular/);
    });

    it('rejeita override de bloco inexistente, sem alteração ou com parâmetro inválido', async () => {
      const base = { name: 'xx', validFrom: '2026-01-01', params: {}, code: null };
      await http.post('/api/overrides').set(tenantHeader(vinicius.id)).send({ ...base, blockKey: 'nao.existe', params: { a: 1 } }).expect(400);
      await http.post('/api/overrides').set(tenantHeader(vinicius.id)).send({ ...base, blockKey: 'tax.icms' }).expect(422);
      await http.post('/api/overrides').set(tenantHeader(vinicius.id)).send({ ...base, blockKey: 'tax.icms', params: { pRedBC: 500 } }).expect(400);
      await http.post('/api/overrides').set(tenantHeader(vinicius.id)).send({ ...base, blockKey: 'logic.condicao', params: { valor: 'x' } }).expect(400);
      await http.post('/api/overrides').set(tenantHeader(vinicius.id)).send({ ...base, blockKey: 'tax.icms', params: { pRedBC: 1 }, validTo: '2025-01-01' }).expect(422);
    });

    it('override não vaza para outra empresa', async () => {
      const id = await mk(null, { pRedBC: 10 });
      await http.get(`/api/overrides/${id}`).set(tenantHeader(industria.id)).expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('empresas, catálogo e tabelas', () => {
    it('cadastra empresa com CNPJ alfanumérico e recusa DV inválido / duplicado', async () => {
      const cnpj = cnpjWithDv('12ABC34501DE');
      const base = { razaoSocial: 'Empresa Alfa e2e', uf: 'SP', codMunicipio: '3550308', regime: 'PRESUMIDO' };
      await http.post('/api/tenants').send({ ...base, cnpj: '12ABC34501DE36' }).expect(422);
      await prisma.tenant.deleteMany({ where: { cnpj } });
      const ok = await http.post('/api/tenants').send({ ...base, cnpj }).expect(201);
      expect(ok.body).toMatchObject({ cnpj, crt: 3 });
      await http.post('/api/tenants').send({ ...base, cnpj }).expect(409);
      await http.delete(`/api/tenants/${ok.body.id}`).expect(204);
    });

    it('expõe o catálogo de blocos com contrato e esquema de parâmetros', async () => {
      const blocks = (await http.get('/api/blocks').expect(200)).body as Array<any>;
      expect(blocks.length).toBeGreaterThanOrEqual(30);
      const icms = blocks.find((b) => b.key === 'tax.icms');
      expect(icms.inputs.map((p: any) => p.id)).toEqual(expect.arrayContaining(['item', 'contexto']));
      expect(icms.outputs[0]).toMatchObject({ id: 'icms', type: 'tributo' });
      expect(icms.paramsSchema.properties.pRedBC).toBeDefined();
      expect(icms.overridable).toBe(true);
      expect(blocks.find((b) => b.key === 'logic.codigo').overridable).toBe(false);
    });

    it('tabelas de referência: a linha da empresa convive com a global', async () => {
      const tables = (await http.get('/api/reference-tables').set(tenantHeader(vinicius.id)).expect(200)).body;
      expect(tables.find((t: any) => t.key === 'ibs_cbs_aliquotas').rowCount).toBeGreaterThan(10);
      const row = await http
        .post('/api/reference-rows')
        .set(tenantHeader(vinicius.id))
        .send({ table: 'icms_interna', keys: { uf: 'SP' }, value: { aliquota: '19' }, validFrom: '2027-01-01', tenantSpecific: true })
        .expect(201);
      const list = (await http.get('/api/reference-rows?table=icms_interna').set(tenantHeader(vinicius.id)).expect(200)).body as any[];
      expect(list.some((r) => r.id === row.body.id && r.tenantSpecific)).toBe(true);
      // a outra empresa não enxerga a linha
      const other = (await http.get('/api/reference-rows?table=icms_interna').set(tenantHeader(industria.id)).expect(200)).body as any[];
      expect(other.some((r) => r.id === row.body.id)).toBe(false);
      await http.post('/api/reference-rows').set(tenantHeader(vinicius.id)).send({ table: 'tabela_falsa', value: {}, validFrom: '2027-01-01' }).expect(400);
      await http.delete(`/api/reference-rows/${row.body.id}`).set(tenantHeader(vinicius.id)).expect(204);
    });

    it('a vigência da tabela muda o cálculo do webhook (ICMS de SP em 2027)', async () => {
      const row = await prisma.referenceRow.create({
        data: { tenantId: vinicius.id, table: 'icms_interna', keys: { uf: 'SP' }, value: { aliquota: '19' }, validFrom: '2027-01-01' },
      });
      try {
        const in2026 = await http.post('/webhook/calcular-nota-vinicius').send(pedido(`${run}-v26`)).expect(200);
        const in2027 = await http.post('/webhook/calcular-nota-vinicius').send(pedido(`${run}-v27`, { dataEmissao: '2027-02-01' })).expect(200);
        expect(in2026.body.impostosPorItem[0].icms.aliquota).toBe('18');
        expect(in2027.body.impostosPorItem[0].icms.aliquota).toBe('19');
      } finally {
        await prisma.referenceRow.delete({ where: { id: row.id } });
      }
    });

    it('lista as execuções com o trace no detalhe', async () => {
      const list = (await http.get('/api/executions?limit=5').set(tenantHeader(vinicius.id)).expect(200)).body as any[];
      expect(list.length).toBeGreaterThan(0);
      expect(list[0].trace).toBeUndefined();
      const detail = (await http.get(`/api/executions/${list.find((e) => e.status === 'OK').id}`).set(tenantHeader(vinicius.id)).expect(200)).body;
      expect(detail.trace.length).toBeGreaterThan(5);
      expect(detail.input.id).toBeDefined();
    });
  });
});
