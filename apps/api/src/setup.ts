import { RequestMethod, type INestApplication } from '@nestjs/common';

/** Configuração compartilhada entre main.ts e os testes e2e. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'webhook/:slug', method: RequestMethod.ALL }, { path: 'health', method: RequestMethod.GET }],
  });
  app.enableCors({ origin: true, exposedHeaders: ['X-Execution-Id', 'Idempotent-Replay'] });
  app.enableShutdownHooks();
}
