-- DDL DERIVADO de schema.prisma por scripts/gen-derived-ddl.py. NO es la migración de Prisma.
SET client_min_messages = warning;
CREATE TYPE "Role" AS ENUM ('ADMINISTRADOR', 'VENDEDOR');
CREATE TYPE "VatTreatment" AS ENUM ('AFECTO', 'EXENTO');
CREATE TYPE "ProductKind" AS ENUM ('GOODS', 'SERVICE');
CREATE TYPE "UnitDimension" AS ENUM ('COUNT', 'MASS', 'VOLUME');
CREATE TYPE "PriceBasis" AS ENUM ('PER_BASE_UNIT', 'PER_PRESENTATION');
CREATE TYPE "StockMovementType" AS ENUM ('OPENING_BALANCE', 'PURCHASE', 'PURCHASE_VOID', 'SALE', 'SALE_VOID', 'CUSTOMER_RETURN', 'ADJUSTMENT', 'WASTE', 'CORRECTION', 'COST_CORRECTION');
CREATE TYPE "WasteReason" AS ENUM ('EXPIRED', 'DAMAGED', 'SPILLAGE', 'THEFT_LOSS', 'OTHER');
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'VOIDED');
CREATE TYPE "SaleDocumentType" AS ENUM ('INTERNAL_RECEIPT', 'BOLETA_ELECTRONICA', 'FACTURA_ELECTRONICA');
CREATE TYPE "ReceivedDocType" AS ENUM ('FACTURA', 'BOLETA', 'OTRO');
CREATE TYPE "DocStatus" AS ENUM ('CONFIRMED', 'VOIDED');
CREATE TYPE "FeeVatTreatment" AS ENUM ('UNDEFINED', 'RECOVERABLE', 'NOT_RECOVERABLE');
CREATE TYPE "ChargeType" AS ENUM ('PAYMENT_FEE', 'CHANNEL_COMMISSION', 'CHANNEL_FIXED_FEE', 'SHIPPING_COST', 'OTHER');
CREATE TYPE "ChargeSource" AS ENUM ('RULE', 'MANUAL');
CREATE TYPE "PurchaseVoidMode" AS ENUM ('EXACT', 'ADJUSTED');
CREATE TYPE "SequenceType" AS ENUM ('SALE');
CREATE TABLE users (
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
  PRIMARY KEY ("id")
);
CREATE TABLE sessions (
  "id" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "token" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL,
  "impersonatedBy" TEXT,
  PRIMARY KEY ("id")
);
CREATE TABLE accounts (
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
  PRIMARY KEY ("id")
);
CREATE TABLE verifications (
  "id" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE TABLE rate_limits (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL,
  PRIMARY KEY ("id")
);
CREATE TABLE business_settings (
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
  PRIMARY KEY ("id")
);
CREATE TABLE branches (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "isMain" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE TABLE document_sequences (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "type" "SequenceType" NOT NULL,
  "prefix" TEXT,
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE TABLE categories (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE TABLE units (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "dimension" "UnitDimension" NOT NULL,
  "factorToBase" DECIMAL(12,6) NOT NULL DEFAULT 1,
  "maxDecimals" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY ("id")
);
CREATE TABLE products (
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
  PRIMARY KEY ("id")
);
CREATE TABLE product_presentations (
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
  PRIMARY KEY ("id")
);
CREATE TABLE product_barcodes (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "presentationId" TEXT,
  "presentationProductId" TEXT,
  "code" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE stock_levels (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "minQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "movementSeq" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE TABLE product_costs (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "inventoryValue" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE TABLE stock_movements (
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
  PRIMARY KEY ("id")
);
CREATE TABLE suppliers (
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
  PRIMARY KEY ("id")
);
CREATE TABLE purchases (
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
  PRIMARY KEY ("id")
);
CREATE TABLE purchase_items (
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
  PRIMARY KEY ("id")
);
CREATE TABLE expense_categories (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE expenses (
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
  PRIMARY KEY ("id")
);
CREATE TABLE sale_channels (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);
CREATE TABLE payment_methods (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);
CREATE TABLE fee_rules (
  "id" TEXT NOT NULL,
  "paymentMethodId" TEXT,
  "channelId" TEXT,
  "percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
  "fixedAmount" INTEGER NOT NULL DEFAULT 0,
  "isManualPerSale" BOOLEAN NOT NULL DEFAULT false,
  "vatTreatment" "FeeVatTreatment" NOT NULL DEFAULT 'UNDEFINED',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("id")
);
CREATE TABLE sales (
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
  PRIMARY KEY ("id")
);
CREATE TABLE sale_items (
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
  PRIMARY KEY ("id")
);
CREATE TABLE sale_item_costs (
  "id" TEXT NOT NULL,
  "saleItemId" TEXT NOT NULL,
  "lineCost" INTEGER NOT NULL,
  PRIMARY KEY ("id")
);
CREATE TABLE sale_payments (
  "id" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "paymentMethodId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "reference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE sale_charges (
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
  PRIMARY KEY ("id")
);
CREATE TABLE sale_financials (
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
  PRIMARY KEY ("id")
);
CREATE TABLE sale_returns (
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
  PRIMARY KEY ("id")
);
CREATE TABLE sale_return_items (
  "id" TEXT NOT NULL,
  "returnId" TEXT NOT NULL,
  "saleItemId" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "refundTotal" INTEGER NOT NULL,
  "refundNet" INTEGER NOT NULL,
  "refundVat" INTEGER NOT NULL,
  "costRecovered" INTEGER NOT NULL,
  PRIMARY KEY ("id")
);
CREATE TABLE audit_logs (
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
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON users("email");
CREATE UNIQUE INDEX "sessions_token_key" ON sessions("token");
CREATE UNIQUE INDEX "rate_limits_key_key" ON rate_limits("key");
CREATE UNIQUE INDEX "branches_code_key" ON branches("code");
CREATE UNIQUE INDEX "document_sequences_branchId_type_key" ON document_sequences("branchId", "type");
CREATE UNIQUE INDEX "categories_name_key" ON categories("name");
CREATE UNIQUE INDEX "units_code_key" ON units("code");
CREATE UNIQUE INDEX "products_sku_key" ON products("sku");
CREATE UNIQUE INDEX "product_presentations_sku_key" ON product_presentations("sku");
CREATE UNIQUE INDEX "product_presentations_productId_name_key" ON product_presentations("productId", "name");
CREATE UNIQUE INDEX "product_presentations_id_productId_key" ON product_presentations("id", "productId");
CREATE UNIQUE INDEX "product_barcodes_code_key" ON product_barcodes("code");
CREATE UNIQUE INDEX "stock_levels_branchId_productId_key" ON stock_levels("branchId", "productId");
CREATE UNIQUE INDEX "product_costs_branchId_productId_key" ON product_costs("branchId", "productId");
CREATE UNIQUE INDEX "stock_movements_branchId_productId_seq_key" ON stock_movements("branchId", "productId", "seq");
CREATE UNIQUE INDEX "stock_movements_saleItemId_type_key" ON stock_movements("saleItemId", "type");
CREATE UNIQUE INDEX "stock_movements_purchaseItemId_type_key" ON stock_movements("purchaseItemId", "type");
CREATE UNIQUE INDEX "stock_movements_returnItemId_type_key" ON stock_movements("returnItemId", "type");
CREATE UNIQUE INDEX "suppliers_taxId_key" ON suppliers("taxId");
CREATE UNIQUE INDEX "purchases_documentKey_key" ON purchases("documentKey");
CREATE UNIQUE INDEX "expense_categories_name_key" ON expense_categories("name");
CREATE UNIQUE INDEX "sale_channels_code_key" ON sale_channels("code");
CREATE UNIQUE INDEX "payment_methods_code_key" ON payment_methods("code");
CREATE UNIQUE INDEX "fee_rules_paymentMethodId_key" ON fee_rules("paymentMethodId");
CREATE UNIQUE INDEX "fee_rules_channelId_key" ON fee_rules("channelId");
CREATE UNIQUE INDEX "sales_idempotencyKey_key" ON sales("idempotencyKey");
CREATE UNIQUE INDEX "sales_branchId_folio_key" ON sales("branchId", "folio");
CREATE UNIQUE INDEX "sales_channelId_externalRef_key" ON sales("channelId", "externalRef");
CREATE UNIQUE INDEX "sale_items_saleId_lineNumber_key" ON sale_items("saleId", "lineNumber");
CREATE UNIQUE INDEX "sale_item_costs_saleItemId_key" ON sale_item_costs("saleItemId");
CREATE UNIQUE INDEX "sale_financials_saleId_key" ON sale_financials("saleId");
ALTER TABLE sessions ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES users("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE accounts ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES users("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE document_sequences ADD CONSTRAINT "document_sequences_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES branches("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE products ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES categories("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE products ADD CONSTRAINT "products_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES units("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE products ADD CONSTRAINT "products_contentUnitId_fkey" FOREIGN KEY ("contentUnitId") REFERENCES units("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE product_presentations ADD CONSTRAINT "product_presentations_productId_fkey" FOREIGN KEY ("productId") REFERENCES products("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE product_barcodes ADD CONSTRAINT "product_barcodes_productId_fkey" FOREIGN KEY ("productId") REFERENCES products("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE product_barcodes ADD CONSTRAINT "product_barcodes_presentationId_presentationProductId_fkey" FOREIGN KEY ("presentationId", "presentationProductId") REFERENCES product_presentations("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_levels ADD CONSTRAINT "stock_levels_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES branches("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_levels ADD CONSTRAINT "stock_levels_productId_fkey" FOREIGN KEY ("productId") REFERENCES products("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE product_costs ADD CONSTRAINT "product_costs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES branches("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE product_costs ADD CONSTRAINT "product_costs_productId_fkey" FOREIGN KEY ("productId") REFERENCES products("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_movements ADD CONSTRAINT "stock_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES branches("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_movements ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES products("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_movements ADD CONSTRAINT "stock_movements_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES sale_items("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_movements ADD CONSTRAINT "stock_movements_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES purchase_items("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_movements ADD CONSTRAINT "stock_movements_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES sale_return_items("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_movements ADD CONSTRAINT "stock_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES users("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE purchases ADD CONSTRAINT "purchases_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES branches("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE purchases ADD CONSTRAINT "purchases_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES suppliers("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE purchases ADD CONSTRAINT "purchases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES users("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE purchases ADD CONSTRAINT "purchases_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES users("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE purchase_items ADD CONSTRAINT "purchase_items_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES purchases("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE purchase_items ADD CONSTRAINT "purchase_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES products("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE purchase_items ADD CONSTRAINT "purchase_items_presentationId_presentationProductId_fkey" FOREIGN KEY ("presentationId", "presentationProductId") REFERENCES product_presentations("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE expenses ADD CONSTRAINT "expenses_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES branches("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE expenses ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES expense_categories("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE expenses ADD CONSTRAINT "expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES suppliers("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE expenses ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES users("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE expenses ADD CONSTRAINT "expenses_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES users("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE fee_rules ADD CONSTRAINT "fee_rules_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES payment_methods("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE fee_rules ADD CONSTRAINT "fee_rules_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES sale_channels("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sales ADD CONSTRAINT "sales_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES branches("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sales ADD CONSTRAINT "sales_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES sale_channels("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sales ADD CONSTRAINT "sales_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES users("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sales ADD CONSTRAINT "sales_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES users("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_items ADD CONSTRAINT "sale_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES sales("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_items ADD CONSTRAINT "sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES products("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_items ADD CONSTRAINT "sale_items_presentationId_presentationProductId_fkey" FOREIGN KEY ("presentationId", "presentationProductId") REFERENCES product_presentations("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_item_costs ADD CONSTRAINT "sale_item_costs_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES sale_items("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_payments ADD CONSTRAINT "sale_payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES sales("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_payments ADD CONSTRAINT "sale_payments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES payment_methods("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_charges ADD CONSTRAINT "sale_charges_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES sales("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_charges ADD CONSTRAINT "sale_charges_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES sale_payments("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_charges ADD CONSTRAINT "sale_charges_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES users("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_charges ADD CONSTRAINT "sale_charges_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES users("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_financials ADD CONSTRAINT "sale_financials_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES sales("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_financials ADD CONSTRAINT "sale_financials_recalculatedById_fkey" FOREIGN KEY ("recalculatedById") REFERENCES users("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_returns ADD CONSTRAINT "sale_returns_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES sales("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_returns ADD CONSTRAINT "sale_returns_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES branches("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_returns ADD CONSTRAINT "sale_returns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES users("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_return_items ADD CONSTRAINT "sale_return_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES sale_returns("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE sale_return_items ADD CONSTRAINT "sale_return_items_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES sale_items("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE audit_logs ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES users("id") ON DELETE RESTRICT ON UPDATE CASCADE;
