import type { LegMode } from '../types/models';

export type FloorLevel = 'low' | 'partial' | 'high' | 'unknown';
export type AcAvailability = 'yes' | 'no' | 'unknown';
export type VehicleDrive = 'electric' | 'hydrogen' | 'hybrid';

export interface VehicleSpecs {
  /** Znormalizowana nazwa modelu z feedu (np. "Konstal 105NWr"). */
  model: string;
  /** Poziom podłogi: 100% niska, częściowo niska / niskowejściowy, wysoka albo nieznany. */
  floor: FloorLevel;
  /** Klimatyzacja przedziału pasażerskiego (tylko potwierdzone modele, bez zgadywania). */
  ac: AcAvailability;
  /** Starsza konstrukcja wysokopodłogowa / klasyczny tabor (np. 105N*, E1, KT4DtM, EN57, Jelcz 120M). */
  vintage: boolean;
  /** Napęd bezemisyjny lub hybrydowy (pokazywany dla autobusów, gdzie jest realnym wyróżnikiem). */
  drive?: VehicleDrive;
}

interface RuleOutcome {
  floor: FloorLevel;
  ac: AcAvailability;
  vintage: boolean;
}

interface ClassifierRule {
  test: (norm: string, isLowEntry: boolean) => boolean;
  result: (norm: string, isLowEntry: boolean) => RuleOutcome;
}

const CHAR_FOLD_MAP: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
  š: 's',
  č: 'c',
  ř: 'r',
  ž: 'z',
  ě: 'e',
  ů: 'u',
  ú: 'u',
  ý: 'y',
  á: 'a',
  é: 'e',
  í: 'i',
  ä: 'a',
  ö: 'o',
  ü: 'u',
  ß: 'ss',
};

