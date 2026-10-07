"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Menú principal: marca la sección activa (aria-current) para el subrayado amarillo. */
export function MainNav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : href === "/ventas" ? path === "/ventas" || (path.startsWith("/ventas/") && path !== "/ventas/nueva") : path === href || path.startsWith(href + "/"));
  return <nav className="mainnav" aria-label="Menú principal">{items.map((n) => <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}>{n.label}</Link>)}</nav>;
}
