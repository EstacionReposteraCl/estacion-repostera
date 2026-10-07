// Datos base del seed de DESARROLLO (puros: sin Prisma). Los porcentajes de comisión NO se inventan: quedan en 0
// y el administrador los configura (IVA de la comisión: UNDEFINED hasta definirlo con el contador).
export const SEED_BRANCH = { code: 'MAIN', name: 'Sucursal principal', isMain: true } as const;
export const SEED_SETTINGS = { id: 'singleton', legalName: 'OVELIX SPA', taxId: '78.485.985-1', timezone: 'America/Santiago', currency: 'CLP', vatRate: '19.00' } as const;
export const SEED_UNITS = [
  { code: 'UN', name: 'Unidad', symbol: 'un', dimension: 'COUNT', factorToBase: '1', maxDecimals: 0 },
  { code: 'G', name: 'Gramo', symbol: 'g', dimension: 'MASS', factorToBase: '1', maxDecimals: 0 },
  { code: 'KG', name: 'Kilogramo', symbol: 'kg', dimension: 'MASS', factorToBase: '1000', maxDecimals: 3 },
  { code: 'ML', name: 'Mililitro', symbol: 'ml', dimension: 'VOLUME', factorToBase: '1', maxDecimals: 0 },
  { code: 'L', name: 'Litro', symbol: 'l', dimension: 'VOLUME', factorToBase: '1000', maxDecimals: 3 },
] as const;
export const SEED_CHANNELS = [
  { code: 'LOCAL', name: 'Local', sortOrder: 1 }, { code: 'WHATSAPP', name: 'WhatsApp', sortOrder: 2 }, { code: 'INSTAGRAM', name: 'Instagram', sortOrder: 3 },
  { code: 'MERCADO_LIBRE', name: 'Mercado Libre', sortOrder: 4 }, { code: 'RAPPI', name: 'Rappi', sortOrder: 5 },
] as const;
export const SEED_PAYMENT_METHODS = [
  { code: 'CASH', name: 'Efectivo', sortOrder: 1 }, { code: 'DEBIT', name: 'Débito', sortOrder: 2 }, { code: 'CREDIT', name: 'Crédito', sortOrder: 3 },
  { code: 'TRANSFER', name: 'Transferencia', sortOrder: 4 }, { code: 'MERCADO_PAGO', name: 'Mercado Pago', sortOrder: 5 },
] as const;
/** Una regla por destino, en 0 y sin IVA definido. Ver reglas aprobadas v0.5. */
export const SEED_FEE_RULES = {
  paymentMethods: ['DEBIT', 'CREDIT', 'MERCADO_PAGO'], channels: ['MERCADO_LIBRE', 'RAPPI'],
  defaults: { percent: '0', fixedAmount: 0, vatTreatment: 'UNDEFINED', isManualPerSale: true },
} as const;
export const SEED_SEQUENCE = { type: 'SALE', prefix: 'C-', nextNumber: 1 } as const;
export const SEED_EXPENSE_CATEGORIES = ['Arriendo', 'Servicios básicos', 'Remuneraciones', 'Marketing', 'Embalaje', 'Otros'] as const;
/** Solo con SEED_DEMO=1. Cantidades en texto, costo total neto de la compra inicial en pesos. */
export const SEED_DEMO_PRODUCTS = [
  { sku: 'AZU-001', name: 'Azúcar flor', unit: 'KG', kind: 'GOODS', salePrice: 4800, opening: { qty: '10.000', value: 25000 } },
  { sku: 'SPR-001', name: 'Sprinkles', unit: 'KG', kind: 'GOODS', salePrice: 16000, opening: { qty: '2.000', value: 18000 }, presentations: [{ name: 'Bolsa 500 g', baseQuantity: '0.500' }] },
  { sku: 'SRV-ENVIO', name: 'Envío', unit: 'UN', kind: 'SERVICE', salePrice: 2500 },
] as const;
