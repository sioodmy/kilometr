#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Scraper vagonWEB.cz -> pociągi w Polsce: modele składów + udogodnienia -> JSON.

Źródła (sekcja "Řazení vlaků" na vagonweb.cz):
  razeni.php?zeme=<PRZEWOŹNIK>&rok=<ROK>[&s=<STRONA>]     - listy pociągów (z paginacją)
  vlak.php?zeme=..&cislo=..&nazev=..&rok=..                - karta pociągu (nieużywana)
  ajax_dalsi_razeni_vlak.php                               - planowane składu (POST, 1 zapytanie / pociąg)
      parametry: rok, zeme, cislo, roz='', nazev (!dokładnie jak w listingu),
                 styl='r', aktualni_rok=rok, cislo_vozu='',
                 od=<początek rozkładu>, do_x=<koniec rozkładu>,
                 virtualni_vlak='', cislo_alias='', vsechny_planovane=1
      -> wszystkie warianty planowanych złożen (nagłówki h4 z zakresami dat i odcinkami)

Zakres danych:
  1. WSZYSTKIE pociągi polskich przewoźników (PKPIC, PREG, KM, KW, KD, KŚ, KMŁ, ŁKA,
     SKMT, SKMWA, SKPL, WKD, RJPL, LEPL, KSL, + automatycznie wykrywani inni),
  2. + pociągi zagranicznych przewoźników, które jeżdżą do Polski (ČD, DB, УЗ, ZSSK,
     DLB, RJ, LE, ...), znalezeni przez skanowanie list wszystkich przewoźników,
  3. duplikaty (ten sam fizyczny pociąg pod 2 przewoźnikami, np. PKPIC "113/41006/7"
     i ČD "113") są pomijane i wypisywane osobno w "pominiete_duplikaty".

Ograniczenia serwera: ~15 zapytań/min; skrypt pracuje z domyślnym odstępem 1.1 s,
obsługuje 429/403/Cloudflare ("Just a moment") z rosnącą pauzą, zapisuje stan
(cache/, plik .part) i można go wznowić (--wznow).

Użycie:
  python3 scrape_vagonweb.py                        # pełny skrap, rok bieżący
  python3 scrape_vagonweb.py --limit 20             # test na 20 pociągach
  python3 scrape_vagonweb.py --wznow                # kontynuacja po przerwaniu
  python3 scrape_vagonweb.py --dopravci PKPIC KM    # tylko wybrani przewoźnicy
  python3 scrape_vagonweb.py --rok 2025 --out pl2025.json
  python3 scrape_vagonweb.py --tylko-listing        # same listy (bez składów)
  python3 scrape_vagonweb.py --od-nowa              # ignora cache, od zera

Tryb udogodnień (dla aplikacji Kilometr, wyjście: cloudflare/data/rail-amenities.json):
  python3 scrape_vagonweb.py --udogodnienia                        # pełny skrap
  python3 scrape_vagonweb.py --udogodnienia --limit 25             # próbka
  python3 scrape_vagonweb.py --udogodnienia --wznow                # kontynuacja
  python3 scrape_vagonweb.py --udogodnienia --stan                 # postęp pobierania
  python3 scrape_vagonweb.py --udogodnienia --zloz                 # złóż plik z cache

Pobieranie jest przyrostowe: każdy pociąg ląduje od razu w
cache/udogodnienia_<rok>.jsonl, więc Ctrl+C albo zerwane łącze nie traci pracy.
Kolejne uruchomienie z --wznow pomija to, co już jest w pliku.

