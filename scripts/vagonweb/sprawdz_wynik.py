#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sanity-check pliku wynikowego scrape_vagonweb.py."""
import json
import sys
from collections import Counter

path = sys.argv[1] if len(sys.argv) > 1 else "pociagi_pl.json"
d = json.load(open(path, encoding="utf-8"))

pociagi = d["pociagi"]
print(f"pociągów: {len(pociagi)}")
print(f"pominięte duplikaty: {len(d['pominiete_duplikaty'])}")

przewoznicy = Counter(p["przewoznik"] for p in pociagi)
print("\n== pociągi wg przewoźnika ==")
for k, v in przewoznicy.most_common():
    bez = sum(1 for p in pociagi if p["przewoznik"] == k and p["brak_danych"])
    print(f"  {k}: {v} (bez danych: {bez})")

bez_danych = sum(1 for p in pociagi if p["brak_danych"])
print(f"\nbez składu (brak_danych): {bez_danych} ({100*bez_danych/len(pociagi):.1f}%)")

ikony = Counter()
for p in pociagi:
    ikony.update(p["udogodnienia"])
print("\n== udogodnienia (pociągi) ==")
for k, v in ikony.most_common(25):
    print(f"  {k}: {v}")

modele = Counter()
for p in pociagi:
    if p.get("model_pociagu"):
        modele[p["model_pociagu"]] += 1
print("\n== najczęściej modele pociągów ==")
for k, v in modele.most_common(20):
    print(f"  {k}: {v}")

# kontrola: pociągi zagraniczne
zagraniczne = [p for p in pociagi if p.get("miedzynarodowy")]
print(f"\npociągów zagranicznych (wjeżdżają do PL): {len(zagraniczne)}")
for p in zagraniczne[:10]:
    print(f"  {p['przewoznik']} {p['kategoria']} {p['numer']} {p['nazwa'] or ''}: {(p['trasa'] or '')[:70]}")

# kontrola: znane pociągi
print("\n== kontrola znanych pociągów ==")
for numer in ["113/41006/7", "1300/1", "406/41010/1", "40/17012/3"]:
    for p in pociagi:
        if p["numer"] == numer:
            print(
                f"  {p['numer']} [{p['nazwa']}] model={p['model_pociagu']} "
                f"udogodnienia={len(p['udogodnienia'])} warianty={len(p['sklady'])} brak={p['brak_danych']}"
            )
            break
    else:
        print(f"  {numer}: BRAK!")
