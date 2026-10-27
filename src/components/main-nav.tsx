"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type NavGroup = { title: string; items: { href: string; title: string; text: string }[] };

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : href === "/ventas" ? path === "/ventas" || (path.startsWith("/ventas/") && path !== "/ventas/nueva") : path === href || path.startsWith(href + "/"));

/** Menú principal: Inicio + un menú desplegable por sección (Vender, Productos, Dinero, Configuración). */
export function MainNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname(); const [open, setOpen] = useState<string | null>(null); const ref = useRef<HTMLElement>(null);
  // Con mouse: se abre al pasar el cursor y se cierra al salir (con una pequeña pausa para alcanzar a entrar al menú). En pantallas táctiles: con toque.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;
  const enter = (t: string) => { if (!hover()) return; if (timer.current) clearTimeout(timer.current); setOpen(t); };
  const leave = () => { if (!hover()) return; if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(null), 220); };
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <nav className="mainnav" aria-label="Menú principal" ref={ref}>
      <Link href="/" aria-current={path === "/" ? "page" : undefined}>Inicio</Link>
      {groups.map((g) => {
        const here = g.items.some((m) => isActive(path, m.href)); const isOpen = open === g.title;
        return (
          <div key={g.title} className="navdrop" onMouseEnter={() => enter(g.title)} onMouseLeave={leave}>
            <button type="button" className="navbtn" aria-expanded={isOpen} aria-current={here ? "page" : undefined} onClick={() => { if (!hover()) setOpen(isOpen ? null : g.title); }}>
              {g.title} <span aria-hidden="true" className="caret">▾</span>
            </button>
            {isOpen && (
              <div className="navpanel" role="menu">
                {g.items.map((m) => (
                  <Link key={m.href} href={m.href} role="menuitem" className={isActive(path, m.href) ? "on" : undefined} onClick={() => setOpen(null)}>
                    <b>{m.title}</b><span>{m.text}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