Zależności: wyłącznie standardowa biblioteka Pythona 3.8+.
"""

import argparse
import html as html_mod
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime

BASE = "https://www.vagonweb.cz/razeni/"
UA = "vagonWEB-scraper/1.0 (+https://github.com/; kontakt: zmien-mnie@example.com)"

# ---------------------------------------------------------------------------
# Polscy przewoźnicy (kod "zeme" na vagonweb) - skanowani w całości.
# Pozostali są klasyfikowani automatycznie (faza "probe" - patrz niżej).
POLSCY_DOPRAVCY = [
    "PKPIC",  # PKP Intercity
    "PREG",   # POLREGIO
    "RJPL",   # RegioJet Polska
    "LEPL",   # LeoExpress Polska
    "KM",     # Koleje Mazowieckie
    "KMŁ",    # Koleje Małopolskie
    "KD",     # Koleje Dolnośląskie
    "KŚ",     # Koleje Śląskie
    "ŁKA",    # Łódzka Kolej Aglomeracyjna
    "SKMT",   # SKM Trójmiasto
    "SKMWA",  # SKM Warszawa
    "SKPL",   # SKPL Cargo
    "KW",     # Koleje Wielkopolskie
    "WKD",    # Warszawska Kolej Dojazdowa
    "KSL",    # (skład Kolei Śląskich prowadzony w osobnym kodzie)
]

# Przewoźnicy z krajów sąsiadujących - skanujemy WSZYSTKIE strony ich listowań
# (pociągi do Polski mogą być poza stroną 1; pozostali tylko strona 1).
SASIEDZI = [
    # Czechy
    "ČD", "RJ", "LE", "GWTR", "ARV", "AŽD", "KŽC", "GE", "OÚD", "DLB", "CZ-",
    "GE-CD", "RJ-CĎ", "GP-CĎ",
    # Słowacja
    "ZSSK", "RJSK", "LESK", "ZSSKC", "RJ-SK", "GE-SK", "GP-SK",
    # Niemcy
    "DB", "SVDE", "D-", "NEB", "OE",
    # Ukraina / Litwa / Białoruś
    "УЗ", "LTG", "БЧ",
]

# ---------------------------------------------------------------------------
# Wykrywanie tras polskich (w tekście trasy z listingu).
# 1) polskie znaki diakrytyczne (česka/słowacka diakrytika się nie pokrywa)
# 2) większe stacje/miasta polskie bez diakrytyków
PL_DIAKR = re.compile(r"[ąćęłńśźżĄĆĘŁŃŚŹŻ]")
PL_SLOWA = re.compile(
    r"\b(Warszaw(?:a|y|ie)|Katowic(?:e|ach)|Gdyni(?:a|ę|ą)|Sopot(?:u)?|Szczecin(?:a)?|"
    r"Sosnowiec|Gliwic(?:e|ach)|Zabrze|Tychy|Konin(?:a)?|Kutn(?:o|a)|Radom(?:ia|iem|ie)|"
    r"Kielc(?:e|ach)|Malbork(?:a)?|Tczew|Leszn(?:o|a)|Gniezn(?:o|a)|Czeladź|Trzebini(?:a|ę)|"
    r"Bielsk(?:o|u)|Cieszyn(?:a)?|Pszczyn(?:a|y)|Sieradz(?:a)?|Jarocin(?:a)?|Zgierz(?:a)?|"
    r"Skierniewic(?:e|ach)|Brzesk(?:o|a)|Brzeg(?:u)?|Kostrzyn(?:a)?|Wolsztyn(?:a)?|"
    r"Rybnik(?:a)?|Mikolow|Mikołów|Bedzin|Będzin|Jastrzebi|Jastrzębi|Orzesz(?:e|a)|"
    r"Zebrzydowic(?:e|ach)|Pilawa|Deblin|Dęblin|Chełm(?:u)?|Kovel|Dorohusk|Hrebenne|"
    r"Rava-Ruska|Belżec|Bełżec|Krasnystaw|Trawniki|Ostrow|Ostrów|Kepno|Kępno|Wieruszow|"
    r"Wieruszów|Wielun|Wieluń|Zdunska|Zduńska|Lowicz|Łowicz|Swiecie|Świecie|Chojnice|"
    r"Tarnowskie|Lubliniec|Kedzierzyn|Kędzierzyn|Kluczbork|Olesno|Nysa|Gubin|Zary|Żary|"
    r"Zagan|Żagań|Nowa Sol|Nowa Sól|Babimost|Zbaszynek|Zbąszynek|Wschowa|Sulechow|Sulechów|"
    r"Swiebodzin|Świebodzin|Zielona|Rzepin(?:a)?|Frankfurt|Kunowice|Gorzow|Gogolino|"
    r"Choszczno|Stargard|Bialogard|Białogard|Koszalin|Slupsk|Słupsk|Lębork|Łeba|Wejherowo|"
    r"Reda|Puck|Hel|Jurata|Wladyslawowo|Władysławowo|Koscierzyna|Kościerzyna|Bytow|Bytów|"
    r"Lasko|Ląsko|Koscian|Kościan|Srem|Śrem|Sroda|Środa|Pila|Piła|Chodziez|Chodzież|"
    r"Margonin|Wagrowiec|Wągrowiec|Gniezno|Wrzesnia|Września|Slupca|Słupca|Gostyn|Gostyń|"
    r"Rawicz|Krotoszyn|Ostrow|Jarocin|Pleszew|Pleszew|Ostrzeszow|Ostrzeszów|Wieruszow|"
    r"Boleslawiec|Bolesławiec|Wegliniec|Węgliniec|Gryfow|Gryfów|Luban|Lubań|Swieradow|"
    r"Świeradów|Zgorzelec|Bogatynia|Sieniawka|Porajow|Zittau|Kolonia|Kutno|Ozorkow|Ozorków|"
    r"Zychlin|Żychlin|Krosniewice|Krośniewice|Plock|Płock|Gostynin|Gąbin|Sierpc|Biezun|"
    r"Żuromin|Mlawa|Mława|Ciechanow|Ciechanów|Plonsk|Płońsk|Nasielsk|Modlin|Legionowo|"
    r"Wolomin|Wołomin|Minsk|Mazowiecki|Siedlce|Lukow|Łuków|Miedzyrzec|Międzyrzec|Biala|Biała|"
    r"Konstantynow|Konstantynów|Janow|Janów|Sokolka|Sokółka|Grajewo|Ełk|Elk|Olecko|Suwalki|"
    r"Suwałki|Augustow|Augustów|Sejny|Ketrzyn|Kętrzyn|Bartoszyce|Lidzbark|Lidzbark|"
    r"Korsze|Olsztyn|Ostróda|Ostroda|Ilawa|Iława|Dzialdowo|Działdowo|Mlawa|Nidzica|"
    r"Szczytno|Pisz|Gizycko|Giżycko|Wegorzewo|Węgorzewo|Korsze|Skarżysko|Starachowice|"
    r"Ostrowiec|Ostrowiec|Stalowa|Nisko|Rzeszow|Rzeszów|Lancut|Łańcut|Przeworsk|Jaroslaw|"
    r"Jarosław|Przemyśl|Przemysl|Medyka|Zamosc|Zamość|Hrubieszow|Hrubieszów|Tomaszow|"
    r"Tomaszów|Chelm|Chełm|Wlodawa|Włodawa|Biala|Biała|Terespol|Czeremcha|Hajnowka|"
    r"Hajnówka|Nurzec|Cimochy|Bielawa|Orla|Orla|Michalowo|Michałowo|Sokółka|Kuznica|Kuźnica|"
    r"Grajewo|Rajgrod|Rajgród|Prostki|Elk|Ełk|Olecko|Zdedy|Kolno|Lomza|Łomża|Zambrow|Zambrów|"
    r"Ostroleka|Ostrołęka|Rozan|Różan|Ostrow|Ostrów|Pultusk|Pułtusk|Ciechanowiec|"
    r"Sierpc|Biezun|Żuromin|Mlawa|Mława)\b"
)


def trasa_polska(trasa: str) -> bool:
    if not trasa:
        return False
    if PL_DIAKR.search(trasa):
        return True
    return bool(PL_SLOWA.search(trasa))


# ---------------------------------------------------------------------------
# Piktogramy vagonweb (nazwa pliku ikony -> klucz w JSON).
# Wartość: (klucz, czy_ikona_ma_licznik)
IKONY = {
    "tr1": ("klasa_1", False),
    "tr2": ("klasa_2", False),
    "tr12": ("klasa_1_2", False),
    "1sed": ("miejsca_przedzialowe", True),
    "2sed": ("miejsca_otwarte", True),
    "klima": ("klimatyzacja", False),
    "230V": ("gniazdka_230V", False),
    "usb": ("gniazdka_usb", False),
    "mobil": ("ladowarka_bezprzewodowa", False),
    "wifi": ("wifi", False),
    "wifip": ("wifi_platne", False),
    "wifi_pl": ("wifi_platne", False),
    "jidel": ("wagon_restauracyjny", True),
    "bar": ("bar", True),
    "bistro": ("bistro", True),
    "automat": ("automat", False),
    "lehat": ("miejsca_lezace", True),
    "luzk": ("miejsca_sypialne", True),
    "luzk_lux": ("miejsca_sypialne_deluxe", True),
    "wc": ("wc_zamkniety_uklad", False),
    "kolo": ("przewoz_rowerow", True),
    "kolo2": ("przewoz_rowerow_rozszerzony", True),
    "inv": ("dostepny_wozkarze", True),
    "inv3": ("miejsce_dla_wozkarza", True),
    "inv_ramp": ("rampa_dla_wozkarza", False),
    "inv_plos": ("plyta_podnosna_dla_wozkarza", False),
    "nwc": ("brak_wc", False),
    "kamera": ("monitoring", False),
    "kocar": ("miejsce_wózki_dziecięce", True),
    "deti": ("miejsca_dla_dzieci", True),
    "detsky": ("przedzial_dziecięcy", True),
    "lyze": ("przestrzen_na_narty", True),
    "auto": ("przewoz_samochodow", False),
    "tichy": ("strefa_ciszy", False),
    "kolo_vuz": ("przewoz_rowerow", True),
}

# ---------------------------------------------------------------------------
# Tryb --udogodnienia: tylko to, co pokazujemy w aplikacji Kilometr.
# Kolejność = kolejność ikon w karcie połączenia (najważniejsze pierwsze).
# Klucz musi istnieć w słowniku i18n (railAmenities) po stronie aplikacji.
UDOGODNIENIA_UI = [
    "klimatyzacja",           # AcUnit
    "gniazdka_230V",          # Power
    "gniazdka_usb",           # Usb
    "wifi",                   # Wifi
    "wagon_restauracyjny",    # Restaurant
    "bar",                    # LocalBar
    "przewoz_rowerow",        # DirectionsBike
    "dostepny_wozkarze",      # Accessible
    "miejsca_lezace",         # Hotel (couchette)
    "miejsca_sypialne",       # Hotel (sleeper)
    "strefa_ciszy",           # VolumeOff
]
UDOGODNIENIA_UI_SET = set(UDOGODNIENIA_UI)

# Kod przewoźnika vagonweb -> agency_id w feedzie PLK (mkuran.pl).
# Ta sama mapa jest w cloudflare/scripts/build-polska.mjs (VAGONWEB_AGENCY);
# zmiana tu = zmiana tam, inaczej pociągi przestaną się dopasowywać.
VAGONWEB_AGENCY = {
    "PKPIC": "IC",
    "PREG": "PR",
    "RJPL": "RJ",
    "LEPL": "LE",
    "SKMWA": "SKM",
    "KSL": "KŚ",
    "SKPL": "SKPL",
}


def agency_dla(kod):
    """Kod przewoźnika vagonweb -> agency_id feedu PLK."""
    return VAGONWEB_AGENCY.get(kod, kod)

# Wzorce serii pojazdów
EMU_RE = re.compile(r"^(EN|ED|EF|EG|EM|SA|SB|SN|SD|SG|SM\d|\d{2,3}WE|WE|680|640|471|440|460|560|8\d{2}|4010|4110|580)")
WAGON_RE = re.compile(r"^[ABCDW][A-Za-z0-9]{1,15}$")

# ---------------------------------------------------------------------------
# Pomocnicze
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def strip_tags(s):
    s = re.sub(r"<br\s*/?>", " ", s or "", flags=re.I)
    s = TAG_RE.sub(" ", s)
    s = html_mod.unescape(s).replace("\xa0", " ")
    return WS_RE.sub(" ", s).strip()


def iso_z_czeskiej(datastr):
    """'13.6.2026' -> '2026-06-13' (format dat z nagłówków vagonweb)."""
    if not datastr:
        return None
    m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", datastr.strip())
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return None


def druga_niedziela_grudnia(rok):
    """Data drugiej niedzieli grudnia danego roku."""
    d = date(rok, 12, 1)
    # dzień tygodnia: pon=0 .. nd=6
    dodaj = (6 - d.weekday()) % 7
    pierwsza = d.replace(day=1 + dodaj)
    return pierwsza.replace(day=pierwsza.day + 7)


def granice_roku(rok):
    """(od, do) rozkładu jazdy wg vagonweb: 2. niedziela grudnia (rok-1) -> sobota przed 2. niedzielą grudnia roku."""
    rok = int(rok)
    start = druga_niedziela_grudnia(rok - 1)
    druga = druga_niedziela_grudnia(rok)
    from datetime import timedelta
    return start.isoformat(), (druga - timedelta(days=1)).isoformat()


def podpis_trasy(trasa):
    """Sygnatura trasy do deduplikacji (pierwsze ~60 zn. po normalizacji)."""
    t = WS_RE.sub(" ", (trasa or "").strip().lower())
    return t[:60]


# ---------------------------------------------------------------------------
# Klient HTTP z ograniczeniem tempa i obsługą blokad
class Klient:
    def __init__(self, delay=1.1, timeout=40, max_proby=6):
        self.delay = delay
        self.timeout = timeout
        self.max_proby = max_proby
        self._ostatnio = 0.0
        self.zapytan = 0
        self.blokady = 0

    def _czekaj(self):
        delta = time.time() - self._ostatnio
        if delta < self.delay:
            time.sleep(self.delay - delta)
        self._ostatnio = time.time()

    def get(self, url):
        return self._zapytanie(url, None)

    def post(self, url, dane):
        body = urllib.parse.urlencode(dane).encode("utf-8")
        return self._zapytanie(url, body)

    def _zapytanie(self, url, body):
        pauza = 60
        for proba in range(1, self.max_proby + 1):
            self._czekaj()
            req = urllib.request.Request(
                url,
                data=body,
                headers={
                    "User-Agent": UA,
                    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                    "Accept-Language": "cs,pl;q=0.8,en;q=0.5",
                    "Referer": BASE,
                    **({"Content-Type": "application/x-www-form-urlencoded"} if body else {}),
                },
            )
            kod, tekst = None, ""
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    kod = r.status
                    tekst = r.read().decode("utf-8", errors="replace")
            except urllib.error.HTTPError as e:
                kod = e.code
                try:
                    tekst = e.read().decode("utf-8", errors="replace")
                except Exception:
                    tekst = ""
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                print(f"    ! błąd sieci {e}, ponawiam ({proba}/{self.max_proby})", file=sys.stderr)
                time.sleep(5 * proba)
                continue

            self.zapytan += 1
            zablokowano = kod in (403, 429, 503) or "Just a moment" in tekst[:2000] or "challenges.cloudflare" in tekst[:2000]
            if not zablokowano:
                if kod and kod >= 400:
                    # np. 400 - zły URL; nie ma sensu powtarzać
                    print(f"    ! HTTP {kod} dla {url}", file=sys.stderr)
                    return ""
                return tekst

            self.blokady += 1
            print(f"    !! blokada HTTP {kod} (proba {proba}/{self.max_proby}), czekam {pauza}s...", file=sys.stderr)
            time.sleep(pauza)
            pauza = min(pauza * 2, 600)
        return ""


# ---------------------------------------------------------------------------
# Parsowanie listowań (razeni.php)
ROW_RE = re.compile(
    r"<tr onclick=\"window\.location\.href='([^']*)'[^>]*>(.*?)</tr>", re.S
)


def parse_listing(html_text, zeme):
    """Zwraca (lista_pociagow, max_strona)."""
    pociagi = []
    seen = set()
    for href, row in ROW_RE.findall(html_text):
        if "vlak.php?" not in href:
            continue
        href = html_mod.unescape(href)
        q = dict(urllib.parse.parse_qsl(href.split("?", 1)[1], keep_blank_values=True))
        cislo = q.get("cislo")
        if not cislo:
            continue
        klucz = (q.get("zeme", zeme), cislo, q.get("nazev", ""))
        if klucz in seen:
            continue
        seen.add(klucz)

        m_cislo = re.search(r"<td class=cislo>(.*?)</td>", row, re.S)
        kategoria = ""
        if m_cislo:
            etykieta = re.sub(r"<b>.*", "", m_cislo.group(1))
            kategoria = strip_tags(etykieta)
        m_nazev = re.search(r"<td class=nazev>(.*?)</td>", row, re.S)
        nazev_wys = strip_tags(m_nazev.group(1)) if m_nazev else ""
        m_trasa = re.search(r"<td class=maly>(.*?)</td>", row, re.S)
        trasa = strip_tags(m_trasa.group(1)) if m_trasa else ""

        pociagi.append(
            {
                "przewoznik": q.get("zeme", zeme),
                "numer": cislo,
                "nazev": q.get("nazev", "") or nazev_wys or None,
                "kategoria": kategoria or None,
                "trasa": trasa or None,
                "url": BASE + href,
                "klucz": f"{q.get('zeme', zeme)}|{cislo}|{q.get('nazev', '')}",
            }
        )
    strony = [int(p) for p in re.findall(r"[?&]s=(\d+)", html_text)]
    max_strona = max(strony) if strony else 1
    return pociagi, max_strona


# ---------------------------------------------------------------------------
# Parsowanie odpowiedzi AJAX ze składami
def parse_sklady(ajax_html):
    """Parsuje ajax_dalsi_razeni_vlak.php -> lista wariantów składów."""
    h = ajax_html
    sklady = []

    # bloki oznaczone jako aktualne ([nyní]) - z kotwic na górze odpowiedzi
    aktualne = set()
    for m in re.finditer(
        r"<a class='popodskok-z'[^>]*id_vlaku='(\d+)'>(.*?)</a>", h, re.S
    ):
        if "nahled_novy" in m.group(2):
            aktualne.add(m.group(1))

    bloki = re.finditer(
        r"<div id='vlak_(\d+)'[^>]*>.*?<h4[^>]*>(.*?)</h4>(.*?)(?=<div id='vlak_|\Z)",
        h,
        re.S,
    )
    for m in bloki:
        vid, h4, cialo = m.group(1), m.group(2), m.group(3)

        # nagłówek: "Plánované řazení [do X | od X [do Y]] [v úseku: <b>...</b>]"
        tekst_h4 = strip_tags(h4)
        od, do = None, None
        m_do = re.search(r"Plánované řazení\s+do\s+(\d{1,2}\.\d{1,2}\.\d{4})", tekst_h4)
        m_od = re.search(
            r"Plánované řazení\s+od\s+(\d{1,2}\.\d{1,2}\.\d{4})(?:\s+do\s+(\d{1,2}\.\d{1,2}\.\d{4}))?",
            tekst_h4,
        )
        if m_od:
            od = iso_z_czeskiej(m_od.group(1))
            do = iso_z_czeskiej(m_od.group(2)) if m_od.group(2) else None
        elif m_do:
            do = iso_z_czeskiej(m_do.group(1))
        odcinek = None
        m_usek = re.search(r"v úseku:\s*(.*?)\s*(?:$)", strip_tags(h4))
        if m_usek:
            odcinek = m_usek.group(1).strip() or None

        # długość pociągu i metadane bloku
        dlugosc = None
        m_dl = re.search(r"\(-\s*(\d+)\s*m\s*-\)", cialo)
        if m_dl:
            dlugosc = int(m_dl.group(1))
        aktualizacja = None
        m_ak = re.search(r"Poslední aktualizace:\s*([\d.]+)", cialo)
        if m_ak:
            aktualizacja = iso_z_czeskiej(m_ak.group(1))

        pojazdy = []
        for czesc in cialo.split("<td class='bunka_vozu'")[1:]:
            pojazdy.append(parse_pojazd(czesc))

        sklady.append(
            {
                "id": vid,
                "waznosc_od": od,
                "waznosc_do": do,
                "aktualny": vid in aktualne,
                "odcinek": odcinek,
                "dlugosc_pociagu_m": dlugosc,
                "ostatnia_aktualizacja": aktualizacja,
                "pojazdy": pojazdy,
            }
        )
    return sklady


def parse_pojazd(czesc):
    """Parsuje jedną komórkę <td class='bunka_vozu'>...</td> (część po split)."""
    # obrazek -> model
    obrazek, model = None, None
    m_img = re.search(r"src='([^']*popisy/img/[^']*)'", czesc)
    if m_img:
        obrazek = "https://www.vagonweb.cz/" + m_img.group(1).replace("../", "")
        fname = m_img.group(1).split("?")[0].rsplit("/", 1)[-1]
        fname = re.sub(r"\.png$", "", fname, flags=re.I)
        model = fname.split("-")[0]

    # seria (rada) - <span class=tab-radam>X<sup>Y</sup></span>
    seria = None
    m_rada = re.search(r"<span class=tab-radam>(.*?)</span>", czesc, re.S)
    if m_rada:
        seria = strip_tags(m_rada.group(1)).replace(" ", "") or None

    # <small> po radzie: liczba -> indeks serii, litera -> oznaczenie uzupełniające
    litera = None
    m_small = re.search(r"</span>\s*<small>([^<]*)</small>", czesc)
    if m_small and m_small.group(1).strip():
        drobne = m_small.group(1).strip()
        if re.match(r"^[\d.]+$", drobne):
            seria = (seria or "") + drobne
        else:
            litera = drobne

    # numer pojazdu
    numer = None
    m_num = re.search(r"<span class=raz-cislo>([^<]+)</span>", czesc)
    if m_num:
        numer = m_num.group(1).strip()

    # przewoźnik pojazdu - <span title='Kraj - Nazwa'>KOD</span>
    przewoznik, przewoznik_nazwa = None, None
    m_dop = re.search(r"<span title='([^']*?)\s*-\s*([^']*)'>\s*([A-Z0-9ĚŠČŘŽÝÁÍÉŮÚĎŤŇÓĽĹa-zæøå\-]{1,12})\s*</span>", czesc)
    if m_dop:
        przewoznik = m_dop.group(3).strip()
        przewoznik_nazwa = m_dop.group(2).strip() or None

    # piktogramy udogodnień + liczniki
    udogodnienia, liczby, klasa = [], {}, None
    for ikona, _tytul, licznik in re.findall(
        r"ico/([a-zA-Z0-9_-]+)\.svg' title='([^']*)'[^>]*>\s*(\d+)?", czesc
    ):
        klucz, ma_liczbe = IKONY.get(ikona, (f"inne_{ikona}", False))
        if klucz.startswith("klasa_"):
            klasa = {"klasa_1": "1", "klasa_2": "2", "klasa_1_2": "1+2"}[klucz]
            continue
        if klucz not in udogodnienia:
            udogodnienia.append(klucz)
        if licznik:
            if ma_liczbe:
                liczby[klucz] = liczby.get(klucz, 0) + int(licznik)
            # licznik przy ikonie "bez licznika" ignorujemy (to np. numer ikony)

    # sekcja trasy pojazdu - <div><b>...</b></div>
    sekcja = None
    m_sek = re.search(r"<div><b>([^<]+)</b></div>", czesc)
    if m_sek:
        sekcja = m_sek.group(1).strip()

    # notatki (div class=maly bez style) - tekst + ewentualny link "přímý vůz"
    dni, przez_wagon, uwagi_miejsca = None, None, None
    for m_maly in re.finditer(r"<div class=maly>(.*?)</div>", czesc, re.S):
        surowy = m_maly.group(1)
        if "display:flex" in surowy or "fotogalerie" in surowy:
            continue
        # link do innego pociągu = informacja o przez-wagonie
        m_link = re.search(
            r"<a class=odkaz href='[^']*vlak\.php[^']*'[^>]*>(.*?)</a>", surowy, re.S
        )
        if m_link:
            przez_wagon = strip_tags(m_link.group(1)) or przez_wagon
            tekst = strip_tags(re.sub(r"<a class=odkaz[^>]*>.*?</a>", " ", surowy, flags=re.S))
        else:
            tekst = strip_tags(surowy)
        if not tekst:
            continue
        if "jede v" in tekst or "nejede" in tekst:
            dni = tekst
        elif "místa" in tekst.lower():
            uwagi_miejsca = tekst
        elif not m_link:
            uwagi_miejsca = uwagi_miejsca or tekst

    # ocena (recenze) - title='Recenze vozu 8.5/10 ...'
    ocena = None
    m_oc = re.search(r"Recenze vozu\s+(\d+(?:\.\d+)?)/10", czesc)
    if m_oc:
        ocena = float(m_oc.group(1))

    # typ pojazdu
    ma_miejsca = bool(udogodnienia) or klasa is not None
    if not ma_miejsca:
        typ = "lokomotywa"
    elif seria and WAGON_RE.match(seria):
        typ = "wagon"
    elif seria and EMU_RE.match(seria):
        typ = "zespolony"
    elif model and WAGON_RE.match(model):
        typ = "wagon"
    else:
        typ = "zespolony" if ma_miejsca else "wagon"

    return {
        "typ": typ,
        "przewoznik": przewoznik,
        "przewoznik_nazwa": przewoznik_nazwa,
        "seria": seria,
        "model": model,
        "litera": litera,
        "numer": numer,
        "klasa": klasa,
        "udogodnienia": udogodnienia,
        "udogodnienia_liczby": liczby or None,
        "sekcja_trasy": sekcja,
        "dni_kursowania": dni,
        "przez_wagon": przez_wagon,
        "uwagi_miejsca": uwagi_miejsca,
        "ocena": ocena,
        "obrazek": obrazek,
    }


# ---------------------------------------------------------------------------
# Podsumowania
def podsumuj_pociag(sklady):
    """Agregaty na poziomie pociągu (ze wszystkich wariantów)."""
    udogodnienia = []
    lokomotywy = []
    modele = []
    for s in sklady or []:
        for p in s.get("pojazdy", []):
            for u in p.get("udogodnienia", []):
                if u not in udogodnienia:
                    udogodnienia.append(u)
            if p["typ"] == "lokomotywa" and p.get("seria") and p["seria"] not in lokomotywy:
                lokomotywy.append(p["seria"])
            if p["typ"] == "zespolony" and p.get("seria") and p["seria"] not in modele:
                modele.append(p["seria"])
    return {
        "udogodnienia": udogodnienia,
        "lokomotywy": lokomotywy or None,
        "model_pociagu": modele[0] if modele else (lokomotywy[0] if lokomotywy else None),
    }


def podsumuj_sklad(sklad):
    """Agregaty dla jednego wariantu składu."""
    udogodnienia = []
    for p in sklad.get("pojazdy", []):
        for u in p.get("udogodnienia", []):
            if u not in udogodnienia:
                udogodnienia.append(u)
    sklad["udogodnienia"] = udogodnienia
    return sklad


# ---------------------------------------------------------------------------
# Fazy scrapowania
def faz_indeks(klient, rok, cache):
    """Pełna lista przewoźników + nazwy (z rozcestnika /razeni/)."""
    plik = os.path.join(cache, f"indeks_{rok}.json")
    if os.path.exists(plik):
        with open(plik, encoding="utf-8") as f:
            return json.load(f)
    print("[1/5] Pobieram rozcestnik przewoźników...", file=sys.stderr)
    h = klient.get(BASE + "index.php?" + urllib.parse.urlencode({"rok": rok}))
    kody = []
    nazwy = {}
    for m in re.finditer(r"razeni\.php\?zeme=([^&'\"]+)&(?:kategorie=[^&]*&)?rok=" + rok, h):
        kod = html_mod.unescape(m.group(1))
        if kod not in kody:
            kody.append(kod)
    for m in re.finditer(
        r"zeme=([^&'\"]+)&(?:kategorie=[^&]*&)?rok=" + rok + r"[\"']? title='([^']*)'", h
    ):
        kod, nazwa = html_mod.unescape(m.group(1)), html_mod.unescape(m.group(2))
        if kod not in nazwy and "vlak" not in nazwa.lower():
            nazwy[kod] = nazwa
    dane = {"kody": kody, "nazwy": nazwy}
    with open(plik, "w", encoding="utf-8") as f:
        json.dump(dane, f, ensure_ascii=False)
    print(f"      {len(kody)} przewoźników", file=sys.stderr)
    return dane


def faz_probe(klient, rok, cache, indeks, tylko_dopravci):
    """Klasyfikacja przewoźników: 'pl' (polski) / 'zagranica_pl' / 'zagranica'."""
    plik = os.path.join(cache, f"probe_{rok}.json")
    klasy = {}
    if os.path.exists(plik):
        with open(plik, encoding="utf-8") as f:
            klasy = json.load(f)

    do_probe = []
    for kod in indeks["kody"]:
        if tylko_dopravci and kod not in tylko_dopravci:
            continue
        if kod in POLSCY_DOPRAVCY or kod in klasy:
            continue
        do_probe.append(kod)

    if do_probe:
        print(f"[2/5] Klasyfikuję {len(do_probe)} przewoźników (strona 1)...", file=sys.stderr)
    for i, kod in enumerate(do_probe, 1):
        url = BASE + "razeni.php?" + urllib.parse.urlencode({"zeme": kod, "rok": rok})
        h = klient.get(url)
        pociagi, max_strona = parse_listing(h, kod) if h else ([], 1)
        pl = sum(1 for p in pociagi if trasa_polska(p["trasa"]))
        udzial = pl / len(pociagi) if pociagi else 0
        klasy[kod] = {
            "klasa": "pl" if udzial >= 0.5 else ("zagranica_pl" if pl else "zagranica"),
            "stron": max_strona,
            "pociagow_s1": len(pociagi),
            "pl_s1": pl,
        }
        print(
            f"      [{i}/{len(do_probe)}] {kod}: {len(pociagi)} poc., PL {pl} -> {klasy[kod]['klasa']}",
            file=sys.stderr,
        )
        # zapis co 10 przewoźników (odporność na przerwanie)
        if i % 10 == 0:
            with open(plik, "w", encoding="utf-8") as f:
                json.dump(klasy, f, ensure_ascii=False)
    with open(plik, "w", encoding="utf-8") as f:
        json.dump(klasy, f, ensure_ascii=False)
    return klasy


def pobierz_listing(klient, rok, cache, zeme, tylko_pl=False):
    """Pełny listing przewoźnika (wszystkie strony) z cache."""
    plik = os.path.join(cache, f"listing_{zeme}_{rok}.json")
    if os.path.exists(plik):
        with open(plik, encoding="utf-8") as f:
            return json.load(f)
    url0 = BASE + "razeni.php?" + urllib.parse.urlencode({"zeme": zeme, "rok": rok})
    h = klient.get(url0)
    if not h:
        return []
    pociagi, max_strona = parse_listing(h, zeme)
    for strona in range(2, max_strona + 1):
        h = klient.get(url0 + f"&s={strona}")
        if not h:
            break
        nowe, _ = parse_listing(h, zeme)
        klucze = {p["klucz"] for p in pociagi}
        for p in nowe:
            if p["klucz"] not in klucze:
                pociagi.append(p)
                klucze.add(p["klucz"])
    if tylko_pl:
        pociagi = [p for p in pociagi if trasa_polska(p["trasa"])]
    with open(plik, "w", encoding="utf-8") as f:
        json.dump(pociagi, f, ensure_ascii=False)
    return pociagi


def faz_listings(klient, rok, cache, klasy, indeks, tylko_dopravci):
    """Zbiera listy pociągów: polscy (wszyscy) + zagraniczni z trasami PL."""
    print("[3/5] Pobieram listy pociągów...", file=sys.stderr)

    polscy = list(POLSCY_DOPRAVCY)
    if tylko_dopravci:
        polscy = [z for z in polscy if z in tylko_dopravci]
    else:
        # automatycznie wykryci "polscy" przewoźnicy
        for kod, info in klasy.items():
            if info["klasa"] == "pl" and kod not in polscy:
                polscy.append(kod)

    wszystkie = {}   # klucz -> pociąg
    podpisy = {}     # podpis trasy -> klucz (dedup między przewoźnikami)
    pominiete = []

    def dodaj(p):
        wszystkie[p["klucz"]] = p
        podpisy[podpis_trasy(p["trasa"])] = p["klucz"]

    for zeme in polscy:
        pociagi = pobierz_listing(klient, rok, cache, zeme)
        seen_numery = set()
        n = 0
        for p in pociagi:
            p["miedzynarodowy"] = False
            dk = (p["numer"], podpis_trasy(p["trasa"]))
            if dk in seen_numery:
                pominiete.append(
                    {
                        "typ": "wariant_nazwy",
                        "przewoznik": p["przewoznik"],
                        "numer": p["numer"],
                        "nazwa": p["nazev"],
                        "kategoria": p["kategoria"],
                        "trasa": p["trasa"],
                    }
                )
                continue
            seen_numery.add(dk)
            dodaj(p)
            n += 1
        print(f"      {zeme}: {n} pociągów (PL)", file=sys.stderr)

    if tylko_dopravci:
        return [wszystkie[k] for k in sorted(wszystkie)], pominiete

    # zagraniczni: sąsiedzi + wykryci z PL trasami
    zagraniczni = []
    for kod in indeks["kody"]:
        if kod in polscy:
            continue
        info = klasy.get(kod, {})
        jest_pl = info.get("klasa") == "zagranica_pl"
        sasiad = kod in SASIEDZI
        if not (jest_pl or sasiad):
            continue
        pociagi = pobierz_listing(klient, rok, cache, kod, tylko_pl=True)
        for p in pociagi:
            p["miedzynarodowy"] = True
            zagraniczni.append(p)
        if pociagi:
            print(f"      {kod}: {len(pociagi)} pociągów z trasą w PL", file=sys.stderr)

    # deduplikacja zagranicznych względem zebranych (ta sama fizyczna trasa)
    dodani = 0
    for p in zagraniczni:
        if podpis_trasy(p["trasa"]) in podpisy:
            pominiete.append(
                {
                    "typ": "duplikat_zagraniczny",
                    "przewoznik": p["przewoznik"],
                    "numer": p["numer"],
                    "nazwa": p["nazev"],
                    "kategoria": p["kategoria"],
                    "trasa": p["trasa"],
                }
            )
        else:
            dodaj(p)
            dodani += 1
    print(
        f"      dodano {dodani} pociągów zagranicznych, "
        f"pominięto {sum(1 for x in pominiete if x['typ'] == 'duplikat_zagraniczny')} duplikatów",
        file=sys.stderr,
    )

    return [wszystkie[k] for k in sorted(wszystkie)], pominiete


def faz_sklady(klient, rok, cache, pociagi, wznow, limit=None):
    """Pobiera planowane składu dla każdego pociągu (z checkpointem)."""
    plik = os.path.join(cache, f"sklady_{rok}.jsonl")
    gotowe = {}
    if wznow and os.path.exists(plik):
        with open(plik, encoding="utf-8") as f:
            for linia in f:
                try:
                    rekord = json.loads(linia)
                    gotowe[rekord["klucz"]] = rekord["sklady"]
                except json.JSONDecodeError:
                    continue
        print(f"      wznowienie: mam już składу {len(gotowe)} pociągów", file=sys.stderr)

    do_pobrania = [p for p in pociagi if p["klucz"] not in gotowe]
    if limit:
        do_pobrania = do_pobrania[:limit]
    if not do_pobrania:
        return gotowe

    od, do = granice_roku(rok)
    print(
        f"[4/5] Pobieram składy ({len(do_pobrania)} pociągów, rozkład {od} -> {do})...",
        file=sys.stderr,
    )
    t0 = time.time()
    with open(plik, "a", encoding="utf-8") as f:
        for i, p in enumerate(do_pobrania, 1):
            dane = {
                "rok": rok,
                "zeme": p["przewoznik"],
                "cislo": p["numer"],
                "roz": "",
                "nazev": p["nazev"] or "",
                "styl": "r",
                "aktualni_rok": rok,
                "cislo_vozu": "",
                "od": od,
                "do_x": do,
                "virtualni_vlak": "",
                "cislo_alias": "",
                "vsechny_planovane": "1",
            }
            h = klient.post(BASE + "ajax_dalsi_razeni_vlak.php", dane)
            if h and len(h.strip()) > 20 and "Just a moment" not in h[:2000]:
                sklady = parse_sklady(h)
                for s in sklady:
                    podsumuj_sklad(s)
            else:
                sklady = []
            gotowe[p["klucz"]] = sklady
            f.write(json.dumps({"klucz": p["klucz"], "sklady": sklady}, ensure_ascii=False) + "\n")
            if i % 25 == 0:
                f.flush()
                elapsed = time.time() - t0
                eta = elapsed / i * (len(do_pobrania) - i)
                print(
                    f"      {i}/{len(do_pobrania)} ({p['przewoznik']} {p['numer']}), "
                    f"ETA {eta/60:.0f} min, zapytań: {klient.zapytan}",
                    file=sys.stderr,
                )
    return gotowe


# ---------------------------------------------------------------------------
# Tryb --udogodnienia: płaski plik dla aplikacji Kilometr.
def _wybierz_wariant(sklady, dzis):
    """Wariant składu obowiązujący danego dnia (albo oznaczony jako aktualny)."""
    if not sklady:
        return None
    for s in sklady:
        od, do = s.get("waznosc_od"), s.get("waznosc_do")
        if (od is None or od <= dzis) and (do is None or dzis <= do):
            return s
    for s in sklady:
        if s.get("aktualny"):
            return s
    return sklady[0]


def udogodnienia_pociagu(sklady, dzis):
    """(lista kluczy UI, liczby) dla wariantu składu obowiązującego danego dnia.

    Bierzemy tylko pojazdy z miejscami (lokomotywa nie ma gniazdek), a liczby
    (np. miejsca na rowery) sumujemy po całym składzie.
    """
    sklad = _wybierz_wariant(sklady, dzis)
    if not sklad:
        return [], {}
    klucze, liczby = [], {}
    for pojazd in sklad.get("pojazdy", []):
        if pojazd.get("typ") == "lokomotywa":
            continue
        for u in pojazd.get("udogodnienia", []):
            if u not in UDOGODNIENIA_UI_SET:
                continue
            if u not in klucze:
                klucze.append(u)
        for u, n in (pojazd.get("udogodnienia_liczby") or {}).items():
            if u in UDOGODNIENIA_UI_SET:
                liczby[u] = liczby.get(u, 0) + int(n)
    klucze.sort(key=UDOGODNIENIA_UI.index)
    return klucze, liczby


def _wczytaj_jsonl(plik):
    """{klucz: rekord} z pliku jsonl; uszkodzona ostatnia linia nie psuje reszty."""
    gotowe = {}
    if not os.path.exists(plik):
        return gotowe
    with open(plik, encoding="utf-8") as f:
        for linia in f:
            linia = linia.strip()
            if not linia:
                continue
            try:
                rekord = json.loads(linia)
            except json.JSONDecodeError:
                continue
            if "klucz" in rekord:
                gotowe[rekord["klucz"]] = rekord
    return gotowe


def faz_udogodnienia(klient, rok, cache, pociagi, wznow, limit=None):
    """Pobiera składy i zapisuje je przyrostowo do cache/udogodnienia_<rok>.jsonl.

    Rekord: {"klucz", "przewoznik", "numer", "nazwa", "sklady"}. Wznowienie
    czyta plik i pomija to, co już jest, więc przerwanie nic nie traci.
    """
    plik = os.path.join(cache, f"udogodnienia_{rok}.jsonl")
    gotowe = _wczytaj_jsonl(plik) if wznow else {}
    if gotowe:
        print(f"      wznowienie: mam już {len(gotowe)} pociągów", file=sys.stderr)

    do_pobrania = [p for p in pociagi if p["klucz"] not in gotowe]
    if limit:
        do_pobrania = do_pobrania[:limit]
    if not do_pobrania:
        print("      nic do pobrania, wszystko w cache", file=sys.stderr)
        return gotowe

    od, do = granice_roku(rok)
    print(
        f"[4/5] Pobieram składy ({len(do_pobrania)} pociągów, rozkład {od} -> {do})...",
        file=sys.stderr,
    )
    t0 = time.time()
    with open(plik, "a", encoding="utf-8") as f:
        for i, p in enumerate(do_pobrania, 1):
            dane = {
                "rok": rok,
                "zeme": p["przewoznik"],
                "cislo": p["numer"],
                "roz": "",
                "nazev": p["nazev"] or "",
                "styl": "r",
                "aktualni_rok": rok,
                "cislo_vozu": "",
                "od": od,
                "do_x": do,
                "virtualni_vlak": "",
                "cislo_alias": "",
                "vsechny_planovane": "1",
            }
            h = klient.post(BASE + "ajax_dalsi_razeni_vlak.php", dane)
            if h and len(h.strip()) > 20 and "Just a moment" not in h[:2000]:
                sklady = parse_sklady(h)
            else:
                sklady = []
            rekord = {
                "klucz": p["klucz"],
                "przewoznik": p["przewoznik"],
                "numer": p["numer"],
                "nazwa": p["nazev"],
                "sklady": sklady,
            }
            gotowe[p["klucz"]] = rekord
            f.write(json.dumps(rekord, ensure_ascii=False) + "\n")
            f.flush()
            if i % 25 == 0:
                elapsed = time.time() - t0
                eta = elapsed / i * (len(do_pobrania) - i)
                print(
                    f"      {i}/{len(do_pobrania)} ({p['przewoznik']} {p['numer']}), "
                    f"ETA {eta/60:.0f} min, zapytań: {klient.zapytan}",
                    file=sys.stderr,
                )
    return gotowe


def stan_pobierania(rok, cache, pociagi):
    """Ile pociągów jest już w cache/udogodnienia_<rok>.jsonl."""
    plik = os.path.join(cache, f"udogodnienia_{rok}.jsonl")
    gotowe = _wczytaj_jsonl(plik)
    klucze = {p["klucz"] for p in pociagi}
    zrobione = len(klucze & set(gotowe))
    zostalo = len(klucze) - zrobione
    pct = 100 * zrobione / len(klucze) if klucze else 0
    print(f"plik:     {plik}", file=sys.stderr)
    print(f"pociągów: {len(klucze)}", file=sys.stderr)
    print(f"pobrane:  {zrobione} ({pct:.1f}%)", file=sys.stderr)
    print(f"zostało:  {zostalo}", file=sys.stderr)
    if gotowe:
        ostatni = list(gotowe.values())[-1]
        print(
            f"ostatni:  {ostatni.get('przewoznik')} {ostatni.get('numer')}",
            file=sys.stderr,
        )
    if zostalo:
        print(f"wznów:    python3 {os.path.basename(__file__)} --udogodnienia --wznow", file=sys.stderr)
    return zrobione, zostalo


def zloz_udogodnienia(rok, cache, pociagi, out):
    """Składa cloudflare/data/rail-amenities.json z cache (bez sieci)."""
    plik = os.path.join(cache, f"udogodnienia_{rok}.jsonl")
    gotowe = _wczytaj_jsonl(plik)
    dzis = date.today().isoformat()
    wpisy, bez = [], 0
    for p in pociagi:
        rekord = gotowe.get(p["klucz"])
        if not rekord:
            bez += 1
            continue
        klucze, liczby = udogodnienia_pociagu(rekord.get("sklady") or [], dzis)
        if not klucze:
            continue
        wpis = {
            "agency": agency_dla(p["przewoznik"]),
            "numer": p["numer"],
            "nazwa": p["nazev"],
            "udogodnienia": klucze,
        }
        if liczby:
            wpis["liczby"] = liczby
        wpisy.append(wpis)
    payload = {
        "schemaVersion": 1,
        "rok": rok,
        "wygenerowano": datetime.now().isoformat(timespec="seconds"),
        "zrodlo": "https://www.vagonweb.cz/razeni/",
        "liczba_pociagow": len(wpisy),
        "pociagi": wpisy,
    }
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(
        f"zapisano {len(wpisy)} pociągów z udogodnieniami -> {out} "
        f"(bez danych: {bez}, bez udogodnień UI: {len(pociagi) - bez - len(wpisy)})",
        file=sys.stderr,
    )
    return payload


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(
        description="vagonWEB.cz -> pociągi w Polsce (składy + udogodnienia) -> JSON"
    )
    ap.add_argument("--rok", default=str(date.today().year), help="rok rozkładu (domyślnie bieżący)")
    ap.add_argument("--out", default="pociagi_pl.json", help="plik wynikowy JSON")
    ap.add_argument("--dopravci", nargs="+", default=None,
                    help="tylko wybrani przewoźnicy (kody zeme=, np. PKPIC KM)")
    ap.add_argument("--limit", type=int, default=None,
                    help="ogranicz liczbę pobieranych składów (testy)")
    ap.add_argument("--delay", type=float, default=1.1, help="odstęp między zapytaniami [s]")
    ap.add_argument("--tylko-listing", action="store_true", help="nie pobieraj składów")
    ap.add_argument("--wznow", action="store_true", help="wznów pobieranie składów z checkpointu")
    ap.add_argument("--od-nowa", action="store_true", help="ignoruj cache (nie usuwa go)")
    ap.add_argument("--cache", default="cache", help="katalog cache (domyślnie ./cache)")
    ap.add_argument("--udogodnienia", action="store_true",
                    help="tryb dla Kilometra: płaski plik udogodnień, przyrostowy cache")
    ap.add_argument("--out-udogodnienia", default=None,
                    help="plik wynikowy trybu --udogodnienia (domyślnie cloudflare/data/rail-amenities.json)")
    ap.add_argument("--stan", action="store_true", help="pokaż postęp pobierania i wyjdź")
    ap.add_argument("--zloz", action="store_true", help="złóż plik wynikowy z cache i wyjdź")
    args = ap.parse_args()

    rok = args.rok
    os.makedirs(args.cache, exist_ok=True)
    klient = Klient(delay=args.delay)
    tylko_dopravci = set(args.dopravci) if args.dopravci else None

    def cache_gotowe(nazwa):
        return (not args.od_nowa) and os.path.exists(os.path.join(args.cache, nazwa))

    # 1) rozcestnik przewoźników
    indeks = faz_indeks(klient, rok, args.cache) if not (tylko_dopravci and cache_gotowe(f"indeks_{rok}.json")) else \
        json.load(open(os.path.join(args.cache, f"indeks_{rok}.json"), encoding="utf-8"))

    # 2) klasyfikacja przewoźników
    klasy = faz_probe(klient, rok, args.cache, indeks, tylko_dopravci)

    # 3) listy pociągów
    pociagi, pominiete = faz_listings(klient, rok, args.cache, klasy, indeks, tylko_dopravci)
    print(f"      RAZEM: {len(pociagi)} unikalnych pociągów", file=sys.stderr)

    # Tryb udogodnień dla aplikacji: przyrostowy cache + płaski plik.
    if args.udogodnienia:
        out = args.out_udogodnienia or os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..", "..", "cloudflare", "data", "rail-amenities.json",
        )
        if args.stan:
            stan_pobierania(rok, args.cache, pociagi)
            return
        if args.zloz:
            zloz_udogodnienia(rok, args.cache, pociagi, out)
            return
        faz_udogodnienia(klient, rok, args.cache, pociagi, args.wznow, args.limit)
        stan_pobierania(rok, args.cache, pociagi)
        zloz_udogodnienia(rok, args.cache, pociagi, out)
        return

    # 4) składy
    sklady = {}
    if not args.tylko_listing:
        sklady = faz_sklady(klient, rok, args.cache, pociagi, args.wznow or True, args.limit)

    # 5) zapis JSON
    print("[5/5] Zapisuję JSON...", file=sys.stderr)
    wynik = []
    for p in pociagi:
        skl = sklady.get(p["klucz"], [])
        podsumowanie = podsumuj_pociag(skl)
        wpis = {
            "przewoznik": p["przewoznik"],
            "przewoznik_nazwa": indeks["nazwy"].get(p["przewoznik"]),
            "kategoria": p["kategoria"],
            "numer": p["numer"],
            "nazwa": p["nazev"],
            "trasa": p["trasa"],
            "miedzynarodowy": p["miedzynarodowy"],
            "url": p["url"],
            **podsumowanie,
            "sklady": skl,
            "brak_danych": not any(s.get("pojazdy") for s in skl),
        }
        wynik.append(wpis)

    payload = {
        "metadane": {
            "zrodlo": "https://www.vagonweb.cz/razeni/",
            "rok_rozkladu": rok,
            "wygenerowano": datetime.now().isoformat(timespec="seconds"),
            "liczba_pociagow": len(wynik),
            "liczba_bez_danych": sum(1 for w in wynik if w["brak_danych"]),
            "liczba_pominionych_duplikatow": len(pominiete),
            "opis": (
                "Składy planowane vagonweb (wszystkie warianty na rok rozkładu). "
                "Pojazdy: typ (lokomotywa/wagon/zespolony), seria, model, udogodnienia. "
                " Duplikaty = ten sam pociąg prowadzony też pod zagranicznym przewoźnikiem."
            ),
        },
        "pociagi": wynik,
        "pominiete_duplikaty": pominiete,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(
        f"\nGotowe: {len(wynik)} pociągów -> {args.out} "
        f"(zapytań: {klient.zapytan}, blokad: {klient.blokady})",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
