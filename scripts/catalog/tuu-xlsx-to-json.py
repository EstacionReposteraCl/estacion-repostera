#!/usr/bin/env python3
"""Convierte el catálogo exportado de TUU (hoja "Productos") a JSON para scripts/catalog/import-catalog.ts.
Limpieza (se informa todo en 'report'): SKU repetido -> sufijo -2, -3…; código de barras repetido -> solo el primer producto;
código "0" o vacío -> se descarta; ¿EXENTO? vacío -> afecto (N). Uso: python3 -I tuu-xlsx-to-json.py catalogo.xlsx salida.json"""
import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True, read_only=True); ws = wb['Productos']
rows = list(ws.iter_rows(min_row=2, values_only=True))
out, report, skus, codes = [], [], {}, {}
def txt(v): return None if v is None else str(v).strip() or None
for n, r in enumerate(rows, start=2):
    if not any(v is not None for v in r): continue
    name, _desc, _peso, price, cost, exento, sku, barcode, brand, category, enabled = (list(r) + [None] * 11)[:11]
    name = txt(name)
    if not name: report.append(f'fila {n}: sin nombre, omitida'); continue
    if not isinstance(price, (int, float)) or price < 0 or int(price) != price: report.append(f'fila {n} "{name}": precio inválido ({price}), omitida'); continue
    sku = txt(sku) or f'IMP{n:04d}'
    if sku.upper() in skus:
        base, k = sku, 2
        while f'{base}-{k}'.upper() in skus: k += 1
        report.append(f'fila {n} "{name}": SKU {sku} repetido (ya usado por "{skus[sku.upper()]}") -> se guarda como {base}-{k}'); sku = f'{base}-{k}'
    skus[sku.upper()] = name
    bc = txt(barcode)
    if isinstance(barcode, float) and barcode == int(barcode): bc = str(int(barcode))
    if bc in (None, '0'):
        if bc == '0': report.append(f'fila {n} "{name}": código de barras "0" descartado')
        bcs = []
    elif bc in codes:
        report.append(f'fila {n} "{name}": código {bc} ya pertenece a "{codes[bc]}", no se asigna'); bcs = []
    else: codes[bc] = name; bcs = [bc]
    ex = (txt(exento) or 'N').upper().startswith('S')
    out.append({ 'row': n, 'name': name[:120], 'sku': sku, 'salePrice': int(price), 'referenceCost': int(cost) if isinstance(cost, (int, float)) and cost > 0 else None,
                 'vatTreatment': 'EXENTO' if ex else 'AFECTO', 'barcodes': bcs, 'brand': txt(brand), 'category': (txt(category) or '').capitalize() or None,
                 'active': (txt(enabled) or 'S').upper().startswith('S') })
json.dump({ 'products': out, 'report': report }, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
print(f'{len(out)} productos, {len(report)} observaciones'); [print(' -', x) for x in report]
