-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMINISTRADOR', 'VENDEDOR');

-- CreateEnum
CREATE TYPE "VatTreatment" AS ENUM ('AFECTO', 'EXENTO');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('GOODS', 'SERVICE');

-- CreateEnum
CREATE TYPE "UnitDimension" AS ENUM ('COUNT', 'MASS', 'VOLUME');

-- CreateEnum
CREATE TYPE "PriceBasis" AS ENUM ('PER_BASE_UNIT', 'PER_PRESENTATION');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING_BALANCE', 'PURCHASE', 'PURCHASE_VOID', 'SALE', 'SALE_VOID', 'CUSTOMER_RETURN', 'ADJUSTMENT', 'WASTE', 'CORRECTION', 'COST_CORRECTION');

-- CreateEnum
CREATE TYPE "WasteReason" AS ENUM ('EXPIRED', 'DAMAGED', 'SPILLAGE', 'THEFT_LOSS', 'OTHER');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "SaleDocumentType" AS ENUM ('INTERNAL_RECEIPT', 'BOLETA_ELECTRONICA', 'FACTURA_ELECTRONICA');

-- CreateEnum
CREATE TYPE "ReceivedDocType" AS ENUM ('FACTURA', 'BOLETA', 'OTRO');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('CONFIRMED', 'VOIDED');

-- CreateEnum
CREATE TYPE "FeeVatTreatment" AS ENUM ('UNDEFINED', 'RECOVERABLE', 'NOT_RECOVERABLE');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('PAYMENT_FEE', 'CHANNEL_COMMISSION', 'CHANNEL_FIXED_FEE', 'SHIPPING_COST', 'OTHER');

-- CreateEnum
CREATE TYPE "ChargeSource" AS ENUM ('RULE', 'MANUAL');

