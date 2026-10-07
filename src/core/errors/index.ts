// Errores de aplicación con código estable y mensaje seguro para el usuario.
// Sin parameter properties ni enums (compatibles con type stripping de Node).
export type ErrorCode =
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'INSUFFICIENT_STOCK'
  | 'DUPLICATE_DOCUMENT' | 'CONFLICT' | 'INVARIANT_VIOLATION' | 'BUSINESS_RULE';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message); this.name = 'AppError'; this.code = code; this.details = details;
  }
}
export const unauthenticated = () => new AppError('UNAUTHENTICATED', 'Debes iniciar sesión.');
export const forbidden = (msg = 'No tienes permiso para esta acción.') => new AppError('FORBIDDEN', msg);
/** Para el vendedor, "no existe" y "no es tuyo" deben ser indistinguibles. */
export const notFound = (what = 'Registro') => new AppError('NOT_FOUND', `${what} no encontrado.`);
export const validation = (msg: string, details?: Record<string, unknown>) => new AppError('VALIDATION', msg, details);
export const insufficientStock = (productName: string) => new AppError('INSUFFICIENT_STOCK', `Stock insuficiente de ${productName}.`);
export const businessRule = (msg: string, details?: Record<string, unknown>) => new AppError('BUSINESS_RULE', msg, details);
export const invariant = (msg: string) => new AppError('INVARIANT_VIOLATION', msg);
export const duplicateDocument = (date: string) => new AppError('DUPLICATE_DOCUMENT', `Ese documento ya fue registrado (compra del ${date}).`);

/** Lo único que el cliente recibe de un error. Nunca stack, SQL ni nombres de tablas. */
export function toClientError(e: unknown): { code: ErrorCode | 'INTERNAL'; message: string } {
  if (e instanceof AppError) return { code: e.code, message: e.message };
  return { code: 'INTERNAL', message: 'Ocurrió un error inesperado. Intenta nuevamente.' };
}
export const idempotencyConflict = (existingSaleId: string) => new AppError('CONFLICT', 'La clave de idempotencia ya se usó con una operación distinta. No se creó ni modificó ninguna venta.', { existingSaleId });
