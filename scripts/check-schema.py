#!/usr/bin/env python3
"""Revisión estática de schema.prisma v0.5 contra reglas-y-pruebas.md (SIN Prisma, SIN base de datos).
Verifica: relaciones bidireccionales, FK compuestas, enums, nombres (<=63), @@map únicos,
y que cada tabla/columna/valor de enum usado en el SQL de reglas exista en el schema.
NO reemplaza `prisma validate`. Uso: python3 check-schema.py prisma/schema.prisma docs/reglas-y-pruebas.md"""
import re, sys
schema = open(sys.argv[1], encoding='utf-8').read()
rules = open(sys.argv[2], encoding='utf-8').read()
errs, warns, info = [], [], []

# ---------- parse ----------
enums = {m.group(1): [l.split('//')[0].strip() for l in m.group(2).splitlines() if l.split('//')[0].strip()]
         for m in re.finditer(r'^enum (\w+) \{(.*?)^\}', schema, re.S | re.M)}
models = {}
for m in re.finditer(r'^model (\w+) \{(.*?)^\}', schema, re.S | re.M):
    name, body = m.group(1), m.group(2)
    fields, attrs = {}, []
    for raw in body.splitlines():
        line = raw.split('//')[0].strip()
        if not line: continue
        if line.startswith('@@'): attrs.append(line); continue
        mm = re.match(r'(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$', line)
        if not mm: errs.append(f'{name}: línea no reconocida: {line}'); continue
        fields[mm.group(1)] = dict(type=mm.group(2), list=bool(mm.group(3)), opt=bool(mm.group(4)), attr=mm.group(5))
    mp = next((re.search(r'@@map\("(\w+)"\)', a).group(1) for a in attrs if a.startswith('@@map')), name)
    models[name] = dict(fields=fields, attrs=attrs, table=mp)
scalars = {'String','Int','BigInt','Boolean','DateTime','Decimal','Json','Float','Bytes'}
info.append(f'{len(models)} modelos, {len(enums)} enums')

# ---------- tablas / @@map ----------
tabs = [m['table'] for m in models.values()]
if len(set(tabs)) != len(tabs): errs.append('@@map duplicado')
for m in models.values():
    if not re.fullmatch(r'[a-z_]+', m['table']): warns.append(f"tabla con formato raro: {m['table']}")

# ---------- tipos y relaciones ----------
def uniques(mn):
    m = models[mn]; out = []
    for f, d in m['fields'].items():
        if '@id' in d['attr'] or '@unique' in d['attr']: out.append([f])
    for a in m['attrs']:
        if a.startswith('@@unique') or a.startswith('@@id'):
            cols = re.search(r'\[([^\]]+)\]', a).group(1)
            out.append([c.strip() for c in cols.split(',')])
    return out
rels = []
for mn, m in models.items():
    for f, d in m['fields'].items():
        t = d['type']
        if t in scalars: continue
        if t in enums:
            dv = re.search(r'@default\((\w+)\)', d['attr'])
            if dv and dv.group(1) not in enums[t]: errs.append(f'{mn}.{f}: default {dv.group(1)} no es valor de {t}')
            continue
        if t not in models: errs.append(f'{mn}.{f}: tipo desconocido {t}'); continue
        rm = re.search(r'@relation\((.*)\)', d['attr'])
        rname = None; fk = ref = None
        if rm:
            a = rm.group(1)
            nm = re.match(r'\s*"([^"]+)"', a)
            rname = nm.group(1) if nm else None
            fm = re.search(r'fields:\s*\[([^\]]+)\]', a); rf = re.search(r'references:\s*\[([^\]]+)\]', a)
            if fm and rf:
                fk = [x.strip() for x in fm.group(1).split(',')]; ref = [x.strip() for x in rf.group(1).split(',')]
        rels.append(dict(model=mn, field=f, target=t, name=rname, fk=fk, ref=ref, list=d['list'], opt=d['opt']))
