import { assertCan, type Actor } from '../core/permissions/permissions.ts';
import { notFound, validation } from '../core/errors/index.ts';
import type { UnitOfWork, UserStore, AuthAdmin } from '../repositories/ports.ts';
import { assertCanDeactivate, assertCanChangeRole } from '../policies/user.policy.ts';

export interface Deps { uow: UnitOfWork; users: UserStore; authAdmin: AuthAdmin }
type Role = 'ADMINISTRADOR' | 'VENDEDOR';
export function createUsersService({ uow, users, authAdmin }: Deps) {
  const audit = (a: Actor, action: string, id: string, meta: unknown) => uow.run((tx) => tx.audit.write({ action, entity: 'User', entityId: id, userId: a.userId, metadata: meta }));
  return {
    /** Alta por el administrador (no hay registro público). El usuario deberá cambiar la clave al entrar. */
    async create(actor: Actor | null, i: { name: string; email: string; role: Role; tempPassword: string }): Promise<{ id: string }> {
      assertCan(actor, 'user.write');
      if (!i.name.trim()) throw validation('El nombre es obligatorio.');
      const email = i.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validation('Correo inválido.');
      if (i.tempPassword.length < 10) throw validation('La contraseña temporal debe tener al menos 10 caracteres.');
      const r = await authAdmin.createUser({ ...i, email });
      await audit(actor, 'user.create', r.id, { email, role: i.role }); return r;
    },
    async deactivate(actor: Actor | null, userId: string, reason: string): Promise<void> {
      assertCan(actor, 'user.write'); if (!reason.trim()) throw validation('Desactivar exige un motivo.');
      const t = await users.getById(userId); if (!t) throw notFound('Usuario');
      assertCanDeactivate(actor, t, await users.countActiveAdmins());
      await authAdmin.setBanned(userId, true, reason); await audit(actor, 'user.deactivate', userId, { reason });
    },
    async setRole(actor: Actor | null, userId: string, role: Role): Promise<void> {
      assertCan(actor, 'user.write');
      const t = await users.getById(userId); if (!t) throw notFound('Usuario');
      assertCanChangeRole(actor, t, role, await users.countActiveAdmins());
      await authAdmin.setRole(userId, role); await audit(actor, 'user.set_role', userId, { from: t.role, to: role });
    },
  };
}
export type UsersService = ReturnType<typeof createUsersService>;
