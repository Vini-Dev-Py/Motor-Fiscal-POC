-- CreateEnum
CREATE TYPE "Regime" AS ENUM ('SIMPLES', 'PRESUMIDO', 'REAL');

-- CreateEnum
CREATE TYPE "FlowKind" AS ENUM ('PEDIDO', 'SUBFLUXO');

-- CreateEnum
CREATE TYPE "ExecStatus" AS ENUM ('EXECUTANDO', 'OK', 'ERRO', 'REJEITADA');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "ie" TEXT,
    "uf" CHAR(2) NOT NULL,
    "codMunicipio" TEXT NOT NULL,
    "regime" "Regime" NOT NULL,
    "crt" INTEGER NOT NULL,
    "rbt12" DECIMAL(15,2),
    "config" JSONB NOT NULL DEFAULT '{}',
    "nfeProximoNumero" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "blockKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "params" JSONB NOT NULL DEFAULT '{}',
    "validFrom" TEXT NOT NULL,
    "validTo" TEXT,
    "legalBasis" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FlowKind" NOT NULL DEFAULT 'PEDIDO',
    "description" TEXT,
    "draftGraph" JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowVersion" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "flowId" TEXT NOT NULL,
    "requestSchema" JSONB NOT NULL,
    "responseTemplate" JSONB NOT NULL,
    "token" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "webhookId" TEXT,
    "flowId" TEXT,
    "flowVersionId" TEXT,
    "idempotencyKey" TEXT,
    "status" "ExecStatus" NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "trace" JSONB NOT NULL DEFAULT '[]',
    "error" JSONB,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "httpStatus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceRow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "table" TEXT NOT NULL,
    "keys" JSONB NOT NULL DEFAULT '{}',
    "value" JSONB NOT NULL,
    "validFrom" TEXT NOT NULL,
    "validTo" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_cnpj_key" ON "Tenant"("cnpj");

-- CreateIndex
CREATE INDEX "BlockOverride_tenantId_blockKey_idx" ON "BlockOverride"("tenantId", "blockKey");

-- CreateIndex
CREATE INDEX "Flow_tenantId_kind_idx" ON "Flow"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "FlowVersion_flowId_version_key" ON "FlowVersion"("flowId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_slug_key" ON "WebhookEndpoint"("slug");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_tenantId_idx" ON "WebhookEndpoint"("tenantId");

-- CreateIndex
CREATE INDEX "Execution_tenantId_createdAt_idx" ON "Execution"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_webhookId_idempotencyKey_key" ON "Execution"("webhookId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ReferenceRow_table_idx" ON "ReferenceRow"("table");

-- CreateIndex
CREATE INDEX "ReferenceRow_tenantId_idx" ON "ReferenceRow"("tenantId");

-- AddForeignKey
ALTER TABLE "BlockOverride" ADD CONSTRAINT "BlockOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowVersion" ADD CONSTRAINT "FlowVersion_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "WebhookEndpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_flowVersionId_fkey" FOREIGN KEY ("flowVersionId") REFERENCES "FlowVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceRow" ADD CONSTRAINT "ReferenceRow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
