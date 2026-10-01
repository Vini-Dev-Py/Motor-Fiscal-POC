import {
  ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpStatus, Injectable, PipeTransform,
  UnprocessableEntityException, createParamDecorator, type ExecutionContext,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { z } from 'zod';

/** Valida o body/query com um schema Zod; responde 422 com a lista de problemas. */
@Injectable()
export class ZodPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new UnprocessableEntityException({
        message: 'Dados inválidos',
        issues: r.error.issues.map((i) => ({ path: i.path.join('.') || '(raiz)', message: i.message })),
      });
    }
    return r.data;
  }
}

/** Empresa atual (não há login na POC): header X-Tenant-Id. */
export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  const id = req.headers['x-tenant-id'];
  if (typeof id !== 'string' || !id.trim()) {
    throw new BadRequestException('Informe a empresa no header X-Tenant-Id');
  }
  return id.trim();
});

/** Converte erros conhecidos do Prisma em respostas HTTP amigáveis. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    switch (e.code) {
      case 'P2002': {
        const target = (e.meta?.target as string[] | string | undefined) ?? '';
        res.status(HttpStatus.CONFLICT).json({
          statusCode: 409,
          message: `Já existe um registro com o mesmo valor (${Array.isArray(target) ? target.join(', ') : target})`,
        });
        return;
      }
      case 'P2003':
        res.status(HttpStatus.BAD_REQUEST).json({ statusCode: 400, message: 'Referência inválida (empresa ou registro relacionado não existe)' });
        return;
      case 'P2025':
        res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'Registro não encontrado' });
        return;
      default:
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: 'Erro de banco de dados', code: e.code });
    }
  }
}

export const today = () => new Date().toISOString().slice(0, 10);
