# UI (App Router) — intencionalmente vacía
No se construyen pantallas hasta cerrar la validación real. Reglas para cuando se hagan:
- Server Components por defecto; cada page/route/action llama `getActor()` + `assertCan(...)` (no solo middleware).
- Las pantallas del vendedor consumen únicamente DTOs de `src/dto/*` (con `assertNoSensitiveKeys`).
- Diseño responsive: PC, tablet y teléfono; escáner de código de barras = campo de texto que recibe Enter.