for r in rels:
    if r['fk']:
        for c in r['fk']:
            if c not in models[r['model']]['fields']: errs.append(f"{r['model']}.{r['field']}: FK {c} no existe")
        for c in r['ref']:
            if c not in models[r['target']]['fields']: errs.append(f"{r['model']}.{r['field']}: ref {c} no existe en {r['target']}")
        if sorted(r['ref']) not in [sorted(u) for u in uniques(r['target'])]:
            errs.append(f"{r['model']}.{r['field']} -> {r['target']}({','.join(r['ref'])}): sin @unique/@id que coincida")
        # opcionalidad coherente
        opts = {models[r['model']]['fields'][c]['opt'] for c in r['fk']}
        if len(opts) > 1 and not r['opt']: warns.append(f"{r['model']}.{r['field']}: FK mezcla opcional/obligatorio")
        if r['opt'] and False in opts and len(r['fk'])==1: errs.append(f"{r['model']}.{r['field']}: relación opcional con FK obligatoria")
        if (not r['opt']) and True in opts: errs.append(f"{r['model']}.{r['field']}: relación obligatoria con FK opcional")
        # tipos
        for c, rc in zip(r['fk'], r['ref']):
            a, b = models[r['model']]['fields'][c]['type'], models[r['target']]['fields'][rc]['type']
            if a != b: errs.append(f"{r['model']}.{c} ({a}) != {r['target']}.{rc} ({b})")
        if 'onDelete' not in str(r) and True:
            pass
# lado contrario existe
for r in rels:
    others = [o for o in rels if o['model'] == r['target'] and o['target'] == r['model'] and o['name'] == r['name'] and o is not r]
    if len(others) != 1: errs.append(f"relación {r['model']}.{r['field']} (nombre={r['name']}): contraparte={len(others)}")
# relaciones ambiguas (>1 entre mismo par sin nombre)
from collections import Counter
pairs = Counter((min(r['model'], r['target']), max(r['model'], r['target']), r['name']) for r in rels)
bypair = Counter((min(r['model'], r['target']), max(r['model'], r['target'])) for r in rels)
for (a, b, n), c in pairs.items():
    if n is None and bypair[(a, b)] > 2: errs.append(f'relación ambigua sin nombre entre {a} y {b}')
# onDelete explícito en toda FK
for mn, m in models.items():
    for f, d in m['fields'].items():
        if 'fields:' in d['attr'] and 'onDelete' not in d['attr']: warns.append(f'{mn}.{f}: sin onDelete explícito')
        if 'onDelete: Cascade' in d['attr']: info.append(f'Cascade: {mn}.{f}')
# @default de enums en escalares ok; Decimal/Int dinero
for mn, m in models.items():
    for f, d in m['fields'].items():
        if d['type'] == 'Float': errs.append(f'{mn}.{f}: Float prohibido')
        if d['type'] == 'Decimal' and '@db.Decimal' not in d['attr']: errs.append(f'{mn}.{f}: Decimal sin precisión')

# ---------- nombres generados por Prisma (<=63) ----------
def col(mn, f): return f  # sin @map de columnas
names = []
for mn, m in models.items():
    t = m['table']; names.append(f'{t}_pkey')
    for f, d in m['fields'].items():
        if '@unique' in d['attr']: names.append(f'{t}_{f}_key')
    for a in m['attrs']:
        mm = re.match(r'@@(unique|index)\(\[([^\]]+)\]', a)
        if mm:
            cols = [c.strip() for c in mm.group(2).split(',')]
            names.append(f"{t}_{'_'.join(cols)}_{'key' if mm.group(1)=='unique' else 'idx'}")
    for r in rels:
        if r['model'] == mn and r['fk']: names.append(f"{t}_{'_'.join(r['fk'])}_fkey")
longn = [n for n in names if len(n) > 63]
for n in longn: errs.append(f'identificador > 63 chars ({len(n)}): {n}')
if len(set(names)) != len(names): errs.append('nombres de índice/constraint duplicados: ' + str([n for n,c in Counter(names).items() if c>1]))
info.append(f'{len(names)} nombres de constraint/índice generados; máximo {max(map(len,names))} caracteres ({max(names,key=len)})')

