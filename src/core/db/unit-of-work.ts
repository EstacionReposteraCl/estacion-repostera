// ⚠ NO VERIFICADO. Contrato de implementación de UnitOfWork con prisma.$transaction (interactiva).
// Reglas: nivel de aislamiento por defecto (READ COMMITTED) + bloqueo explícito con SELECT ... FOR UPDATE
// en StockLevel/ProductCost y UPDATE ... RETURNING en DocumentSequence; timeout acotado; sin llamadas externas dentro.
// Implementación pendiente: ver src/repositories/ports.ts (interfaz Tx) y docs/OPERACIONES.md.
export {};
