import { z } from 'zod';
import type { BlockMeta } from '@motor-fiscal/shared';
import {
  ctxEmpresa, ctxOperacao, ctxPedido, lookupAliquotaIcms, lookupTabela, triggerWebhook,
} from './blocks/contexto';
import { taxCofins, taxDifal, taxFcp, taxIcms, taxIcmsSt, taxIpi, taxPis } from './blocks/impostos';
import {
  flowParaCadaItem, flowSubfluxo, logicCodigo, logicCondicao, logicExpressao, subEntrada, subSaida,
} from './blocks/logica';
import {
  nfeChaveAcesso, nfeMontarXml, nfeTotalizar, sefazAutorizar, financeiroBoleto, financeiroParcelas,
} from './blocks/nfe-financeiro';
import {
  reformaCbs, reformaIbs, reformaIs, reformaTransicaoIcms, simplesAliquotaEfetiva, simplesIcms,
} from './blocks/simples-reforma';
import type { BlockDef } from './types';

export const BUILTIN_BLOCKS: BlockDef[] = [
  triggerWebhook, ctxEmpresa, ctxPedido, ctxOperacao, lookupAliquotaIcms, lookupTabela,
  taxIpi, taxIcms, taxIcmsSt, taxDifal, taxFcp, taxPis, taxCofins,
  simplesAliquotaEfetiva, simplesIcms,
  reformaCbs, reformaIbs, reformaIs, reformaTransicaoIcms,
  logicExpressao, logicCondicao, logicCodigo,
  subEntrada, subSaida, flowSubfluxo, flowParaCadaItem,
  nfeTotalizar, nfeChaveAcesso, nfeMontarXml, sefazAutorizar,
  financeiroParcelas, financeiroBoleto,
];

export type BlockRegistry = ReadonlyMap<string, BlockDef>;

export function createRegistry(blocks: BlockDef[] = BUILTIN_BLOCKS): BlockRegistry {
  return new Map(blocks.map((b) => [b.key, b]));
}

export const defaultRegistry: BlockRegistry = createRegistry();

export function blockMeta(def: BlockDef): BlockMeta {
  let paramsSchema: Record<string, unknown> = {};
  try {
    paramsSchema = z.toJSONSchema(def.params, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  } catch {
    paramsSchema = {};
  }
  return {
    key: def.key,
    version: def.version,
    label: def.label,
    category: def.category,
    description: def.description,
    ...(def.formula ? { formula: def.formula } : {}),
    inputs: def.inputs,
    outputs: def.outputs,
    paramsSchema,
    ...(def.branching ? { branching: true } : {}),
    ...(def.dynamicPorts ? { dynamicPorts: def.dynamicPorts } : {}),
    overridable: def.overridable !== false && !def.dynamicPorts,
  };
}

export const listBlockMeta = (reg: BlockRegistry = defaultRegistry): BlockMeta[] => [...reg.values()].map(blockMeta);
