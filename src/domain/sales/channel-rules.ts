import { validation, businessRule } from '../../core/errors/index.ts';
/** El canal y los medios de pago de la venta deben existir y estar activos. */
export function assertChannelAndMethods(channel: { isActive: boolean } | null, methodIds: string[], methods: Map<string, { isActive: boolean }>): void {
  if (!channel) throw validation('Canal de venta inexistente.');
  if (!channel.isActive) throw businessRule('El canal de venta está inactivo.');
  for (const id of methodIds) {
    const m = methods.get(id);
    if (!m) throw validation('Medio de pago inexistente.');
    if (!m.isActive) throw businessRule('El medio de pago está inactivo.');
  }
}