/** Czyści nazwę modelu do wyświetlenia użytkownikowi (spacje, backticki z feedu). */
function cleanModelName(raw: string): string {
  return raw.replace(/`/g, "'").replace(/\s+/g, ' ').trim();
}

/** Składa nazwę modelu do ASCII małych liter, żeby warianty zapisu (Škoda/Skoda, Düwag/Duewag, МАЗ/MAZ) trafiały w te same reguły. */
function normalizeForMatch(model: string): string {
  return model
    .toLowerCase()
    .replace(/маз/g, 'maz')
    .replace(/заз/g, 'zaz')
    .replace(/[ąćęłńóśźżščřžěůúýáéíäöüß]/g, (ch) => CHAR_FOLD_MAP[ch] ?? ch)
    .replace(/[`'’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function hasLowEntryTag(norm: string): boolean {
  return /\b(le|leu|low[\s-]?entry)\b/.test(norm) || /\d+le\b/.test(norm);
}

/** Wykrywa napęd na podstawie oficjalnej nazwy modelu (tylko dla autobusów, nie dla tramwajów/trolejbusów). */
function detectBusDrive(norm: string, mode?: LegMode): VehicleDrive | undefined {
  if (mode === 'tram' || mode === 'trolleybus' || mode === 'train' || mode === 'subway') {
    return undefined;
  }
  if (/\b(trollino|t70116|cs18t)\b/.test(norm)) return undefined;

  if (/\b(hydrogen|fuelcell|neso\s*bus|h2)\b/.test(norm)) {
    return 'hydrogen';
  }
  if (
    /\b(electric|ecitaro|ie\s*bus|e-?jest|esprinter|c[sz]\d+e|m\d+lfe|pivot\s*e\d+|xml6125cle|ev)\b/.test(
      norm,
    ) ||
    (/\byutong\b/.test(norm) && /\b(u\d+|e\d+|bevg|\w*bevg\w*)\b/.test(norm)) ||
    /\blion'?s\s*city\s*\d*\s*e\b/.test(norm) ||
    /\bman\s+lion'?s\s*city\s+(10|12|18)\s*e\b/.test(norm)
  ) {
    return 'electric';
  }
  if (/\b(hybrid|efficienthybrid)\b/.test(norm)) {
    return 'hybrid';
  }
  return undefined;
}

const RULES: ClassifierRule[] = [
  // =========================================================================
  // 1. TRAMWAJE WYSOKOPODŁOGOWE / STARSZY TABOR
  // =========================================================================
  {
    // Konstal / Protram 105N*, 805N*, 102N*, 13N, 4N, ND1, 204WrAs
    test: (n) =>
      /\b(105n\w*|805n\w*|102n\w*|13n|204wras|nd1|4n)\b/.test(n) ||
      /\b(konstal|protram)\s+105/.test(n),
    result: () => ({ floor: 'high', ac: 'no', vintage: true }),
  },
  {
    // Moderus Alfa (zmodernizowany 105Na, nadal 100% wysoka podłoga, bez klimy pasażerskiej)
    test: (n) => /\bmoderus\s+alfa\b/.test(n) || /\bhf\s*\d{2}/.test(n),
    result: () => ({ floor: 'high', ac: 'no', vintage: true }),
  },
  {
    // FPS / Cegielski 123N (wysokopodłogowa konstrukcja bazująca na 105N)
    test: (n) => /\b123n\b/.test(n),
    result: () => ({ floor: 'high', ac: 'no', vintage: true }),
  },
  {
    // SGP / Lohner E1 + doczepy c3 (Kraków, GZM)
    test: (n) => /\b(sgp|lohner)\s*e1\b/.test(n) || /\be1\s*\+\s*c3\b/.test(n),
    result: () => ({ floor: 'high', ac: 'no', vintage: true }),
  },
  {
    // Tatra KT4D*, T6A2*, T3* (Szczecin i starsze wagony)
    test: (n) => /\b(kt4d\w*|t6a2\w*|tatra\s+t3\w*)\b/.test(n),
    result: () => ({ floor: 'high', ac: 'no', vintage: true }),
  },
  {
    // Wegmann 6ZGTW, zabytkowe GFW K / WIwK
    test: (n) => /\b(6zgtw|wegmann|gfw\s+k|wiwk)\b/.test(n),
    result: () => ({ floor: 'high', ac: 'no', vintage: true }),
  },

  // =========================================================================
  // 2. TRAMWAJE CZĘŚCIOWO NISKOPODŁOGOWE
  // =========================================================================
  {
    // Moderus Beta z potwierdzoną klimatyzacją przedziału pasażerskiego
    test: (n) =>
      /\bmoderus\s+beta\b/.test(n) && /\bmf\s*(10|11|19|20|22|24|29|30)\s*ac\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'yes', vintage: false }),
  },
  {
    // Moderus Beta bez klimatyzacji przedziału pasażerskiego (MF02AC, MF15AC, MF16AC, MF25AC)
    test: (n) => /\bmoderus\s+beta\b/.test(n) && /\bmf\s*(02|15|16|25)\s*ac\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'no', vintage: false }),
  },
  {
    // Pozostałe warianty Moderus Beta
    test: (n) => /\bmoderus\s+beta\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'unknown', vintage: false }),
  },
  {
    // Protram/Modertrans 205WrAs MF17AC po modernizacji (z klimatyzacją)
    test: (n) => /\b205wras\b/.test(n) && (/\bmf\s*17\s*ac\b/.test(n) || /modertrans/.test(n)),
    result: () => ({ floor: 'partial', ac: 'yes', vintage: false }),
  },
  {
    // Protram 205WrAs przed modernizacją (częściowo niska podłoga, brak klimy pasażerskiej)
    test: (n) => /\b205wras\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'no', vintage: false }),
  },
  {
    // Škoda 16T (wszystkie wrocławskie po modernizacji z klimą) i 19T (fabryczna klima)
    test: (n) => /\b(16t|19t)\b/.test(n) && /skoda/.test(n),
    result: () => ({ floor: 'partial', ac: 'yes', vintage: false }),
  },
  {
    // Bombardier NGT6 (wszystkie krakowskie z klimatyzacją ENIKA) i NGT8
    test: (n) => /\bngt\s*[68]\b/.test(n) || /\bngt6-2\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'yes', vintage: false }),
  },
  {
    // Rotax/MPK EU8N (Kraków), Tatra/Modertrans RT6 MF06AC (Poznań)
    test: (n) => /\b(eu8n|rt6\w*)\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'yes', vintage: false }),
  },
  {
    // Alstom/TŚ 116Ndm (zmodernizowane w GZM, z klimą) vs warszawskie 116Na/116N/112N (bez klimy)
    test: (n) => /\b116ndm\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'yes', vintage: false }),
  },
  {
    test: (n) => /\b(116na\w*|116n|112n)\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'no', vintage: false }),
  },
  {
    // Pesa Twist 2012N (GZM, ~73% niskiej podłogi + klima)
    test: (n) => /\b2012n\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'yes', vintage: false }),
  },
  {
    // Duewag / MAN N8C-NF, GT8N, GT8C, M8CN (częściowo niskie, klimatyzacja zależna od miasta)
    test: (n) => /\b(n8c-nf|gt8n\w*|gt8c\w*|m8cn\w*)\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'unknown', vintage: false }),
  },
  {
    // NF6D (Łódź ex-Bochum, ~70% niskiej podłogi, brak klimatyzacji)
    test: (n) => /\bnf6d\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'no', vintage: false }),
  },
  {
    // Duewag R1.1 (Poznań ex-Bonn, 100% niska podłoga, bez klimatyzacji)
    test: (n) => /\br1\.1\b/.test(n),
    result: () => ({ floor: 'low', ac: 'no', vintage: false }),
  },
  {
    // Pozostałe klasyczne wysokopodłogowe Duewagi (GT6, GT8, GT8S, M6S, M8C, M8S, B80D, PT8, N8C)
    test: (n) =>
      /\b(du?ewag|duwag)\b/.test(n) &&
      /\b(gt6|gt8|gt8s|m6s|m8c|m8s|b80d|pt8|n8c)\b/.test(n),
    result: () => ({ floor: 'high', ac: 'no', vintage: true }),
  },

  // =========================================================================
  // 3. TRAMWAJE W PEŁNI NISKOPODŁOGOWE
  // =========================================================================
  {
    // Pesa Swing / Jazz / Twist / Krakowiak / 120N / 121NbT / 122NbT (musi być przed 121N/122N)
    test: (n) =>
      /\b(120na\w*|120n|121nbt\w*|122nbt\w*|128n\w*|134n|146n|2010n\w*|2014n|2015n|2017n\w*)\b/.test(
        n,
      ) || /\bpesa\s+(swing|jazz|twist|krakowiak)\b/.test(n),
    result: () => ({ floor: 'low', ac: 'yes', vintage: false }),
  },
  {
    // Pesa 121N (2006 Elbląg Tramicus, 100% niska podłoga, bez klimatyzacji pasażerskiej)
    test: (n) => /\b121n\b/.test(n),
    result: () => ({ floor: 'low', ac: 'no', vintage: false }),
  },
  {
    // Pesa 122N (2008 Tramicus, 100% niska podłoga, klima zależna od miasta)
    test: (n) => /\b122n\b/.test(n),
    result: () => ({ floor: 'low', ac: 'unknown', vintage: false }),
  },
  {
    // Moderus Gamma (LF01AC..LF12ACBD)
    test: (n) => /\bmoderus\s+gamma\b/.test(n) || /\blf\s*\d{2}\s*ac/.test(n),
    result: () => ({ floor: 'low', ac: 'yes', vintage: false }),
  },
  {
    // Hyundai Rotem 140N/141N/142N, Stadler Tango (Lajkonik), Solaris Tramino, Siemens Combino, Durmazlar Panorama, Bozankaya
    test: (n) =>
      /\b(140n|141n|142n|stadler\s+tango|lajkonik|tramino|combino|durmazlar|drp5h05|bozankaya)\b/.test(
        n,
      ),
    result: () => ({ floor: 'low', ac: 'yes', vintage: false }),
  },
  {
    // Bombardier Cityrunner / Flexity Outlook (Łódź, 100% niska podłoga)
    test: (n) => /\b(cityrunner|flexity)\b/.test(n),
    result: () => ({ floor: 'low', ac: 'unknown', vintage: false }),
  },

  // =========================================================================
  // 4. TROLEJBUSY
  // =========================================================================
  {
    // Ursus T70116 / CS18T, Solaris Trollino 18 i nowsze Trollino 12M/IV
    test: (n) =>
      /\b(ursus\s+t70116|ursus\s+cs18t|trollino\s+18|trollino\s+12m|trollino\s+.*iv)\b/.test(n),
    result: () => ({ floor: 'low', ac: 'yes', vintage: false }),
  },
  {
    // Starsze / ogólne Solaris Trollino 12 / 12S (niskopodłogowe, klima zależna od rocznika)
    test: (n) => /\btrollino\b/.test(n),
    result: () => ({ floor: 'low', ac: 'unknown', vintage: false }),
  },

  // =========================================================================
  // 5. KOLEJ REGIONALNA I DALEKOBIEŻNA (zbiorkom.live PKP / koleje regionalne)
  // =========================================================================
  {
    // Zmodernizowane EN57/EN71 (AL, AKM, AKS, AKD, AKL, FPS, Feniks): wysoka podłoga, ale z klimą
    test: (n) => /\b(en57|en71)\s*-?\s*(al|akm|aks|akd|akl|fps|feniks)\b/.test(n),
    result: () => ({ floor: 'high', ac: 'yes', vintage: true }),
  },
  {
    // Klasyczne EN57 / EN71 / ED72 oraz Düwag VT627 / VT628 (wysoka podłoga, bez klimatyzacji)
    test: (n) => /\b(en57|en71|ed72|vt627|vt628)\b/.test(n),
    result: () => ({ floor: 'high', ac: 'no', vintage: true }),
  },
  {
    // Alstom Pendolino ED250 (wysoka podłoga z drzwiami ze stopniami, pełna klimatyzacja)
    test: (n) => /\b(ed250|pendolino)\b/.test(n),
    result: () => ({ floor: 'high', ac: 'yes', vintage: false }),
  },
  {
    // Nowoczesne EZT/SZT: Pesa Elf / Elf 2 / Acatus / Dart / Link / 33WE / 214M / 218M / 223M,
    // Newag Impuls / Impuls 2 / 39WE / 220M-222M / Vulcano, Stadler Flirt / Flirt 3
    test: (n) =>
      /\b(elf|acatus|impuls|flirt|vulcano|pesa\s+dart|ed160|ed161|er75|en75|er160|en63\w*|en76\w*|en77\w*|en78\w*|en79\w*|en97|en100|sa134|sa135|sa137|sa138|sa139|l-?4268|lm-?4268)\b/.test(
        n,
      ) ||
      /\b(21we\w*|22we\w*|27we\w*|31we\w*|32we\w*|33we\w*|34we\w*|35we\w*|36we\w*|37we\w*|39we\w*|40we\w*|45we\w*|48we\w*|214m\w*|218m\w*|220m\w*|221m\w*|222m\w*|223m\w*)\b/.test(
        n,
      ),
    result: () => ({ floor: 'low', ac: 'yes', vintage: false }),
  },

  // =========================================================================
  // 6. AUTOBUSY WYSOKOPODŁOGOWE / STARSZY TABOR
  // =========================================================================
  {
    // Jelcz 120M / M11 / PR110, Ikarus 260 / 280, Autosan H9 / H10, ZAZ A08
    test: (n) =>
      /\b(jelcz\s+(120m\w*|m11|pr110\w*)|ikarus\s+(260|280)|autosan\s+h(9|10)\w*|zaz\s+a08\w*)\b/.test(
        n,
      ),
    result: () => ({ floor: 'high', ac: 'no', vintage: true }),
  },
  {
    // Jelcz M121* / M081MB (niskowejściowe bez klimy)
    test: (n) => /\bjelcz\s+(m121\w*|m081\w*)\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'no', vintage: true }),
  },
  {
    // Starsze niskopodłogowe bez klimy z lat 90./początku 2000.
    test: (n) =>
      /\b(jelcz\s+m125\w*|man\s+(nl202|nl222|nl262|ng272|ng312)|neoplan\s+n40\d{2}|volvo\s+(b10ble|7000))\b/.test(
        n,
      ),
    result: () => ({ floor: 'low', ac: 'no', vintage: true }),
  },
  {
    // Podmiejskie wysokopodłogowe nowsze (np. Iveco Crossway 12 Line NP, bez LE)
    test: (n, isLE) => !isLE && /\biveco\s+crossway\b/.test(n),
    result: () => ({ floor: 'high', ac: 'yes', vintage: false }),
  },
  {
    // MAZ 103 / ZAZ A10 (niskowejściowe, klimatyzacja niepewna)
    test: (n) => /\b(maz\s+103\w*|zaz\s+a10\w*)\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'unknown', vintage: false }),
  },
  {
    // MAZ 203 (niskopodłogowy, klimatyzacja zależna od wersji)
    test: (n) => /\bmaz\s+203\w*\b/.test(n),
    result: () => ({ floor: 'low', ac: 'unknown', vintage: false }),
  },

  // =========================================================================
  // 7. AUTOBUSY NOWOCZESNE (BEZEMISYJNE, HYBRYDOWE, NOWE GENERACJE Z KLIMĄ)
  // =========================================================================
  {
    // Autobusy elektryczne, wodorowe i hybrydowe (w Polsce 100% fabryczna klimatyzacja)
    test: (n) =>
      /\b(electric|ecitaro|ie\s*bus|hydrogen|fuelcell|neso\s*bus|hybrid|efficienthybrid|e-?jest|esprinter|c[sz]\d+e|m\d+lfe|pivot\s*e\d+|xml6125cle|fencer\s+f1)\b/.test(
        n,
      ) ||
      (/\byutong\b/.test(n) && /\b(u\d+|e\d+|bevg|\w*bevg\w*)\b/.test(n)) ||
      /\blion'?s\s*city\s+(10|12|18)\s*e\b/.test(n),
    result: (_n, isLE) => ({ floor: isLE ? 'partial' : 'low', ac: 'yes', vintage: false }),
  },
  {
    // Scania / Higer Fencer f6 (podmiejski niskowejściowy z klimą)
    test: (n) => /\bfencer\s+f6\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'yes', vintage: false }),
  },
  {
    // Mercedes-Benz Citaro C2 / O530* C2 / Conecto (nowoczesne generacje z klimą)
    test: (n) =>
      /\b(o530\w*\s+c2|citaro\s+c2|citaro\s+2|conecto)\b/.test(n) ||
      (/\bmercedes/.test(n) && /\bc2\b/.test(n)),
    result: (_n, isLE) => ({ floor: isLE ? 'partial' : 'low', ac: 'yes', vintage: false }),
  },
  {
    // MAN Lion's City New Generation (10 / 12 / 18 / 19 / 12C / 18C / 19C / 12G / 18G)
    test: (n) => /\blion'?s\s*city\s+(10|12|18|19)[ceg]?\b/.test(n),
    result: (_n, isLE) => ({ floor: isLE ? 'partial' : 'low', ac: 'yes', vintage: false }),
  },
  {
    // Solaris Urbino generacji IV i wariantów dostępnych wyłącznie z klimatyzacją
    test: (n) =>
      /\burbino\b/.test(n) &&
      (/\b(iv|metrostyle|10[,.]5|12[,.]9|18[,.]75)\b/.test(n) || /\burbino\s+9\s+le\b/.test(n)),
    result: (_n, isLE) => ({ floor: isLE ? 'partial' : 'low', ac: 'yes', vintage: false }),
  },
  {
    // Nowoczesne marki/serie miejskie dostarczane w Polsce z klimatyzacją
    test: (n) =>
      /\b(volvo\s+7900\w*|isuzu\s+(citiport|novociti)\w*|otokar\s+(kent|vectio)\w*|bmc\s+procity\w*|akia\s+ultra\w*|iveco\s+(streetway|crossway\s+le|urbanway)\w*|setra\s+s\s*4\d{2}\s+le|autosan\s+(m10lf|m12lf|m18lf|sancity\s+\d+lf)\w*|temsa\s+lf|scania\s+(new\s+city|citywide|cn280ub)\w*|solbus\s+sm\d+|vdl\s+citea\w*|sor\s+(bng|nb|ns)\w*|guleryuz\s+ecoline\w*|king\s+long|karsan\s+(atak|jest)\w*|pilea\s+\d+|ursus\s+cs12d)\b/.test(
        n,
      ),
    result: (_n, isLE) => ({ floor: isLE ? 'partial' : 'low', ac: 'yes', vintage: false }),
  },
  {
    // Nowoczesne minibusy miejskie (Sprinter / 51x CDI zabudowy miejskie, Mercus, MAN TGE, Daily, MMI Urby, Automet)
    test: (n) =>
      /\b(sprinter|mercus|man\s+tge|iveco\s+daily|mmi\s+urby|automet|kapena\s+urby|iveco\s+kapena|vdl\s+midcity)\b/.test(
        n,
      ) || /\bmercedes-benz\s+51\d\s+cdi\b/.test(n),
    result: () => ({ floor: 'partial', ac: 'yes', vintage: false }),
  },

  // =========================================================================
  // 8. POZOSTAŁE AUTOBUSY NISKOPODŁOGOWE / NISKOWEJŚCIOWE (KLIMA ZALEŻNA OD ROCZNIKA)
  // =========================================================================
  {
    // Ogólne Solaris Urbino, Mercedes O530 (starsze/bez C2), MAN Lion's City (starsze), Volvo 7700/8900, Autosan M09LE/Sancity, Scania OmniCity/CN
    test: (n) =>
      /\b(solaris\s+urbino|o530\w*|citaro|lion'?s\s*city|man\s+(nl|ng|nm|a21|a23|a37|a40)\w*|volvo\s+(7700|8900)\w*|autosan\s+(m09le|sancity)\w*|scania\s+(omnicity|cn\d+)\w*|solaris\s+alpino\w*|neoplan\s+centroliner)\b/.test(
        n,
      ),
    result: (_n, isLE) => ({ floor: isLE ? 'partial' : 'low', ac: 'unknown', vintage: false }),
  },
];

