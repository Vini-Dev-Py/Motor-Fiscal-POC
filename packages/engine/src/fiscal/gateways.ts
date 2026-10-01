import { COD_UF, isValidCnpj, isValidCpf, onlyDocChars } from '@motor-fiscal/shared';
import { gerarBoleto } from './boleto';
import type {
  Autorizacao, Boleto, BoletoGateway, BoletoRequest, Numeracao, SefazGateway, SefazRequest,
} from '../types';

/**
 * SEFAZ simulada (homologação de faz de conta): aplica algumas validações reais da NF-e e devolve
 * protocolo. Troque por um adapter que assina o XML (certificado A1) e chama o web service.
 */
export class MockSefazGateway implements SefazGateway {
  private seq = 0;

  async autorizar(req: SefazRequest): Promise<Autorizacao> {
    const base = {
      chave: req.chave,
      dhRecbto: new Date().toISOString(),
      ambiente: 'homologacao' as const,
      mock: true,
    };
    const rejeitar = (cStat: string, xMotivo: string): Autorizacao => ({ ...base, autorizada: false, cStat, xMotivo });

    if (!isValidCnpj(req.tenant.cnpj)) return rejeitar('207', 'Rejeição: CNPJ do emitente inválido');
    const doc = onlyDocChars(req.destinatarioDocumento);
    if (doc.length === 14 && !isValidCnpj(doc)) return rejeitar('208', 'Rejeição: CNPJ do destinatário inválido');
    if (doc.length === 11 && !isValidCpf(doc)) return rejeitar('237', 'Rejeição: CPF do destinatário inválido');
    if (req.somaBcIcmsItens !== req.totalBcIcms) {
      return rejeitar('531', 'Rejeição: total da BC ICMS difere do somatório dos itens');
    }

    this.seq += 1;
    const yy = new Date().getFullYear().toString().slice(2);
    const nProt = `1${COD_UF[req.tenant.uf]}${yy}${String(Date.now()).slice(-6)}${String(this.seq).padStart(5, '0')}`
      .slice(0, 15)
      .padEnd(15, '0');
    return { ...base, autorizada: true, cStat: '100', xMotivo: 'Autorizado o uso da NF-e', nProt };
  }
}

export class MockBoletoGateway implements BoletoGateway {
  async emitir(req: BoletoRequest): Promise<Boleto> {
    return gerarBoleto(req);
  }
}

/** Numeração em memória (testes e dry-run). Em produção a numeração é transacional no banco. */
export class InMemoryNumeracao implements Numeracao {
  private counters = new Map<number, number>();
  constructor(private start = 1) {}
  async next(serie: number): Promise<number> {
    const n = this.counters.get(serie) ?? this.start;
    this.counters.set(serie, n + 1);
    return n;
  }
}

export const mockServices = () => ({
  sefaz: new MockSefazGateway(),
  boleto: new MockBoletoGateway(),
  numeracao: new InMemoryNumeracao(),
});
