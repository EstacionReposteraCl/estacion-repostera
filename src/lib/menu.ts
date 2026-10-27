// Menú de módulos: lo usan el Inicio (tarjetas) y la barra superior (menús desplegables). Cada opción se muestra según el permiso del rol.
import type { Permission } from "@/core/permissions";
import type { IconName } from "@/components/icons";

export type Mod = { perm: Permission; title: string; text: string; href: string; icon: IconName };
export const MENU_GROUPS: { title: string; items: Mod[] }[] = [
  { title: "Vender", items: [
    { perm: "sale.create", title: "Caja", text: "Buscar o escanear y cobrar", href: "/ventas/nueva", icon: "cart" },
    { perm: "sale.read.own_today", title: "Ventas", text: "Comprobantes, anulaciones y cargos", href: "/ventas", icon: "list" },
    { perm: "cash.close", title: "Cierre de caja", text: "Abrir, contar y cerrar el turno", href: "/caja/cierre", icon: "lock" },
    { perm: "shipping.labels", title: "Despacho", text: "Etiquetas de pedidos web", href: "/despacho", icon: "truck" },
    { perm: "sale.read.any", title: "Ventas web", text: "Pedidos de la tienda que se registran solos", href: "/ventas-web", icon: "phone" },
  ] },
  { title: "Productos", items: [
    { perm: "product.read.public", title: "Productos", text: "Catálogo, precios y códigos", href: "/productos", icon: "box" },
    { perm: "inventory.adjust", title: "Inventario", text: "Stock y conteo físico", href: "/inventario", icon: "clipboard" },
    { perm: "purchase.create", title: "Compras", text: "Facturas de proveedores", href: "/compras", icon: "bag" },
  ] },
  { title: "Dinero", items: [
    { perm: "expense.write", title: "Gastos", text: "Arriendo, servicios, sueldos…", href: "/gastos", icon: "wallet" },
    { perm: "money.manage", title: "Dinero disponible", text: "Caja, banco, Mercado Pago, TUU, Rappi, Uber", href: "/dinero", icon: "coins" },
    { perm: "report.financial", title: "Reportes", text: "Ventas, costo y ganancia real", href: "/reportes", icon: "chart" },
    { perm: "report.financial", title: "Simulador de precios", text: "Precios y descuentos por canal", href: "/precios", icon: "trend" },
  ] },
  { title: "Configuración", items: [
    { perm: "user.write", title: "Usuarios", text: "Accesos, roles y contraseñas", href: "/usuarios", icon: "users" },
    { perm: "settings.write", title: "Boletas y facturas", text: "Conexión con Haulmer", href: "/boletas", icon: "file" },
    { perm: "settings.write", title: "Configuración", text: "Comprobante, comisiones y medios de pago", href: "/configuracion", icon: "sliders" },
  ] },
];

