import { Controller, Get, Module, NotFoundException, Param } from '@nestjs/common';
import { CODIGO_TEMPLATE, defaultRegistry, listBlockMeta, type BlockDef } from '@motor-fiscal/engine';
import type { PortDef } from '@motor-fiscal/shared';
import { TenantId } from '../common/common';
import { EngineService } from '../engine/engine.service';

const SAMPLE_ITEM = {
  nItem: 1, codigo: 'CAM-001', descricao: 'Camiseta algodão', ncm: '61091000', origem: 0, unidade: 'UN',
  quantidade: '10', valorUnitario: '100', vProd: '1000.00', vDesc: '0.00', vFrete: '50.00', vSeg: '0.00', vOutro: '0.00',
};
const SAMPLE_TRIBUTO = { base: '1050.00', aliquota: '18', valor: '189.00', aplicavel: true };

function sampleFor(port: PortDef, contexto: unknown): unknown {
  switch (port.type) {
    case 'item': return SAMPLE_ITEM;
    case 'contexto': return contexto;
    case 'tributo': return SAMPLE_TRIBUTO;
    case 'decimal': return '100.00';
    case 'percent': return '18';
    case 'integer': return 1;
    case 'boolean': return true;
    case 'uf': return 'SP';
    case 'date': return '2026-09-30';
    case 'string': return 'texto';
    case 'lista': return [];
    default: return {};
  }
}

@Controller('blocks')
export class CatalogController {
  constructor(private readonly engine: EngineService) {}

  /** Catálogo completo de blocos padrão (contrato de entradas/saídas e esquema de parâmetros). */
  @Get() list() {
    return listBlockMeta();
  }

  @Get('code-template') codeTemplate() {
    return { code: CODIGO_TEMPLATE };
  }

  @Get(':key') get(@Param('key') key: string) {
    const meta = listBlockMeta().find((b) => b.key === key);
    if (!meta) throw new NotFoundException(`Bloco "${key}" não existe`);
    return meta;
  }

  /** Entradas de exemplo (da empresa atual) para testar um bloco/override isoladamente. */
  @Get(':key/sample-inputs')
  async sampleInputs(@Param('key') key: string, @TenantId() tenantId: string) {
    const def: BlockDef | undefined = defaultRegistry.get(key);
    if (!def) throw new NotFoundException(`Bloco "${key}" não existe`);
    const tenant = await this.engine.loadTenantInfo(tenantId);
    const contexto = {
      tenant,
      operacao: {
        ufOrigem: tenant.uf, ufDestino: tenant.uf, idDest: 1, interestadual: false, consumidorFinal: false,
        contribuinte: true, indIEDest: 1, dataEmissao: '2026-09-30', ano: 2026, cfop: '5102',
      },
      destinatario: { nome: 'Cliente de exemplo', documento: '11222333000181', uf: tenant.uf },
    };
    const inputs: Record<string, unknown> = {};
    for (const p of def.inputs) if (p.required !== false) inputs[p.id] = sampleFor(p, contexto);
    return { inputs, referenceDate: '2026-09-30' };
  }
}

@Module({ controllers: [CatalogController] })
export class CatalogModule {}
