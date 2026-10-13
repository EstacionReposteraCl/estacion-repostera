// Raíz de composición del servidor: servicios + repositorios Prisma + adaptador de Better Auth.
import "server-only";
import { createServices } from '../services/composition.ts';
import { createPrismaPorts } from '../repositories/prisma/index.ts';
import { authAdmin } from '../core/auth/auth-admin.ts';
import { actorFor } from '../core/auth/get-actor';

export const services = createServices({ ...createPrismaPorts(), authAdmin }, { actorFor });
