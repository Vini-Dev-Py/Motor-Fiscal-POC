import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // testes usam o código-fonte do shared (evita dist desatualizado)
    alias: { '@motor-fiscal/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
});
