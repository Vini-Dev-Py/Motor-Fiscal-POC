import { Controller, Get, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }

  /** Metadados para a UI (URL pública usada para montar o endereço dos webhooks). */
  @Get('meta')
  meta() {
    return { publicBaseUrl: process.env.PUBLIC_BASE_URL ?? null, version: '0.1.0' };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
