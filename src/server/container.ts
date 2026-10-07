// Raíz de composición del servidor. Fallará con un mensaje claro hasta que existan los repositorios Prisma (PENDIENTE).
import { createServices } from '../services/composition.ts';
import { createPrismaPorts } from '../repositories/prisma/index.ts';
export const services = createServices(createPrismaPorts());
