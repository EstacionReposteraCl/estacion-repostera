import { businessRule } from '../core/errors/index.ts';
import type { Actor } from '../core/permissions/permissions.ts';
type Target = { id: string; role: 'ADMINISTRADOR' | 'VENDEDOR'; banned: boolean };
/** No se puede dejar el sistema sin administradores activos, ni el administrador desactivarse a sí mismo. */
export function assertCanDeactivate(actor: Actor, target: Target, activeAdmins: number): void {
  if (actor.userId === target.id) throw businessRule('No puedes desactivar tu propia cuenta.');
  if (target.role === 'ADMINISTRADOR' && !target.banned && activeAdmins <= 1) throw businessRule('Debe quedar al menos un administrador activo.');
}
export function assertCanChangeRole(actor: Actor, target: Target, newRole: 'ADMINISTRADOR' | 'VENDEDOR', activeAdmins: number): void {
  if (target.role === newRole) throw businessRule('El usuario ya tiene ese rol.');
  if (target.role === 'ADMINISTRADOR' && newRole === 'VENDEDOR' && !target.banned && activeAdmins <= 1) throw businessRule('Debe quedar al menos un administrador activo.');
  if (actor.userId === target.id && newRole === 'VENDEDOR' && activeAdmins <= 1) throw businessRule('No puedes quitarte el rol si eres el único administrador.');
}