# ---------- cruce con SQL de reglas ----------
sql = re.search(r'```sql\n(.*?)```', rules, re.S).group(1)
tcols = {m['table']: {f for f, d in m['fields'].items() if d['type'] in scalars or d['type'] in enums} for m in models.values()}
tenum = {m['table']: {f: d['type'] for f, d in m['fields'].items() if d['type'] in enums} for m in models.values()}
allenumvals = {v for vs in enums.values() for v in vs}
sqlc = re.sub(r'--[^\n]*', '', sql)
blocks = re.findall(r'CREATE FUNCTION.*?LANGUAGE plpgsql;|(?:ALTER TABLE|CREATE (?:CONSTRAINT )?TRIGGER|REVOKE|GRANT)[^;]*;', sqlc, re.S)
# funciones -> tablas donde se asocian
fn_tables = {}
for m in re.finditer(r'CREATE (?:CONSTRAINT )?TRIGGER \w+ .*? ON (\w+).*?EXECUTE FUNCTION (\w+)\(\)', sqlc, re.S):
    fn_tables.setdefault(m.group(2), set()).add(m.group(1))
checked = 0
for b in blocks:
    tabs_in = set(re.findall(r'(?:ALTER TABLE|FROM|JOIN|ON|UPDATE|INSERT INTO|TABLE)\s+(\w+)', b)) & set(tcols)
    tabs_in |= set(t for t in re.findall(r'\b([a-z_]+)\b', b) if t in tcols)
    fm = re.match(r'CREATE FUNCTION (\w+)', b)
    if fm: tabs_in |= fn_tables.get(fm.group(1), set())
    for t in re.findall(r'(?:ALTER TABLE|REVOKE .*? ON|GRANT .*? ON)\s+([\w, ]+?)(?: ADD| FROM| TO|;)', b):
        for x in [y.strip() for y in t.split(',')]:
            if x and x not in tcols and x != 'app_user' and x.islower(): errs.append(f'SQL: tabla inexistente {x}')
    cols_union = set().union(*[tcols[t] for t in tabs_in]) if tabs_in else set()
    for c in set(re.findall(r'"(\w+)"', b)):
        checked += 1
        if c not in cols_union and c not in tcols: errs.append(f'SQL: columna "{c}" no existe en {sorted(tabs_in)} (bloque: {b[:60].strip()!r})')
    for v in set(re.findall(r"'([A-Z_]{3,})'", b)):
        if v not in allenumvals: errs.append(f"SQL: valor '{v}' no es de ningún enum")
    for t in re.findall(r'(?:FROM|JOIN)\s+(\w+)', b):
        if t not in tcols and t not in ('x','app_user'): errs.append(f'SQL: tabla inexistente {t}')
# columnas sin comillas más usadas
for c, tbls in [('quantity', ['stock_levels', 'stock_movements', 'sale_items', 'purchase_items']), ('amount', ['sale_charges']), ('total', ['sales']),
                ('kind', ['products']), ('role', ['users']), ('status', ['sales', 'purchases']), ('type', ['stock_movements', 'sale_charges']), ('note', ['stock_movements'])]:
    for t in tbls:
        if c not in tcols[t]: errs.append(f'SQL: columna sin comillas {t}.{c} inexistente')
info.append(f'{checked} referencias a columnas con comillas verificadas contra el schema')
# enum vs CHECK de tipo
for v in ['COST_CORRECTION', 'ADJUSTMENT', 'WASTE', 'CORRECTION', 'PER_PRESENTATION', 'ADMINISTRADOR', 'FACTURA', 'BOLETA', 'VOIDED', 'COMPLETED', 'CONFIRMED', 'GOODS']:
    if v not in allenumvals: errs.append(f'valor {v} falta en enums')

# ---------- observaciones de diseño (no errores) ----------
for mn, m in models.items():
    if '@@index' not in ' '.join(m['attrs']) and mn not in ('User',) and any(d['type'] in models for d in m['fields'].values()):
        pass
info.append('Roles SQL requeridos antes de REVOKE/GRANT: app_user (crear en la migración o en el entorno)')
print('INFO'); [print('  ·', i) for i in info if not i.startswith('Cascade')]
print('Cascade (solo debería ser Session/Account):', [i[9:] for i in info if i.startswith('Cascade')])
print('AVISOS:', len(warns)); [print('  !', w) for w in warns]
print('ERRORES:', len(errs)); [print('  ✗', e) for e in errs]
sys.exit(1 if errs else 0)
