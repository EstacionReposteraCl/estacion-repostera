// ⚠ NO VERIFICADO (requiere Prisma + Better Auth instalados). Seed de DESARROLLO e idempotente (upsert).
// Los datos puros están en seed-data.ts (verificados por tests/unit/seed-data.test.ts).
// Usuarios: se crean con la API de Better Auth usando SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (nunca contraseñas en el código).
import { prisma } from "../src/core/db/client";
import { planOpeningBalances } from "./seed-plan";
import * as S from "./seed-data";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("El seed de desarrollo no se ejecuta en producción.");
  await prisma.businessSettings.upsert({ where: { id: "singleton" }, update: {}, create: { ...S.SEED_SETTINGS } });
  const branch = await prisma.branch.upsert({ where: { code: S.SEED_BRANCH.code }, update: {}, create: { ...S.SEED_BRANCH } });
  await prisma.documentSequence.upsert({ where: { branchId_type: { branchId: branch.id, type: S.SEED_SEQUENCE.type } }, update: {}, create: { branchId: branch.id, ...S.SEED_SEQUENCE } });
  for (const u of S.SEED_UNITS) await prisma.unit.upsert({ where: { code: u.code }, update: {}, create: { ...u } });
  for (const c of S.SEED_CHANNELS) await prisma.saleChannel.upsert({ where: { code: c.code }, update: {}, create: { ...c } });
  for (const m of S.SEED_PAYMENT_METHODS) await prisma.paymentMethod.upsert({ where: { code: m.code }, update: {}, create: { ...m } });
  for (const name of S.SEED_EXPENSE_CATEGORIES) await prisma.expenseCategory.upsert({ where: { name }, update: {}, create: { name } });
  const d = S.SEED_FEE_RULES.defaults;
  for (const code of S.SEED_FEE_RULES.paymentMethods) {
    const pm = await prisma.paymentMethod.findUniqueOrThrow({ where: { code } });
    await prisma.feeRule.upsert({ where: { paymentMethodId: pm.id }, update: {}, create: { paymentMethodId: pm.id, percent: d.percent, fixedAmount: d.fixedAmount, vatTreatment: d.vatTreatment, isManualPerSale: d.isManualPerSale } });
  }
  for (const code of S.SEED_FEE_RULES.channels) {
    const ch = await prisma.saleChannel.findUniqueOrThrow({ where: { code } });
    await prisma.feeRule.upsert({ where: { channelId: ch.id }, update: {}, create: { channelId: ch.id, percent: d.percent, fixedAmount: d.fixedAmount, vatTreatment: d.vatTreatment, isManualPerSale: d.isManualPerSale } });
  }
  await ensureInitialAdmin();
  if (process.env.SEED_DEMO === "1") await seedDemo(branch.id);
}

/** PENDIENTE de verificar con Better Auth instalado: crea el administrador inicial SOLO si hay SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD (nunca contraseñas en el código). */
async function ensureInitialAdmin() {
  await ensureUser(process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD, "Administrador", "ADMINISTRADOR", "SEED_ADMIN");
  // VENDEDOR de prueba (solo desarrollo, opcional): SEED_SELLER_EMAIL / SEED_SELLER_PASSWORD.
  await ensureUser(process.env.SEED_SELLER_EMAIL, process.env.SEED_SELLER_PASSWORD, "Vendedor de prueba", "VENDEDOR", "SEED_SELLER");
}

/** Crea un usuario SOLO si hay correo y contraseña en variables de entorno (nunca contraseñas en el código).
 *  `signUpEmail` está bloqueado por `disableSignUp`; se usa `createUser` del plugin admin llamado desde el servidor
 *  (sin headers no exige sesión: verificado con better-auth 1.7.7). Better Auth hashea la contraseña. */
async function ensureUser(rawEmail: string | undefined, password: string | undefined, name: string, role: "ADMINISTRADOR" | "VENDEDOR", envPrefix: string) {
  const email = rawEmail?.trim().toLowerCase();
  if (!email || !password) { console.log(`Sin ${envPrefix}_EMAIL/${envPrefix}_PASSWORD: no se crea ${role}.`); return; }
  if (password.length < 10) throw new Error(`${envPrefix}_PASSWORD debe tener al menos 10 caracteres.`);
  if (await prisma.user.findUnique({ where: { email } })) { console.log(`${role} ${email}: ya existe (sin cambios).`); return; }
  const { auth } = await import("../src/core/auth/auth");
  const res = await auth.api.createUser({ body: { name, email, password, role } });
  await prisma.user.update({ where: { id: res.user.id }, data: { role, emailVerified: true, mustChangePassword: true } });
  console.log(`${role} ${email}: creado.`);
}

async function seedDemo(branchId: string) {
  const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRADOR" } });
  if (!admin) throw new Error("Crea primero el administrador (SEED_ADMIN_*) para registrar los saldos iniciales.");
  for (const p of S.SEED_DEMO_PRODUCTS) {
    const unit = await prisma.unit.findUniqueOrThrow({ where: { code: p.unit } });
    const product = await prisma.product.upsert({ where: { sku: p.sku }, update: {}, create: { sku: p.sku, name: p.name, kind: p.kind, unitId: unit.id, salePrice: p.salePrice } });
    if ("presentations" in p) for (const pr of p.presentations) await prisma.productPresentation.upsert({ where: { productId_name: { productId: product.id, name: pr.name } }, update: {}, create: { productId: product.id, name: pr.name, baseQuantity: pr.baseQuantity } });
    if (!("opening" in p)) continue;
    const exists = await prisma.stockMovement.findFirst({ where: { branchId, productId: product.id } });
    if (exists) continue;
    // Saldo inicial por el MISMO planificador que usará la app (una sola regla de inventario).
    const m = planOpeningBalances().find((x) => x.sku === p.sku)!;
    await prisma.$transaction([
      prisma.stockLevel.create({ data: { branchId, productId: product.id, quantity: p.opening.qty.replace(",", "."), movementSeq: m.seq } }),
      prisma.productCost.create({ data: { branchId, productId: product.id, inventoryValue: m.valueAfter } }),
      prisma.stockMovement.create({ data: { branchId, productId: product.id, seq: m.seq, type: "OPENING_BALANCE", quantity: p.opening.qty, quantityBefore: "0", quantityAfter: p.opening.qty, valueChange: m.valueChange, valueAfter: m.valueAfter, createdById: admin.id } }),
    ]);
  }
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