-- CreateEnum
CREATE TYPE "PurchaseVoidMode" AS ENUM ('EXACT', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "SequenceType" AS ENUM ('SALE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'VENDEDOR',
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "impersonatedBy" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "legalName" TEXT NOT NULL,
    "taxId" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "receiptFooter" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Santiago',
    "currency" TEXT NOT NULL DEFAULT 'CLP',
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 19.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "type" "SequenceType" NOT NULL,
    "prefix" TEXT,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "dimension" "UnitDimension" NOT NULL,
    "factorToBase" DECIMAL(12,6) NOT NULL DEFAULT 1,
    "maxDecimals" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "categoryId" TEXT,
    "kind" "ProductKind" NOT NULL DEFAULT 'GOODS',
    "unitId" TEXT NOT NULL,
    "contentAmount" DECIMAL(12,3),
    "contentUnitId" TEXT,
    "vatTreatment" "VatTreatment" NOT NULL DEFAULT 'AFECTO',
    "salePrice" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_presentations" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "baseQuantity" DECIMAL(14,3) NOT NULL,
    "salePrice" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_presentations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_barcodes" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "presentationId" TEXT,
    "presentationProductId" TEXT,
    "code" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "minQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "movementSeq" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_costs" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "inventoryValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "quantityBefore" DECIMAL(14,3) NOT NULL,
    "quantityAfter" DECIMAL(14,3) NOT NULL,
    "valueChange" INTEGER NOT NULL,
    "valueAfter" INTEGER NOT NULL,
    "wasteReason" "WasteReason",
    "note" TEXT,
    "groupId" TEXT,
    "saleItemId" TEXT,
    "purchaseItemId" TEXT,
    "returnItemId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT,
    "docType" "ReceivedDocType" NOT NULL,
    "docNumber" TEXT,
    "docDate" DATE NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'CONFIRMED',
    "pricesIncludeVat" BOOLEAN NOT NULL DEFAULT false,
    "vatRecoverable" BOOLEAN NOT NULL DEFAULT true,
    "netAmount" INTEGER NOT NULL,
    "vatAmount" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "voidMode" "PurchaseVoidMode",
    "voidVariance" INTEGER,
    "documentKey" TEXT,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "presentationId" TEXT,
    "presentationProductId" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "enteredQuantity" DECIMAL(14,3) NOT NULL,
    "enteredUnit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "lineNet" INTEGER NOT NULL,
    "lineVat" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,
    "costBasis" INTEGER NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "supplierId" TEXT,
    "description" TEXT NOT NULL,
    "docType" "ReceivedDocType",
    "docNumber" TEXT,
    "expenseDate" DATE NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'CONFIRMED',
    "vatRecoverable" BOOLEAN NOT NULL DEFAULT false,
    "netAmount" INTEGER NOT NULL,
    "vatAmount" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_channels" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sale_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_rules" (
    "id" TEXT NOT NULL,
    "paymentMethodId" TEXT,
    "channelId" TEXT,
    "percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "fixedAmount" INTEGER NOT NULL DEFAULT 0,
    "isManualPerSale" BOOLEAN NOT NULL DEFAULT false,
    "vatTreatment" "FeeVatTreatment" NOT NULL DEFAULT 'UNDEFINED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "folio" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "documentType" "SaleDocumentType" NOT NULL DEFAULT 'INTERNAL_RECEIPT',
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessDate" DATE NOT NULL,
    "netTotal" INTEGER NOT NULL,
    "vatTotal" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "issuerSnapshot" JSONB,
    "externalRef" TEXT,
    "note" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "presentationId" TEXT,
    "presentationProductId" TEXT,
    "presentationBaseQuantity" DECIMAL(14,3),
    "skuSnapshot" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "baseUnitSnapshot" TEXT NOT NULL,
    "enteredQuantity" DECIMAL(14,3) NOT NULL,
    "enteredUnit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "priceBasis" "PriceBasis" NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "isManualPrice" BOOLEAN NOT NULL DEFAULT false,
    "vatTreatment" "VatTreatment" NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "lineTotal" INTEGER NOT NULL,
    "lineNet" INTEGER NOT NULL,
    "lineVat" INTEGER NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_item_costs" (
    "id" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "lineCost" INTEGER NOT NULL,

    CONSTRAINT "sale_item_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_payments" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_charges" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "paymentId" TEXT,
    "type" "ChargeType" NOT NULL,
    "description" TEXT,
    "baseAmount" INTEGER,
    "percentApplied" DECIMAL(6,3),
    "fixedApplied" INTEGER,
    "amount" INTEGER NOT NULL,
    "source" "ChargeSource" NOT NULL DEFAULT 'RULE',
    "addedAfterClose" BOOLEAN NOT NULL DEFAULT false,
    "vatTreatment" "FeeVatTreatment" NOT NULL DEFAULT 'UNDEFINED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "sale_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_financials" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "netTotal" INTEGER NOT NULL,
    "costOfGoodsSold" INTEGER NOT NULL,
    "grossProfit" INTEGER NOT NULL,
    "totalCharges" INTEGER NOT NULL DEFAULT 0,
    "realProfit" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recalculatedAt" TIMESTAMP(3),
    "recalculatedById" TEXT,

    CONSTRAINT "sale_financials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_returns" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "restock" BOOLEAN NOT NULL DEFAULT true,
    "refundTotal" INTEGER NOT NULL,
    "refundNet" INTEGER NOT NULL,
    "refundVat" INTEGER NOT NULL,
    "costRecovered" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_items" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "refundTotal" INTEGER NOT NULL,
    "refundNet" INTEGER NOT NULL,
    "refundVat" INTEGER NOT NULL,
    "costRecovered" INTEGER NOT NULL,

    CONSTRAINT "sale_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userEmailSnapshot" TEXT,
    "branchId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_key_key" ON "rate_limits"("key");

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_branchId_type_key" ON "document_sequences"("branchId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "units_code_key" ON "units"("code");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "products_isActive_idx" ON "products"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "product_presentations_sku_key" ON "product_presentations"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_presentations_productId_name_key" ON "product_presentations"("productId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_presentations_id_productId_key" ON "product_presentations"("id", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_barcodes_code_key" ON "product_barcodes"("code");

-- CreateIndex
CREATE INDEX "product_barcodes_productId_idx" ON "product_barcodes"("productId");

-- CreateIndex
CREATE INDEX "product_barcodes_presentationId_idx" ON "product_barcodes"("presentationId");

-- CreateIndex
CREATE INDEX "stock_levels_productId_idx" ON "stock_levels"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_branchId_productId_key" ON "stock_levels"("branchId", "productId");

-- CreateIndex
CREATE INDEX "product_costs_productId_idx" ON "product_costs"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_costs_branchId_productId_key" ON "product_costs"("branchId", "productId");

-- CreateIndex
CREATE INDEX "stock_movements_productId_createdAt_idx" ON "stock_movements"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_branchId_createdAt_idx" ON "stock_movements"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_type_createdAt_idx" ON "stock_movements"("type", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_groupId_idx" ON "stock_movements"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_branchId_productId_seq_key" ON "stock_movements"("branchId", "productId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_saleItemId_type_key" ON "stock_movements"("saleItemId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_purchaseItemId_type_key" ON "stock_movements"("purchaseItemId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_returnItemId_type_key" ON "stock_movements"("returnItemId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_taxId_key" ON "suppliers"("taxId");

-- CreateIndex
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_documentKey_key" ON "purchases"("documentKey");

-- CreateIndex
CREATE INDEX "purchases_supplierId_docType_docNumber_idx" ON "purchases"("supplierId", "docType", "docNumber");

-- CreateIndex
CREATE INDEX "purchases_branchId_docDate_idx" ON "purchases"("branchId", "docDate");

-- CreateIndex
CREATE INDEX "purchases_status_idx" ON "purchases"("status");

-- CreateIndex
CREATE INDEX "purchase_items_purchaseId_idx" ON "purchase_items"("purchaseId");

-- CreateIndex
CREATE INDEX "purchase_items_productId_idx" ON "purchase_items"("productId");

-- CreateIndex
CREATE INDEX "purchase_items_presentationId_idx" ON "purchase_items"("presentationId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

-- CreateIndex
CREATE INDEX "expenses_branchId_expenseDate_idx" ON "expenses"("branchId", "expenseDate");

-- CreateIndex
CREATE INDEX "expenses_categoryId_idx" ON "expenses"("categoryId");

-- CreateIndex
CREATE INDEX "expenses_status_idx" ON "expenses"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sale_channels_code_key" ON "sale_channels"("code");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_code_key" ON "payment_methods"("code");

-- CreateIndex
CREATE UNIQUE INDEX "fee_rules_paymentMethodId_key" ON "fee_rules"("paymentMethodId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_rules_channelId_key" ON "fee_rules"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_idempotencyKey_key" ON "sales"("idempotencyKey");

-- CreateIndex
CREATE INDEX "sales_branchId_businessDate_idx" ON "sales"("branchId", "businessDate");

-- CreateIndex
CREATE INDEX "sales_createdById_businessDate_idx" ON "sales"("createdById", "businessDate");

-- CreateIndex
CREATE INDEX "sales_status_idx" ON "sales"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_branchId_folio_key" ON "sales"("branchId", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "sales_channelId_externalRef_key" ON "sales"("channelId", "externalRef");

-- CreateIndex
CREATE INDEX "sale_items_productId_idx" ON "sale_items"("productId");

-- CreateIndex
CREATE INDEX "sale_items_presentationId_idx" ON "sale_items"("presentationId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_saleId_lineNumber_key" ON "sale_items"("saleId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sale_item_costs_saleItemId_key" ON "sale_item_costs"("saleItemId");

-- CreateIndex
CREATE INDEX "sale_payments_saleId_idx" ON "sale_payments"("saleId");

-- CreateIndex
CREATE INDEX "sale_payments_paymentMethodId_idx" ON "sale_payments"("paymentMethodId");

-- CreateIndex
CREATE INDEX "sale_charges_saleId_idx" ON "sale_charges"("saleId");

-- CreateIndex
CREATE INDEX "sale_charges_type_idx" ON "sale_charges"("type");

-- CreateIndex
CREATE UNIQUE INDEX "sale_financials_saleId_key" ON "sale_financials"("saleId");

-- CreateIndex
CREATE INDEX "sale_returns_saleId_idx" ON "sale_returns"("saleId");

-- CreateIndex
CREATE INDEX "sale_return_items_returnId_idx" ON "sale_return_items"("returnId");

-- CreateIndex
CREATE INDEX "sale_return_items_saleItemId_idx" ON "sale_return_items"("saleItemId");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_occurredAt_idx" ON "audit_logs"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_occurredAt_idx" ON "audit_logs"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_occurredAt_idx" ON "audit_logs"("occurredAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_contentUnitId_fkey" FOREIGN KEY ("contentUnitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_presentations" ADD CONSTRAINT "product_presentations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_presentationId_presentationProductId_fkey" FOREIGN KEY ("presentationId", "presentationProductId") REFERENCES "product_presentations"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "purchase_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES "sale_return_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_presentationId_presentationProductId_fkey" FOREIGN KEY ("presentationId", "presentationProductId") REFERENCES "product_presentations"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "sale_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "sale_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_presentationId_presentationProductId_fkey" FOREIGN KEY ("presentationId", "presentationProductId") REFERENCES "product_presentations"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_item_costs" ADD CONSTRAINT "sale_item_costs_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_charges" ADD CONSTRAINT "sale_charges_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_charges" ADD CONSTRAINT "sale_charges_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "sale_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_charges" ADD CONSTRAINT "sale_charges_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_charges" ADD CONSTRAINT "sale_charges_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_financials" ADD CONSTRAINT "sale_financials_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_financials" ADD CONSTRAINT "sale_financials_recalculatedById_fkey" FOREIGN KEY ("recalculatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rol de la aplicación. Debe correr ANTES de 20_reglas.sql (que hace REVOKE/GRANT sobre app_user).
-- Los roles son del CLÚSTER, no de la base: por eso es idempotente (la base sombra de `migrate dev` repite la migración).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN CREATE ROLE app_user NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
-- Después de crear el rol: ALTER ROLE app_user LOGIN PASSWORD '...' (fuera de la migración; la contraseña no se versiona).

-- Extraído tal cual de docs/reglas-y-pruebas.md (sección B) — APROBADO v0.5. NO editar aquí: editar el documento aprobado.
-- ============ 1. Stock y valor del inventario ============
ALTER TABLE stock_levels  ADD CONSTRAINT stock_nonneg CHECK (quantity >= 0);
ALTER TABLE product_costs ADD CONSTRAINT value_nonneg CHECK ("inventoryValue" >= 0);
ALTER TABLE stock_movements ADD CONSTRAINT mov_qty_math
  CHECK ("quantityAfter" = "quantityBefore" + quantity);
ALTER TABLE stock_movements ADD CONSTRAINT mov_nonzero
  CHECK (quantity <> 0 OR type = 'COST_CORRECTION');
ALTER TABLE stock_movements ADD CONSTRAINT mov_cost_correction_qty
  CHECK (type <> 'COST_CORRECTION' OR quantity = 0);
ALTER TABLE stock_movements ADD CONSTRAINT mov_note_required
  CHECK (type NOT IN ('COST_CORRECTION','ADJUSTMENT','WASTE','CORRECTION') OR COALESCE(length(trim(note)), 0) > 0);

-- Invariante entre dos tablas: stock = 0 <=> valor = 0. Trigger de restricción DIFERIDO (al confirmar).
CREATE FUNCTION check_inventory_invariant() RETURNS trigger AS $$
DECLARE q numeric; v int;
BEGIN
  SELECT sl.quantity, pc."inventoryValue" INTO q, v
  FROM stock_levels sl JOIN product_costs pc
    ON pc."branchId" = sl."branchId" AND pc."productId" = sl."productId"
  WHERE sl."branchId" = NEW."branchId" AND sl."productId" = NEW."productId";
  IF FOUND AND ((q = 0 AND v <> 0) OR (q > 0 AND v < 0)) THEN
    RAISE EXCEPTION 'Inventario inconsistente: producto % cantidad % valor %', NEW."productId", q, v;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER inv_invariant_sl AFTER INSERT OR UPDATE ON stock_levels
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_inventory_invariant();
CREATE CONSTRAINT TRIGGER inv_invariant_pc AFTER INSERT OR UPDATE ON product_costs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_inventory_invariant();

-- ============ 2. SERVICE nunca toca inventario ============
CREATE FUNCTION forbid_service_inventory() RETURNS trigger AS $$
BEGIN
  IF (SELECT kind FROM products WHERE id = NEW."productId") <> 'GOODS' THEN
    RAISE EXCEPTION 'Un producto SERVICE no puede tener inventario, movimientos ni presentaciones';
  END IF; RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_sl BEFORE INSERT OR UPDATE ON stock_levels          FOR EACH ROW EXECUTE FUNCTION forbid_service_inventory();
CREATE TRIGGER t_pc BEFORE INSERT OR UPDATE ON product_costs         FOR EACH ROW EXECUTE FUNCTION forbid_service_inventory();
CREATE TRIGGER t_sm BEFORE INSERT           ON stock_movements       FOR EACH ROW EXECUTE FUNCTION forbid_service_inventory();
CREATE TRIGGER t_pp BEFORE INSERT OR UPDATE ON product_presentations FOR EACH ROW EXECUTE FUNCTION forbid_service_inventory();

-- Una línea de venta de un SERVICE no tiene costo de inventario
CREATE FUNCTION forbid_service_item_cost() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sale_items si JOIN products p ON p.id = si."productId"
             WHERE si.id = NEW."saleItemId" AND p.kind <> 'GOODS') THEN
    RAISE EXCEPTION 'Una línea de SERVICE no genera SaleItemCost';
  END IF; RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_sic BEFORE INSERT ON sale_item_costs FOR EACH ROW EXECUTE FUNCTION forbid_service_item_cost();

-- ============ 3. Presentación y producto coherentes; presentaciones enteras ============
ALTER TABLE product_barcodes ADD CONSTRAINT bc_pres_ok CHECK (
  ("presentationId" IS NULL AND "presentationProductId" IS NULL) OR
  ("presentationId" IS NOT NULL AND "presentationProductId" = "productId"));
ALTER TABLE purchase_items ADD CONSTRAINT pi_pres_ok CHECK (
  ("presentationId" IS NULL AND "presentationProductId" IS NULL) OR
  ("presentationId" IS NOT NULL AND "presentationProductId" = "productId"));
ALTER TABLE sale_items ADD CONSTRAINT si_pres_ok CHECK (
  ("presentationId" IS NULL AND "presentationProductId" IS NULL) OR
  ("presentationId" IS NOT NULL AND "presentationProductId" = "productId"));
ALTER TABLE sale_items ADD CONSTRAINT si_packs_integer CHECK (
  "priceBasis" <> 'PER_PRESENTATION' OR (
    "presentationId" IS NOT NULL AND "presentationBaseQuantity" > 0
    AND "enteredQuantity" >= 1 AND "enteredQuantity" = trunc("enteredQuantity")
    AND quantity = "enteredQuantity" * "presentationBaseQuantity"));
ALTER TABLE purchase_items ADD CONSTRAINT pi_packs_integer CHECK (
  "presentationId" IS NULL OR ("enteredQuantity" >= 1 AND "enteredQuantity" = trunc("enteredQuantity")));
ALTER TABLE product_presentations ADD CONSTRAINT pp_qty_pos CHECK ("baseQuantity" > 0);

-- ============ 4. IVA y totales de la venta (suma exacta, sin diferencias de $1) ============
ALTER TABLE sale_items ADD CONSTRAINT si_line_sum CHECK ("lineNet" + "lineVat" = "lineTotal" AND quantity > 0 AND "lineTotal" >= 0);
ALTER TABLE sales      ADD CONSTRAINT sale_sum     CHECK ("netTotal" + "vatTotal" = total AND total >= 0);
ALTER TABLE sales      ADD CONSTRAINT sale_void_reason CHECK (status <> 'VOIDED' OR COALESCE(length(trim("voidReason")), 0) > 0);

-- Σ de las líneas = totales de la venta, verificado al confirmar la transacción
CREATE FUNCTION check_sale_lines_sum() RETURNS trigger AS $$
DECLARE sid text;
BEGIN
  IF TG_TABLE_NAME = 'sales' THEN sid := NEW.id; ELSE sid := NEW."saleId"; END IF;
  IF EXISTS (
    SELECT 1 FROM sales s
    JOIN (SELECT "saleId", SUM("lineTotal") t, SUM("lineNet") n, SUM("lineVat") v FROM sale_items GROUP BY "saleId") x
      ON x."saleId" = s.id
    WHERE s.id = sid AND (x.t <> s.total OR x.n <> s."netTotal" OR x.v <> s."vatTotal")) THEN
    RAISE EXCEPTION 'La suma de las líneas no coincide con el total de la venta %', sid;
  END IF; RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER sale_sum_s  AFTER INSERT OR UPDATE ON sales      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_sale_lines_sum();
CREATE CONSTRAINT TRIGGER sale_sum_si AFTER INSERT OR UPDATE ON sale_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_sale_lines_sum();

-- ============ 5. Resultado financiero congelado ============
ALTER TABLE sale_financials ADD CONSTRAINT sf_gross CHECK ("grossProfit" = "netTotal" - "costOfGoodsSold");
ALTER TABLE sale_financials ADD CONSTRAINT sf_real  CHECK ("realProfit"  = "grossProfit" - "totalCharges");
ALTER TABLE sale_financials ADD CONSTRAINT sf_charges_nonneg CHECK ("totalCharges" >= 0);

-- netTotal copiado = el de la venta
CREATE FUNCTION check_sf_net() RETURNS trigger AS $$
BEGIN
  IF NEW."netTotal" <> (SELECT "netTotal" FROM sales WHERE id = NEW."saleId") THEN
    RAISE EXCEPTION 'SaleFinancial.netTotal no coincide con Sale.netTotal'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER sf_net BEFORE INSERT ON sale_financials FOR EACH ROW EXECUTE FUNCTION check_sf_net();

-- Inmutables: lo vendido y su costo. Solo cambian totalCharges, realProfit y los datos de recálculo.
CREATE FUNCTION sf_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."saleId" <> OLD."saleId" OR NEW."netTotal" <> OLD."netTotal"
     OR NEW."costOfGoodsSold" <> OLD."costOfGoodsSold" OR NEW."grossProfit" <> OLD."grossProfit" THEN
    RAISE EXCEPTION 'El costo vendido y la ganancia bruta de una venta no se modifican';
  END IF; RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER sf_imm BEFORE UPDATE ON sale_financials FOR EACH ROW EXECUTE FUNCTION sf_immutable();
REVOKE UPDATE, DELETE ON sale_item_costs FROM app_user;      -- el costo vendido nunca cambia
REVOKE DELETE ON sale_financials FROM app_user;

-- totalCharges = Σ cargos NO anulados (verificado al confirmar; cubre altas y anulaciones de cargos)
CREATE FUNCTION check_charges_total() RETURNS trigger AS $$
DECLARE sid text := NEW."saleId";
BEGIN
  IF EXISTS (SELECT 1 FROM sale_financials f
             WHERE f."saleId" = sid AND f."totalCharges" <>
               COALESCE((SELECT SUM(amount) FROM sale_charges c WHERE c."saleId" = sid AND c."voidedAt" IS NULL), 0)) THEN
    RAISE EXCEPTION 'totalCharges no coincide con los cargos de la venta %', sid;
  END IF; RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER chg_total_c AFTER INSERT OR UPDATE ON sale_charges    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_charges_total();
CREATE CONSTRAINT TRIGGER chg_total_f AFTER INSERT OR UPDATE ON sale_financials DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_charges_total();

-- ============ 6. Cargos posteriores: solo ADMINISTRADOR, nunca borrados ============
ALTER TABLE sale_charges ADD CONSTRAINT chg_amount_nonneg CHECK (amount >= 0);
CREATE FUNCTION check_late_charge() RETURNS trigger AS $$
BEGIN
  IF NEW."addedAfterClose" THEN
    IF (SELECT role FROM users WHERE id = NEW."createdById") <> 'ADMINISTRADOR' THEN
      RAISE EXCEPTION 'Solo un ADMINISTRADOR puede agregar cargos posteriores'; END IF;
    IF (SELECT status FROM sales WHERE id = NEW."saleId") <> 'COMPLETED' THEN
      RAISE EXCEPTION 'No se pueden agregar cargos a una venta anulada'; END IF;
  END IF; RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER chg_late BEFORE INSERT ON sale_charges FOR EACH ROW EXECUTE FUNCTION check_late_charge();
REVOKE UPDATE, DELETE ON sale_charges FROM app_user;
GRANT  UPDATE ("voidedAt", "voidedById", "voidReason") ON sale_charges TO app_user;  -- solo anular, con motivo

-- ============ 7. Compras: documento duplicado y consistencia ============
-- documentKey (único en Prisma) = '<supplierId o ->|<docType>|<n° normalizado>' mientras la compra esté CONFIRMED
-- y tenga n°; NULL en otro caso (así una compra anulada permite re-registrar el documento corregido).
ALTER TABLE purchases ADD CONSTRAINT pur_key_state CHECK ("documentKey" IS NULL OR (status = 'CONFIRMED' AND "docNumber" IS NOT NULL));
ALTER TABLE purchases ADD CONSTRAINT pur_key_present CHECK (status <> 'CONFIRMED' OR "docNumber" IS NULL OR "documentKey" IS NOT NULL);
ALTER TABLE purchases ADD CONSTRAINT pur_doc_required CHECK ("docType" NOT IN ('FACTURA','BOLETA') OR COALESCE(length(trim("docNumber")), 0) > 0);
ALTER TABLE purchases ADD CONSTRAINT pur_sum CHECK ("netAmount" + "vatAmount" = "totalAmount");
ALTER TABLE purchase_items ADD CONSTRAINT pi_sum CHECK ("lineNet" + "lineVat" = "lineTotal" AND quantity > 0 AND "costBasis" >= 0);

-- ============ 8. Solo agregar / no borrar ============
REVOKE UPDATE, DELETE ON stock_movements, audit_logs FROM app_user;
ALTER TABLE fee_rules ADD CONSTRAINT fee_one_target CHECK (("paymentMethodId" IS NULL) <> ("channelId" IS NULL));
