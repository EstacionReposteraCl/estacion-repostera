# Revisión exhaustiva de schema.prisma v0.5 (congelado — NO modificado)

## Qué se ejecutó (reproducible: `python3 scripts/check-schema.py prisma/schema.prisma docs/reglas-y-pruebas.md`)
Resultado: **0 errores, 0 avisos.** Es un análisis estático propio: **no reemplaza `prisma validate`** (no hay Prisma instalado).

| Comprobación | Resultado |
|---|---|
| Modelos / enums | 33 / 16 |
| Todo tipo referenciado existe (modelo, enum o escalar) | ✔ |
| Cada relación tiene su contraparte (incluye relaciones con nombre: SaleCreatedBy, ChargeVoidedBy…) | ✔ |
| Sin relaciones ambiguas entre el mismo par de modelos | ✔ |
| FK compuestas `(presentationId, presentationProductId) → (id, productId)`: destino con `@@unique([id, productId])`, tipos iguales | ✔ (3 FK compuestas: códigos de barras, compras, ventas) |
| Opcionalidad FK/relación coherente | ✔ |
| `onDelete` explícito en toda FK; `Cascade` solo en Session y Account | ✔ |
| Sin `Float`; todo `Decimal` con precisión | ✔ |
| `@@map` únicos y en minúscula/snake | ✔ |
| Nombres de constraint/índice que Prisma generará: 159, máximo 58 caracteres (límite de PostgreSQL: 63) | ✔ |
| 74 referencias `"columna"` del SQL de reglas existen en las tablas correspondientes | ✔ |
| Tablas y columnas sin comillas usadas por el SQL (`quantity`, `type`, `status`, `role`, `amount`…) existen | ✔ |
| Valores de enum usados como texto en el SQL (`'GOODS'`, `'COST_CORRECTION'`, `'ADMINISTRADOR'`…) existen | ✔ |
| Coherencia Prisma 7: generador `prisma-client` + `output`, datasource sin `url` | ✔ (por lectura; falta `prisma validate`) |

**Conclusión: no se encontró ningún error que impida continuar. El schema no se tocó.**

## Observaciones NO bloqueantes (decisiones para después; ninguna cambia el schema aprobado)
1. **Usuarios sin sucursal.** `User` no tiene `branchId`. En v1 (una sola sucursal) el actor usa la sucursal `isMain`. Para multi-sucursal real habrá que modelar la asignación (cambio estructural futuro, no ahora).
2. **Gastos:** no hay `CHECK (netAmount + vatAmount = totalAmount)` como en compras (`pur_sum`). Propuesta: agregarlo a `20_reglas.sql` en una próxima versión de reglas; mientras tanto, lo valida el servicio.
3. **Pagos:** `Σ SalePayment.amount = Sale.total` lo valida el planificador (`planSale`) pero no hay trigger diferido en la base. Propuesta equivalente a `check_sale_lines_sum`.
4. **Devoluciones** (`SaleReturn*`): el SQL aprobado no tiene reglas ni pruebas para sus sumas ni para el stock. Son exclusivas del administrador y no están en la primera fase; no implementarlas hasta definir sus reglas y pruebas.
5. **Toda venta COMPLETED tiene `SaleFinancial`:** lo garantiza la transacción del servicio, no la base (no hay trigger). Riesgo bajo; cubrirlo con la prueba K ampliada.
6. **`app_user` y el propietario:** `REVOKE ... FROM app_user` solo protege si la aplicación se **conecta como `app_user`**. Si en Neon se usa el rol propietario por defecto, las protecciones de solo-agregar *no aplican*. Decisión de despliegue: dos roles (migraciones = propietario vía `DIRECT_URL`; runtime = `app_user` vía `DATABASE_URL`).
7. **Deriva (drift) de Prisma:** CHECK, triggers y GRANT no están en el schema; `migrate dev` no los detecta como deriva, pero **una migración futura que recree una tabla puede perderlos**. Regla: todo cambio de tabla sensible se revisa contra `20_reglas.sql`.
8. **Base sombra:** `migrate dev` repite las migraciones en una base sombra; `10_roles.sql` es idempotente por eso.
9. **Better Auth:** el modelo del schema es un *núcleo compatible*, no el generado por su CLI. Pendiente comparar; riesgo principal: tipo de `role` (enum `Role`) con el plugin `admin`.
10. **Decimal:** el cliente devuelve `Decimal` (decimal.js): convertir siempre por texto (`decimalToMilli`), nunca `Number`.
11. **Comisiones:** base del porcentaje = monto del pago (medio de pago) o total de la venta (canal), con IVA incluido. Es una suposición del servicio, no del schema; confirmar con el contador junto con `vatTreatment`.
12. **Venta sin líneas:** ningún CHECK la impide en la base; la rechaza el servicio (`planSale`, probado).
