#!/usr/bin/env python3
"""Genera un DDL DERIVADO de schema.prisma (tablas completas, enums, NOT NULL, defaults, únicos, FK).
⚠ NO es la migración de Prisma: imita sus convenciones para poder ensayar las reglas SQL con filas completas.
Las pruebas que pasen aquí NO sustituyen a las de la migración real. Uso: gen-derived-ddl.py schema.prisma > derived-ddl.sql"""
import re, sys
schema = open(sys.argv[1], encoding='utf-8').read()
enums = {m.group(1): [l.split('//')[0].strip() for l in m.group(2).splitlines() if l.split('//')[0].strip()] for m in re.finditer(r'^enum (\w+) \{(.*?)^\}', schema, re.S | re.M)}
models = {}
for m in re.finditer(r'^model (\w+) \{(.*?)^\}', schema, re.S | re.M):
    fields, attrs = [], []
    for raw in m.group(2).splitlines():
        line = raw.split('//')[0].strip()
        if not line: continue
        if line.startswith('@@'): attrs.append(line); continue
        mm = re.match(r'(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$', line)
        fields.append(dict(name=mm.group(1), type=mm.group(2), list=bool(mm.group(3)), opt=bool(mm.group(4)), attr=mm.group(5)))
    table = next((re.search(r'@@map\("(\w+)"\)', a).group(1) for a in attrs if a.startswith('@@map')), m.group(1))
    models[m.group(1)] = dict(fields=fields, attrs=attrs, table=table)
SC = {'String': 'TEXT', 'Int': 'INTEGER', 'Boolean': 'BOOLEAN', 'DateTime': 'TIMESTAMP(3)', 'Json': 'JSONB', 'BigInt': 'BIGINT'}
def coltype(f):
    a = f['attr']
    if f['type'] == 'Decimal': d = re.search(r'@db\.Decimal\((\d+),\s*(\d+)\)', a); return f'DECIMAL({d.group(1)},{d.group(2)})'
    if f['type'] == 'DateTime' and '@db.Date' in a: return 'DATE'
    if f['type'] in enums: return f'"{f["type"]}"'
    return SC[f['type']]
def default(f):
    i = f['attr'].find('@default(')
    if i < 0: return ''
    j, depth = i + 9, 1
    while depth:
        depth += {'(': 1, ')': -1}.get(f['attr'][j], 0); j += 1
    v = f['attr'][i + 9:j - 1].strip()
    if v in ('cuid()', 'uuid()', 'autoincrement()'): return ''
    if v == 'now()': return ' DEFAULT CURRENT_TIMESTAMP'
    if v in ('true', 'false'): return f' DEFAULT {v}'
    if re.fullmatch(r'-?\d+(\.\d+)?', v): return f' DEFAULT {v}'
    if v.startswith('"'): return f" DEFAULT '{v.strip(chr(34))}'"
    if f['type'] in enums: return f" DEFAULT '{v}'"
    raise SystemExit(f'default no soportado: {f["name"]} {v}')
out = ['-- DDL DERIVADO de schema.prisma por scripts/gen-derived-ddl.py. NO es la migración de Prisma.', 'SET client_min_messages = warning;']
for n, vals in enums.items(): out.append(f'CREATE TYPE "{n}" AS ENUM ({", ".join(repr(v) for v in vals)});')
fks, uniq = [], []
for mn, m in models.items():
    cols = []
    for f in m['fields']:
        if f['type'] in models: continue
        cols.append(f'  "{f["name"]}" {coltype(f)}{"" if f["opt"] else " NOT NULL"}{default(f)}')
        if '@unique' in f['attr']: uniq.append((m['table'], [f['name']]))
    pk = [f['name'] for f in m['fields'] if '@id' in f['attr']]
    cols.append(f'  PRIMARY KEY ("{pk[0]}")')
    out.append(f'CREATE TABLE {m["table"]} (\n' + ',\n'.join(cols) + '\n);')
    for a in m['attrs']:
        mm = re.match(r'@@unique\(\[([^\]]+)\]', a)
        if mm: uniq.append((m['table'], [c.strip() for c in mm.group(1).split(',')]))
    for f in m['fields']:
        rm = re.search(r'@relation\((.*)\)', f['attr']) if f['type'] in models else None
        if rm and 'fields:' in rm.group(1):
            a = rm.group(1); fk = [x.strip() for x in re.search(r'fields:\s*\[([^\]]+)\]', a).group(1).split(',')]; rf = [x.strip() for x in re.search(r'references:\s*\[([^\]]+)\]', a).group(1).split(',')]
            od = re.search(r'onDelete:\s*(\w+)', a).group(1).upper()
            fks.append((m['table'], fk, models[f['type']]['table'], rf, od))
for t, c in uniq: out.append(f'CREATE UNIQUE INDEX "{t}_{"_".join(c)}_key" ON {t}({", ".join(chr(34)+x+chr(34) for x in c)});')
for t, fk, tt, rf, od in fks:
    out.append(f'ALTER TABLE {t} ADD CONSTRAINT "{t}_{"_".join(fk)}_fkey" FOREIGN KEY ({", ".join(chr(34)+x+chr(34) for x in fk)}) REFERENCES {tt}({", ".join(chr(34)+x+chr(34) for x in rf)}) ON DELETE {od} ON UPDATE CASCADE;')
print('\n'.join(out))
