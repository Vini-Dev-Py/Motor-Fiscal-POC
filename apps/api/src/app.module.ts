import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaExceptionFilter } from './common/common';
import { PrismaModule } from './prisma/prisma.service';
import { EngineModule } from './engine/engine.module';
import { TenantsModule } from './tenants/tenants.module';
import { CatalogModule } from './catalog/catalog.module';
import { OverridesModule } from './overrides/overrides.module';
import { FlowsModule } from './flows/flows.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ExecutionsModule } from './executions/executions.module';
import { ReferenceModule } from './reference/reference.module';
import { HealthModule } from './health/health.module';
import { SeedModule } from './seed/seed.service';

@Module({
  imports: [
    // rate limit básico (por IP): 300 req/min. Ajuste por ambiente.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }]),
    PrismaModule,
    EngineModule,
    TenantsModule,
    CatalogModule,
    OverridesModule,
    FlowsModule,
    WebhooksModule,
    ExecutionsModule,
    ReferenceModule,
    HealthModule,
    SeedModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
