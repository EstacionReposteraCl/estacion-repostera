import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, admin, s1, code } from '../helpers/world.ts';

test('usuarios: listar, crear y restablecer contraseña son solo del ADMINISTRADOR', async () => {
  const { svc } = world();
  assert.equal(await code(svc.users.list(s1)), 'FORBIDDEN');
  assert.equal(await code(svc.users.create(s1, { name: 'X', email: 'x@x.cl', role: 'VENDEDOR', tempPassword: 'abcdefghij' })), 'FORBIDDEN');
  assert.equal(await code(svc.users.resetPassword(s1, 's2', 'abcdefghij')), 'FORBIDDEN');
  assert.ok((await svc.users.list(admin)).length >= 4);
});
test('usuarios: restablecer contraseña revoca sesiones, exige 10+ caracteres, no a usuarios desactivados, y la clave no queda en la auditoría', async () => {
  const { db, svc } = world();
  assert.equal(await code(svc.users.resetPassword(admin, 's1', 'corta')), 'VALIDATION');
  await svc.users.resetPassword(admin, 's1', 'Temporal-1234');
  assert.equal(db.passwords.get('s1'), 'Temporal-1234'); assert.ok(db.sessionsRevoked.includes('s1'));
  const a = db.audit.find((x) => x.action === 'user.reset_password')!; assert.ok(!JSON.stringify(a).includes('Temporal-1234'));
  await svc.users.deactivate(admin, 's2', 'renunció');
  assert.equal(await code(svc.users.resetPassword(admin, 's2', 'Temporal-1234')), 'VALIDATION');
  await svc.users.reactivate(admin, 's2'); assert.equal(db.users.get('s2')!.banned, false);
  assert.equal(await code(svc.users.reactivate(admin, 's2')), 'VALIDATION');
  assert.equal(await code(svc.users.reactivate(admin, 'nadie')), 'NOT_FOUND');
});
test('usuarios: crear normaliza el correo y audita sin contraseña', async () => {
  const { db, svc } = world();
  const r = await svc.users.create(admin, { name: 'Ana', email: '  Ana@Correo.CL ', role: 'VENDEDOR', tempPassword: 'Temporal-1234' });
  assert.equal(db.users.get(r.id)!.email, 'ana@correo.cl');
  assert.ok(!JSON.stringify(db.audit.find((x) => x.action === 'user.create')).includes('Temporal'));
  assert.equal(await code(svc.users.create(admin, { name: 'B', email: 'no-correo', role: 'VENDEDOR', tempPassword: 'Temporal-1234' })), 'VALIDATION');
});
