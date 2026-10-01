import { describe, expect, it } from 'vitest';
import {
  chaveAcessoDv, cnpjWithDv, isValidChaveNfe, isValidCnpj, isValidCpf, isValidIsoDate,
  isPortCompatible, validatePortValue, validatePayload, inferSchemaFromJson, renderTemplate,
  EXEMPLO_PEDIDO, EXEMPLO_REQUEST_SCHEMA, pedidoSchema, requestSchemaDslSchema, tenantInputSchema,
} from './index';

describe('validadores BR', () => {
  it('valida CNPJ numérico (com e sem máscara)', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });

  it('valida CNPJ alfanumérico (exemplo oficial 12.ABC.345/01DE-35)', () => {
    expect(cnpjWithDv('12ABC34501DE')).toBe('12ABC34501DE35');
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12ABC34501DE36')).toBe(false);
  });

  it('valida CPF', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224726')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
  });

  it('valida a chave de acesso pelo DV módulo 11', () => {
    const base = '3526091122233300018155001000000001100000012';
    expect(base).toHaveLength(43);
    const chave = base + chaveAcessoDv(base);
    expect(isValidChaveNfe(chave)).toBe(true);
    expect(isValidChaveNfe(chave.slice(0, 43) + ((chaveAcessoDv(base) + 1) % 10))).toBe(false);
  });

  it('valida datas ISO', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
  });
});

describe('portas', () => {
  it('compatibilidade de tipos', () => {
    expect(isPortCompatible('decimal', 'decimal')).toBe(true);
    expect(isPortCompatible('integer', 'decimal')).toBe(true);
    expect(isPortCompatible('decimal', 'integer')).toBe(false);
    expect(isPortCompatible('tributo', 'object')).toBe(true);
    expect(isPortCompatible('object', 'tributo')).toBe(false);
    expect(isPortCompatible('any', 'tributo')).toBe(true);
    expect(isPortCompatible('uf', 'string')).toBe(true);
    expect(isPortCompatible('string', 'uf')).toBe(false);
  });

  it('normaliza decimais para string e rejeita lixo', () => {
    expect(validatePortValue('decimal', 10.5)).toEqual({ ok: true, value: '10.5' });
    expect(validatePortValue('decimal', 'abc').ok).toBe(false);
    expect(validatePortValue('tributo', { base: 1, aliquota: '18', valor: 0.18 })).toMatchObject({ ok: true });
    expect(validatePortValue('tributo', { base: 1 }).ok).toBe(false);
  });
});

describe('DSL do webhook', () => {
  it('o schema de exemplo é uma DSL válida e aceita o payload de exemplo', () => {
    expect(requestSchemaDslSchema.safeParse(EXEMPLO_REQUEST_SCHEMA).success).toBe(true);
    const r = validatePayload(EXEMPLO_REQUEST_SCHEMA, EXEMPLO_PEDIDO);
    expect(r.success).toBe(true);
    if (r.success) {
      // decimais number viram string
      expect((r.data.itens as any[])[0].quantidade).toBe('10');
    }
  });

  it('o payload de exemplo também é aceito pelo pedido canônico', () => {
    expect(pedidoSchema.safeParse(EXEMPLO_PEDIDO).success).toBe(true);
  });

  it('rejeita tipos e formatos inválidos com mensagens em pt-BR', () => {
    const bad = JSON.parse(JSON.stringify(EXEMPLO_PEDIDO)) as any;
    bad.destinatario.documento = '123';
    bad.itens[0].ncm = '61';
    bad.itens[0].quantidade = 'dez';
    delete bad.dataEmissao;
    const r = validatePayload(EXEMPLO_REQUEST_SCHEMA, bad);
    expect(r.success).toBe(false);
    if (!r.success) {
      const byPath = Object.fromEntries(r.issues.map((i) => [i.path, i.message]));
      expect(byPath['dataEmissao']).toBe('Campo obrigatório');
      expect(byPath['destinatario.documento']).toBe('CNPJ/CPF inválido');
      expect(byPath['itens.0.ncm']).toBe('NCM inválido (8 dígitos)');
      expect(byPath['itens.0.quantidade']).toMatch(/inválido/i);
    }
  });

  it('não converte tipos silenciosamente (número como texto é erro)', () => {
    const r = validatePayload(
      { fields: [{ name: 'qtd', type: 'integer', required: true }] },
      { qtd: '5' },
    );
    expect(r.success).toBe(false);
  });

  it('campos opcionais aceitam null/ausência e listas respeitam minItems', () => {
    const dsl = {
      fields: [
        { name: 'obs', type: 'string' as const, required: false },
        { name: 'xs', type: 'array' as const, required: true, minItems: 1, items: { name: 'i', type: 'integer' as const, required: true } },
      ],
    };
    expect(validatePayload(dsl, { obs: null, xs: [1] }).success).toBe(true);
    expect(validatePayload(dsl, { xs: [] }).success).toBe(false);
  });

  it('rejeita DSL com nomes duplicados ou enum vazio', () => {
    const dup = { fields: [{ name: 'a', type: 'string', required: true }, { name: 'a', type: 'string', required: true }] };
    expect(requestSchemaDslSchema.safeParse(dup).success).toBe(false);
    const en = { fields: [{ name: 'a', type: 'enum', required: true }] };
    expect(requestSchemaDslSchema.safeParse(en).success).toBe(false);
  });

  it('infere a DSL a partir de um JSON de exemplo', () => {
    const dsl = inferSchemaFromJson(EXEMPLO_PEDIDO);
    expect(requestSchemaDslSchema.safeParse(dsl).success).toBe(true);
    const ncm = (dsl.fields.find((f) => f.name === 'itens')!.items!.fields!).find((f) => f.name === 'ncm')!;
    expect(ncm.format).toBe('ncm');
    expect(dsl.fields.find((f) => f.name === 'dataEmissao')!.type).toBe('date');
    expect(validatePayload(dsl, EXEMPLO_PEDIDO).success).toBe(true);
  });
});

describe('template de resposta', () => {
  const scope = { input: { id: 'P1' }, nodes: { t: { totais: { vNF: '10.00' }, lista: [{ a: 1 }] } } };
  it('preserva o tipo quando a string é só um token', () => {
    expect(renderTemplate('{{nodes.t.totais}}', scope)).toEqual({ vNF: '10.00' });
    expect(renderTemplate('{{nodes.t.lista[0].a}}', scope)).toBe(1);
  });
  it('interpola texto e percorre objetos/listas', () => {
    expect(renderTemplate({ msg: 'Pedido {{input.id}} ok', xs: ['{{input.id}}'] }, scope)).toEqual({
      msg: 'Pedido P1 ok',
      xs: ['P1'],
    });
  });
  it('caminho inexistente vira null (token único) ou vazio (interpolado)', () => {
    expect(renderTemplate('{{nodes.x.y}}', scope)).toBeNull();
    expect(renderTemplate('a{{nodes.x.y}}b', scope)).toBe('ab');
  });
});

describe('empresa', () => {
  it('valida o cadastro de empresa', () => {
    const ok = tenantInputSchema.safeParse({
      cnpj: '11222333000181', razaoSocial: 'Empresa X', uf: 'SP', codMunicipio: '3550308', regime: 'PRESUMIDO',
    });
    expect(ok.success).toBe(true);
    const bad = tenantInputSchema.safeParse({ cnpj: '1', razaoSocial: 'E', uf: 'XX', codMunicipio: '1', regime: 'Z' });
    expect(bad.success).toBe(false);
  });
});