/**
 * Klasyfikuje surowy ciąg `vehicle.model` z zbiorkom.live na cechy czytelne dla pasażera
 * (poziom podłogi, klimatyzacja, starszy tabor, opcjonalnie napęd bezemisyjny).
 * Dla nieznanych modeli zachowuje nazwę i nie zgaduje brakujących parametrów.
 */
export function classifyVehicleModel(
  rawModel?: string | null,
  mode?: LegMode,
): VehicleSpecs | null {
  if (!rawModel) return null;
  const model = cleanModelName(rawModel);
  if (!model) return null;

  const norm = normalizeForMatch(model);
  const isLowEntry = hasLowEntryTag(norm);
  const drive = detectBusDrive(norm, mode);

  for (const rule of RULES) {
    if (rule.test(norm, isLowEntry)) {
      const outcome = rule.result(norm, isLowEntry);
      return {
        model,
        floor: outcome.floor,
        ac: outcome.ac,
        vintage: outcome.vintage,
        ...(drive ? { drive } : {}),
      };
    }
  }

  // Fallback dla przyszłych / rzadkich modeli spoza tablicy reguł:
  // nie zgadujemy klimy ani podłogi, chyba że wynikają wprost z oznaczenia LF/LE w nazwie.
  let floor: FloorLevel = 'unknown';
  if (/\b(lf|low[\s-]?floor)\b/.test(norm) || /\d+lf\b/.test(norm)) {
    floor = 'low';
  } else if (isLowEntry) {
    floor = 'partial';
  }

  const ac: AcAvailability = drive ? 'yes' : 'unknown';

  return {
    model,
    floor,
    ac,
    vintage: false,
    ...(drive ? { drive } : {}),
  };
}
