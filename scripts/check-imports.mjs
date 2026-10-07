// Lista importaciones que no se resuelven. Relativas: deben existir (con o sin extensión). Paquetes: solo se informan (requieren npm).
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { if (f === 'node_modules' || f === 'generated') continue; const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs)$/.test(p) && files.push(p); } };
for (const d of ['src', 'tests', 'prisma', 'scripts']) if (existsSync(d)) walk(d);
if (existsSync('prisma.config.ts')) files.push('prisma.config.ts');
const exts = ['', '.ts', '.tsx', '/index.ts', '.mjs'];
const missing = [], pkgs = new Map();
for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
  const s = m[1];
  if (s.startsWith('.')) { if (!exts.some((e) => existsSync(resolve(dirname(f), s + e)) && statSync(resolve(dirname(f), s + e)).isFile())) missing.push(`${f} -> ${s}`); }
  else if (!s.startsWith('node:')) { const n = s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]; (pkgs.get(n) ?? pkgs.set(n, new Set()).get(n)).add(f); }
}
console.log(`Archivos revisados: ${files.length}`);
console.log(`Importaciones relativas SIN resolver: ${missing.length}`); missing.forEach((m) => console.log('  ✗', m));
console.log('Paquetes externos requeridos (necesitan npm; no verificados):'); [...pkgs].forEach(([n, fs]) => console.log('  ·', n, '←', [...fs].join(', ')));
process.exit(missing.length ? 1 : 0);
