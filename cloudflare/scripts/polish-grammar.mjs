/**
 * Moduł poprawności gramatycznej i odmiany nazw ulic oraz punktów orientacyjnych (POI)
 * dla mikrowskazówek lokalizacji przystanków (język polski).
 */

const GARBAGE_STREET_RE =
  /^(?:progi|patelnia|parking|pętla|petla|tunel|dojazd|teren|plac budowy|droga\b|jezdnia\b|ciąg\b|ciag\b|przejście\b|przejscie\b|zjazd\b|wjazd\b|łącznica\b|lacznica\b|odcinek\b|trasa\s+bez\s+nazwy|bez\s+nazwy|n\/a|-)$/i;

/** Znane krótkie ulice przymiotnikowe (bez jednoznacznego sufiksu -ska/-cka/-zka/-owa). */
const KNOWN_FEMININE_ADJ_STREETS = new Set([
  'biała', 'boczna', 'bracka', 'brukowa', 'cicha', 'ciepła', 'chłodna', 'chmielna',
  'codzienna', 'czarna', 'czerwona', 'czysta', 'długa', 'dobra', 'dolna', 'dzika',
  'głęboka', 'główna', 'górna', 'graniczna', 'hoża', 'jasna', 'kamienna', 'krótka',
  'krucza', 'krzywa', 'leśna', 'mała', 'młodzieńcza', 'niska', 'nowa', 'odkryta',
  'okrężna', 'orla', 'pawia', 'piękna', 'piwna', 'pogodna', 'polna', 'północna',
  'południowa', 'poprzeczna', 'prosta', 'rolna', 'różana', 'rybna', 'rzeczna',
  'skrajna', 'skośna', 'ślężna', 'słoneczna', 'sokola', 'twarda', 'spokojna', 'średnia',
  'środkowa', 'stara', 'starowiślna', 'sucha', 'syta', 'szeroka', 'wąska', 'widoczna',
  'wielka', 'wilcza', 'wodna', 'wschodnia', 'wspólna', 'wysoka', 'zachodnia',
  'zajęcza', 'zawiła', 'żelazna', 'zielona', 'zimna', 'złota', 'żurawia',
]);

/** Rzeczowniki/nazwiska zakończone na -a, które NIE są przymiotnikami i zostają bez zmian. */
const KEEP_UNCHANGED_STREET_WORDS = new Set([
  'abrahama', 'andersa', 'asnyka', 'bema', 'boranta', 'chopina', 'dietla', 'dwernickiego',
  'fieldorfa', 'fredry', 'gagarina', 'grottgera', 'hallera', 'herberta', 'jana', 'kard',
  'korfantego', 'kościuszki', 'koszelew', 'lubicz', 'mickiewicza', 'norwida', 'piłsudskiego',
  'plater', 'prusa', 'reja', 'roosevelta', 'samarytanka', 'sienkiewicza', 'skorupki',
  'słowackiego', 'sobieskiego', 'solidarności', 'staszica', 'stawki', 'szucha', 'tamka',
  'traugutta', 'tuwima', 'waryńskiego', 'westerplatte', 'wilsona', 'witosa', 'woronicza',
  'zgoda', 'zwycięzców',
]);

/** Końcówki rzeczownikowo-dopełniaczowe (NIE zawiera pojedynczych liter y/i). */
const GENITIVE_ENDINGS_RE =
  /(?:ego|ej|ów|ow|ii|iii|iv|vi|vii|viii|maja|listopada|stycznia|lutego|marca|kwietnia|czerwca|lipca|sierpnia|września|października|grudnia|solidarności|wolności|niepodległości|zwycięstwa|pokoju|przyjaźni|konstytucji|powstania|wojska|armii|ludu|narodu|pracy|młodzieży|bohaterów|obrońców|powstańców|żołnierzy|kosynierów|strzelców|szwoleżerów|ułanów|pułku|brygady|korpusu)$/i;

/**
 * Odmienia pojedyncze przymiotnikowe słowo rodzaju żeńskiego w miejscowniku:
 * np. "Marszałkowska" -> "Marszałkowskiej", "Długa" -> "Długiej", "Ślężna" -> "Ślężnej".
 */
function declineFeminineAdjWord(word) {
  const lower = word.toLowerCase();
  if (KEEP_UNCHANGED_STREET_WORDS.has(lower)) return word;
  if (GENITIVE_ENDINGS_RE.test(lower)) return word;

  // Wyjątki rzeczownikowe (nazwy rzek, dzielnic, miejscowości, rzeczowników pospolitych)
  if (/^(?:wisła|odra|warta|nysa|bystrzyca|widawa|oława|ślęza|rudawa|wilga|rawa|kłodnica|brynica|przemsza|soła|skawa|raba|zgoda|arena|korona|wola|praga|ochota|wesoła|stolica|granica|winnica|kuźnica|leśnica|świdnica|wieliczka|bochnia|skawina|warszawa|polska|europa|góra|dolina|rzeka|łąka|aleja|szosa|droga|pętla|stacja|hala|poczta|szkoła|katedra|bazylika|kaplica|kamienica|kolonia|dzielnica|gmina|wieś|wiosna|zima|woda|ziemia|gwiazda|wystawa|kawa|brama|fosa|grobla|kaskada|kepa|kępa|wyspa|zatoka|polana|ściana|dębina|brzezina|olszyna|leszczyna|kalina|malina|jarzębina|krzewina|kotlina|równina|wyżyna|nizina|kraina|ojczyzna|bukowina|głuszyna|spółdzielnia|elektrownia|gazownia|ciepłownia|zajezdnia|hurtownia|piekarnia|cukiernia|kawiarnia|księgarnia|kwiaciarnia|lodziarnia|drukarna|szwalnia|pralnia|myjnia|stajnia|kuźnia)$/i.test(lower)) {
    return word;
  }

  const isClearAdj =
    KNOWN_FEMININE_ADJ_STREETS.has(lower) ||
    /(?:ska|cka|zka|owa|ewa|ana|nicza|ista|ysta|alna|elna|olna|ulna|arna|erna|orna|urna|iczna|yczna|eczna|oczna|ienna|anna|enna|inna|onna|unna|ejna|ijna|yjna|ajna|ojna|ujna|owna|ewna|ywna|iwna|awna|żna|ślna|bna|dna|gna|kna|lna|mna|pna|rna|sna|tna|wna|zna|ańska|eńska|ińska|ońska|uńska|yńska|owska|ewska|awska|iwska|ywska|ecka|icka|ycka|acka|ocka|ucka|dzka|czka|szka|żka|lska|rska|nska|mska|wska|bska|pska|tska|dska|gska|kska|hska|fska|jska|sska|zska|ższa|tsza|dsza|gsza|ksza|lsza|msza|nsza|psza|rsza|wsza|zsza|ńcza|rcza|wcza|bcza|dcza|gcza|kcza|lcza|mcza|ncza|pcza|scza|tcza|zcza|ęża|ąża|oża|uża|iża|yża|eża|aża|iąca|ąca|ęca|oca|uca)$/.test(
      lower,
    );

  if (!isClearAdj) return word;

  if (/[kg]a$/i.test(word)) return word.slice(0, -1) + 'iej';
  if (/ia$/i.test(word)) return word.slice(0, -1) + 'ej';
  if (/a$/i.test(word)) return word.slice(0, -1) + 'ej';
  return word;
}

/**
 * Odmienia przymiotnik rodzaju męskiego w miejscowniku:
 * "Bankowy" -> "Bankowym", "Teatralny" -> "Teatralnym", "Bernardyński" -> "Bernardyńskim".
 * Chroni rzeczowniki w dopełniaczu typu "Synagogi", "Pragi".
 */
function declineMasculineAdjWord(word) {
  const lower = word.toLowerCase();
  if (KEEP_UNCHANGED_STREET_WORDS.has(lower) || GENITIVE_ENDINGS_RE.test(lower)) return word;
  if (/(?:ski|cki|zki|dzki|ński|wski|lski|rski|mski|bski|pski|tski|dski|gski|kski|elki|olski|ocki|ecki|icki|ycki|acki)$/.test(lower)) {
    return word + 'm';
  }
  if (/(?:ny|wy|ly|ry|ty|dy|by|my|py|sy|zy|cy|czy|szy|ży|owy|ewy|iwy|ywy)$/.test(lower)) {
    return word + 'm';
  }
  return word;
}

/** Odmienia przymiotnik rodzaju nijakiego w miejscowniku: "Mogilskie" -> "Mogilskim". */
function declineNeuterAdjWord(word) {
  const lower = word.toLowerCase();
  if (/(?:skie|ckie|zkie|dzkie|ńskie|wskie)$/.test(lower)) return word.slice(0, -1) + 'm';
  if (/e$/.test(lower) && /(?:ne|we|le|re|te|de|be|me|pe|se|ze|ce|cze|sze|że)$/.test(lower)) {
    return word.slice(0, -1) + 'ym';
  }
  return word;
}

/** Odmienia przymiotnik w liczbie mnogiej w miejscowniku: "Jerozolimskie" -> "Jerozolimskich". */
function declinePluralAdjWord(word) {
  const lower = word.toLowerCase();
  if (/(?:skie|ckie|zkie|dzkie|ńskie|wskie)$/.test(lower)) return word.slice(0, -1) + 'ch';
  if (/(?:ne|we|le|re|te|de|be|me|pe|se|ze|ce|cze|sze|że)$/.test(lower)) {
    return word.slice(0, -1) + 'ych';
  }
  return word;
}

function declineStreetCore(core, kind) {
  const trimmed = core.trim();
  if (!trimmed) return trimmed;

  const exactMap = {
    'al. jerozolimskie': 'Al. Jerozolimskich',
    'aleje jerozolimskie': 'Al. Jerozolimskich',
    'al. ujazdowskie': 'Al. Ujazdowskich',
    'aleje ujazdowskie': 'Al. Ujazdowskich',
    'jerozolimskie': 'Jerozolimskich',
    'ujazdowskie': 'Ujazdowskich',
    'solidarności': 'Solidarności',
    '„solidarności”': '„Solidarności”',
    '"solidarności"': '„Solidarności”',
    'święty marcin': 'Święty Marcin',
    'św. marcin': 'Święty Marcin',
    'nowy świat': 'Nowym Świecie',
    'krakowskie przedmieście': 'Krakowskim Przedmieściu',
    'stare miasto': 'Starym Mieście',
    'nowy kleparz': 'Nowym Kleparzu',
    'stary kleparz': 'Starym Kleparzu',
    'małe garbary': 'Małych Garbarach',
    'górna wilda': 'Górnej Wildzie',
    'dolna wilda': 'Dolnej Wildzie',
    'wielka skotnica': 'Wielkiej Skotnicy',
    'trakt lubelski': 'Trakcie Lubelskim',
    'trakt brzeski': 'Trakcie Brzeskim',
    'wał miedzeszyński': 'Wale Miedzeszyńskim',
    'wał zawadowski': 'Wale Zawadowskim',
    'wybrzeże kościuszkowskie': 'Wybrzeżu Kościuszkowskim',
    'wybrzeże gdańskie': 'Wybrzeżu Gdańskim',
    'wybrzeże gdyńskie': 'Wybrzeżu Gdyńskim',
    'wybrzeże szczecińskie': 'Wybrzeżu Szczecińskim',
    'wybrzeże helskie': 'Wybrzeżu Helskim',
    'wybrzeże wyspiańskiego': 'Wybrzeżu Wyspiańskiego',
    'podwale': 'Podwalu',
    'podwale przedmiejskie': 'Podwalu Przedmiejskim',
    'szosa poznańska': 'Szosie Poznańskiej',
    'szosa krakowska': 'Szosie Krakowskiej',
  };
  const exactKey = trimmed.toLowerCase();
  if (exactMap[exactKey]) return exactMap[exactKey];

  const words = trimmed.split(/\s+/);

  if (kind === 'aleje_pl') {
    if (words.length === 1 && /e$/i.test(words[0])) {
      return declinePluralAdjWord(words[0]);
    }
    return trimmed;
  }

  if (kind === 'plac') {
    if (words.length === 1) {
      return declineMasculineAdjWord(words[0]);
    }
    if (
      words.length === 2 &&
      /^(?:centralny|bankowy|teatralny|grunwaldzki|dominikański|wielkopolski|bernardyński|nowy|stary|mały|wielki)$/i.test(
        words[0],
      )
    ) {
      return `${declineMasculineAdjWord(words[0])} ${words[1]}`;
    }
    return trimmed;
  }

  if (kind === 'rondo') {
    if (words.length === 1 && /e$/i.test(words[0])) {
      return declineNeuterAdjWord(words[0]);
    }
    return trimmed;
  }

  if (kind === 'most') {
    if (words.length === 1 && /[iy]$/i.test(words[0])) {
      return declineMasculineAdjWord(words[0]);
    }
    return trimmed;
  }

  // Standardowa ulica / aleja (rodzaj żeński)
  if (words.length === 1) {
    if (words[0].includes('-')) {
      const parts = words[0].split('-');
      if (parts.length === 2 && parts.every((p) => /a$/i.test(p) && !KEEP_UNCHANGED_STREET_WORDS.has(p.toLowerCase()))) {
        const declinedParts = parts.map((p) => declineFeminineAdjWord(p));
        if (declinedParts.every((dp, idx) => dp !== parts[idx])) {
          return declinedParts.join('-');
        }
      }
      return trimmed;
    }
    if (/a$/i.test(words[0])) {
      return declineFeminineAdjWord(words[0]);
    }
    return trimmed;
  }

  // 2-słowowa ulica: odmieniaj TYLKO gdy oba słowa są przymiotnikami (chroni "Górna Wilda" / "Wielka Skotnica")
  if (words.length === 2) {
    const [w1, w2] = words;
    if (
      /^(?:stara|nowa|mała|wielka|górna|dolna|wschodnia|zachodnia|północna|południowa|biała|czarna|zielona|czerwona|cicha|krótka|długa|szeroka|wysoka|niska|polska|warszawska|krakowska|poznańska|wrocławska|śląska)$/i.test(
        w1,
      ) &&
      /a$/i.test(w2)
    ) {
      const dw2 = declineFeminineAdjWord(w2);
      if (dw2 !== w2) {
        return `${declineFeminineAdjWord(w1)} ${dw2}`;
      }
    }
  }

  return trimmed;
}

/**
 * Formatuje nazwę ulicy/placu/alei/ronda/mostu do poprawnego zwrotu w miejscowniku.
 */
export function formatStreetLocative(rawStreet) {
  if (!rawStreet) return null;
  const s = String(rawStreet)
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || s.length < 3 || s.length > 44) return null;
  if (GARBAGE_STREET_RE.test(s)) return null;
  if (/\d{3,}|bez nazwy|wzdłuż|nasypu|torowisk|wewnętrzn|technicz|dojazdow/i.test(s)) return null;

  const lower = s.toLowerCase();
  if (lower === 'nowy świat' || lower === 'ul. nowy świat') return 'na Nowym Świecie';
  if (lower === 'krakowskie przedmieście' || lower === 'ul. krakowskie przedmieście') {
    return 'na Krakowskim Przedmieściu';
  }
  if (lower === 'rynek' || lower === 'rynek główny') return 'przy Rynku';
  if (/^rynek\s+(?:wschodni|zachodni|północny|południowy|jeżycki|łazarski|wildecki|dębnicki|podgórski|kleparski)/i.test(s)) {
    const rest = s.replace(/^rynek\s+/i, '');
    return `przy Rynku ${declineMasculineAdjWord(rest)}`;
  }
  if (/^trakt\s+/i.test(s)) {
    const decl = declineStreetCore(s, 'ulica');
    return decl !== s ? `na ${decl}` : `przy ${s}`;
  }
  if (/^wał\s+/i.test(s)) {
    const decl = declineStreetCore(s, 'ulica');
    return decl !== s ? `na ${decl}` : `przy ${s}`;
  }
  if (/^wybrzeże\s+/i.test(s)) {
    const decl = declineStreetCore(s, 'ulica');
    return decl !== s ? `na ${decl}` : `przy ${s}`;
  }
  if (/^podwale\b/i.test(s)) {
    const decl = declineStreetCore(s, 'ulica');
    return `na ${decl}`;
  }

  const alejePl = s.match(
    /^(?:aleje|al\.)\s+(jerozolimskie|ujazdowskie|marcinkowskiego|trzech\s+wieszczów|racławickie|karola\s+marcinkowskiego)$/i,
  );
  if (alejePl) {
    return `w Al. ${declineStreetCore(alejePl[1], 'aleje_pl')}`;
  }

  const aleja = s.match(/^(?:aleja|al\.)\s+(.+)$/i);
  if (aleja) {
    const core = aleja[1].trim();
    if (/^(?:jerozolimskie|ujazdowskie)$/i.test(core)) {
      return `w Al. ${declineStreetCore(core, 'aleje_pl')}`;
    }
    const cleanCore = core.replace(/^["„](.+)["”]$/, '„$1”');
    return `przy al. ${declineStreetCore(cleanCore, 'ulica')}`;
  }

  const plac = s.match(/^(?:plac|pl\.)\s+(.+)$/i);
  if (plac) {
    const core = plac[1].trim();
    if (/^na\s+/i.test(core)) return `przy pl. ${core}`;
    return `na pl. ${declineStreetCore(core, 'plac')}`;
  }

  const rondo = s.match(/^rondo\s+(.+)$/i);
  if (rondo) {
    return `przy rondzie ${declineStreetCore(rondo[1].trim(), 'rondo')}`;
  }

  const most = s.match(/^most\s+(.+)$/i);
  if (most) {
    return `na moście ${declineStreetCore(most[1].trim(), 'most')}`;
  }

  const pasaz = s.match(/^pasaż\s+(.+)$/i);
  if (pasaz) {
    return `przy pasażu ${pasaz[1].trim()}`;
  }

  const bulwar = s.match(/^bulwar\s+(.+)$/i);
  if (bulwar) {
    return `na bulwarze ${bulwar[1].trim()}`;
  }

  const skwer = s.match(/^skwer\s+(.+)$/i);
  if (skwer) {
    return `przy skwerze ${skwer[1].trim()}`;
  }

  const os = s.match(/^(?:osiedle|os\.)\s+(.+)$/i);
  if (os) {
    return `na os. ${os[1].trim()}`;
  }

  const core = s.replace(/^(?:ulica|ul\.)\s+/i, '').trim();
  if (!core || GARBAGE_STREET_RE.test(core)) return null;
  if (/^al\.\s/i.test(core)) return formatStreetLocative(core);

  const declined = declineStreetCore(core, 'ulica');
  return `na ul. ${declined}`;
}

/** Mapa ogólnopolskich marek/sieci z poprawną formą w dopełniaczu. */
const CHAIN_GENITIVE_RULES = [
  [/^żabka(?:\s+(?:nano|caf[eé]))?$/i, 'Żabki', 3],
  [/^biedronka$/i, 'Biedronki', 2],
  [/^lidl$/i, 'Lidla', 2],
  [/^kaufland$/i, 'Kauflandu', 2],
  [/^auchan(?:\s+(?:supermarket|direct))?$/i, 'sklepu Auchan', 2],
  [/^carrefour(?:\s+(?:express|market))?$/i, 'sklepu Carrefour', 2],
  [/^aldi$/i, 'sklepu Aldi', 2],
  [/^netto$/i, 'sklepu Netto', 2],
  [/^dino$/i, 'sklepu Dino', 2],
  [/^stokrotka(?:\s+express)?$/i, 'Stokrotki', 2],
  [/^lewiatan$/i, 'Lewiatana', 2],
  [/^polomarket$/i, 'Polomarketu', 2],
  [/^intermarch[eé]$/i, 'Intermarché', 2],
  [/^e\.?\s*leclerc$/i, 'E.Leclerc', 2],
  [/^delikatesy\s+centrum$/i, 'Delikatesów Centrum', 2],
  [/^rossmann$/i, 'Rossmanna', 2],
  [/^hebe$/i, 'drogerii Hebe', 2],
  [/^empik$/i, 'Empiku', 2],
  [/^decathlon$/i, 'Decathlonu', 2],
  [/^ikea$/i, 'sklepu IKEA', 1],
  [/^castorama$/i, 'Castoramy', 1],
  [/^leroy\s+merlin$/i, 'Leroy Merlin', 1],
  [/^obi$/i, 'marketu OBI', 1],
  [/^bricomarch[eé]$/i, 'Bricomarché', 2],
  [/^media\s*markt$/i, 'Media Markt', 2],
  [/^media\s*expert$/i, 'Media Expert', 2],
  [/^rtv\s+euro\s+agd$/i, 'RTV Euro AGD', 2],
  [/^pepco$/i, 'sklepu Pepco', 2],
  [/^action$/i, 'sklepu Action', 2],
  [/^jysk$/i, 'sklepu JYSK', 2],
  [/^smyk$/i, 'sklepu Smyk', 2],
  [/^orlen$|^pkn\s+orlen$/i, 'stacji Orlen', 2],
  [/^bp$/i, 'stacji BP', 2],
  [/^shell$/i, 'stacji Shell', 2],
  [/^circle\s*k$/i, 'stacji Circle K', 2],
  [/^moya$/i, 'stacji Moya', 2],
  [/^amic(?:\s+energy)?$/i, 'stacji Amic', 2],
  [/^mol$/i, 'stacji MOL', 2],
  [/^lotos$/i, 'stacji Lotos', 2],
  [/^avia$/i, 'stacji Avia', 2],
  [/^mcdonald['’]?s$/i, "McDonald'sa", 2],
  [/^kfc$/i, 'KFC', 2],
  [/^burger\s+king$/i, 'Burger Kinga', 2],
  [/^max\s+(?:premium\s+)?burgers$/i, 'Max Burgers', 2],
  [/^pizza\s+hut$/i, 'Pizza Hut', 2],
  [/^starbucks(?:\s+coffee)?$/i, 'kawiarni Starbucks', 2],
  [/^costa(?:\s+coffee)?$/i, 'kawiarni Costa Coffee', 2],
  [/^green\s+caff[eè]\s+nero$/i, 'kawiarni Green Caffè Nero', 2],
  [/^poczta\s+polska$/i, 'Poczty Polskiej', 2],
];

const MAJOR_BANKS_RE =
  /^(?:PKO(?:\s+BP|\s+Bank\s+Polski)?|Bank\s+Pekao(?:\s+S\.?A\.?)?|Pekao(?:\s+S\.?A\.?)?|mBank|ING(?:\s+Bank\s+Śląski)?|Santander(?:\s+Bank\s+Polska|\s+Consumer\s+Bank)?|Bank\s+Millennium|Millennium(?:\s+Bank)?|Alior\s+Bank|BNP\s+Paribas(?:\s+Polska)?|Cr[eé]dit\s+Agricole|VeloBank|Citi\s+Handlowy)$/i;

const REGIONAL_BAKERIES_RE =
  /^(?:Putka|Galeria\s+Wypieków\s+Lubaszka|Lubaszka|Grzybki|Oskroba|SPC|Hert|Buczek|Awiteks|Lajkonik|Kłos|Fawor|Natura|Gromulski|Gromulska|Piekarnia\s+Szwajcarska|Vincent)$/i;

const BANNED_POI_NAME_RE =
  /(?:\?|budynek\s*\d|nr\s*\d|bohema\d|wx\d{2,}|spółdzielnia\s+mieszkaniowa|zakład\s+gospodarowania|zarząd\s+dróg|zarząd\s+nieruchomości|stacja\s+kontroli|myjnia|pralnia|ksero|pogrzeb|blachar|lakierni|wulkanizac|lombard|kantor|bukmacher|^sts$|^fortuna$|monopol|alkohol|vape|e-?papieros|fryzjer|barber|paznokci|urody|kosmetycz|stomatolog|dentyst|pracownia\s+usg|gabinet|notariusz|adwokat|radca|komornik|ubezpiecz|nieruchomoś|kredyt|chwilówk|epaka|inpost|paczkomat|dpd\s+pickup|orlen\s+paczka|punkt\s+obsługi|punkt\s+ksero|warsztat|auto[-\s]?serwis|mechanik|części\s+samochod|komis|wypożyczalnia|skup\s+złomu|park\s+kieszonkowy|kieszonkowy|plac\s+zabaw|śniadania,\s*obiady|pizza\s+na\s+kawałki|^sklep$|^apteka$|^restauracja$|^bar$|^kawiarnia$|^piekarnia$|^cukiernia$|^bank$|^bankomat$|^atm$|^przychodnia$|^szpital$|^szkoła$|^kościół$|^hotel$|^park$|^skwer$|^ogród$|^dworzec$|^stacja$|^centrum$|^biuro$|^budynek$|^salon$|^sklep\s+spożywcz|mini\s*market)/i;

function cleanPoiDisplayName(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/[„”"«»]/g, '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+[–—-]\s+(?:scena|oddział|filia|punkt|budynek)\b.*$/i, '')
    .trim();
}

function stripLeadingCategory(name, re) {
  return name.replace(re, '').trim();
}

function capitalizeFirst(s) {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

/**
 * Klasyfikuje element OSM i zwraca ustrukturyzowany kandydat na punkt orientacyjny albo `null`.
 */
export function classifyOsmLandmark(el) {
  const t = el?.tags || {};
  const rawName = (t.name || t.brand || '').trim();

  // 1. Wejście do metra
  if (t.railway === 'subway_entrance') {
    const clean = cleanPoiDisplayName(rawName)
      .replace(/^metro\s+/i, '')
      .replace(/\s*[-–]\s*wejście.*$/i, '')
      .trim();
    const labelGen = clean && clean.length <= 28 ? `wejścia do metra ${clean}` : 'wejścia do metra';
    const labelLoc = clean && clean.length <= 28 ? `wejściu do metra ${clean}` : 'wejściu do metra';
    return {
      tier: 1,
      maxDist: 55,
      canBeOpposite: false,
      nearPhrase: `przy ${labelLoc}`,
      oppositePhrase: `naprzeciwko ${labelGen}`,
      key: `metro:${clean || 'entrance'}`,
    };
  }

  if (!rawName) return null;
  const name = cleanPoiDisplayName(rawName);
  if (!name || name.length < 2 || name.length > 42) return null;
  if (/^\d+[\d\s.-]*$/.test(name)) return null;
  if (BANNED_POI_NAME_RE.test(name)) return null;

  // 2. Ogólnopolskie sieci (z poprawną polską odmianą)
  const brandCandidate = cleanPoiDisplayName(t.brand || name);
  for (const [re, genitive, tier] of CHAIN_GENITIVE_RULES) {
    if (re.test(name) || re.test(brandCandidate)) {
      const isFuelOrBig =
        tier <= 2 &&
        !/^Żabki$/.test(genitive) &&
        !/^kawiarni\s/.test(genitive) &&
        !/^drogerii\s/.test(genitive);
      return {
        tier,
        maxDist: tier === 1 ? 65 : tier === 2 ? 38 : 22,
        canBeOpposite: isFuelOrBig,
        nearPhrase: `obok ${genitive}`,
        oppositePhrase: `naprzeciwko ${genitive}`,
        key: `chain:${genitive.toLowerCase()}`,
      };
    }
  }

  // 3. Stacje kolejowe
  if (t.railway === 'station' || t.railway === 'halt') {
    if (t.station === 'subway') {
      const clean = stripLeadingCategory(name, /^metro\s+/i);
      if (!clean) return null;
      return {
        tier: 1,
        maxDist: 65,
        canBeOpposite: true,
        nearPhrase: `przy stacji metra ${clean}`,
        oppositePhrase: `przy stacji metra ${clean}`,
        key: `subway:${clean.toLowerCase()}`,
      };
    }
    const clean = stripLeadingCategory(
      name,
      /^(?:dworzec\s+(?:pkp|kolejowy)|stacja\s+(?:pkp|kolejowa)|pkp)\s+/i,
    );
    if (!clean || clean.length > 34) return null;
    return {
      tier: 1,
      maxDist: 70,
      canBeOpposite: true,
      nearPhrase: `obok stacji kolejowej „${clean}”`,
      oppositePhrase: `naprzeciwko stacji kolejowej „${clean}”`,
      key: `rail:${clean.toLowerCase()}`,
    };
  }

  // 4. Galerie handlowe / domy towarowe
  if (t.shop === 'mall' || t.shop === 'department_store') {
    const clean = stripLeadingCategory(
      name,
      /^(?:centrum\s+handlowe|ch|galeria\s+handlowa|galeria|dom\s+handlowy|dh)\s+/i,
    );
    if (!clean || clean.length < 3 || clean.length > 34) return null;
    const isGaleria = /^galeria\b/i.test(name);
    const display = isGaleria ? `galerii „${clean}”` : `centrum handlowego „${clean}”`;
    return {
      tier: 1,
      maxDist: 70,
      canBeOpposite: true,
      nearPhrase: isGaleria ? `przy ${display}` : `obok ${display}`,
      oppositePhrase: `naprzeciwko ${display}`,
      key: `mall:${clean.toLowerCase()}`,
    };
  }

  // 5. Prawdziwe parki i ogrody (WYŁĄCZNIE leisure=park|garden)
  if (t.leisure === 'park' || t.leisure === 'garden') {
    if (/(?:kieszonkowy|business|office|capital|city\s+park|villa\s+park|tech|science|logisty|przemysł|plac\s+zabaw|^plac\s)/i.test(name)) {
      return null;
    }
    if (/^skwer\b/i.test(name)) {
      const clean = stripLeadingCategory(name, /^skwer\s+(?:im\.?\s*)?/i);
      if (!clean || clean.length > 32) return null;
      if (/^(?:na|nad|w|przy)\s+/i.test(clean)) {
        return {
          tier: 1,
          maxDist: 55,
          canBeOpposite: true,
          nearPhrase: `przy skwerze ${clean}`,
          oppositePhrase: `naprzeciwko skweru ${clean}`,
          key: `skwer:${clean.toLowerCase()}`,
        };
      }
      return {
        tier: 1,
        maxDist: 60,
        canBeOpposite: true,
        nearPhrase: `przy skwerze „${clean}”`,
        oppositePhrase: `naprzeciwko skweru „${clean}”`,
        key: `skwer:${clean.toLowerCase()}`,
      };
    }
    if (/^ogród\b/i.test(name)) {
      const clean = stripLeadingCategory(name, /^ogród\s+/i);
      if (!clean || clean.length > 32 || /^(?:na|nad|w|przy|społeczny|sąsiedzki)\b/i.test(clean)) {
        return null;
      }
      return {
        tier: 1,
        maxDist: 65,
        canBeOpposite: true,
        nearPhrase: `przy ogrodzie „${clean}”`,
        oppositePhrase: `naprzeciwko ogrodu „${clean}”`,
        key: `garden:${clean.toLowerCase()}`,
      };
    }
    const clean = stripLeadingCategory(name, /^park\s+(?:im\.?\s*)?/i);
    if (!clean || clean.length > 32) return null;
    if (/^(?:w|na|nad|przy|linearny|miejski|osiedlowy)\b/i.test(clean)) {
      return {
        tier: 1,
        maxDist: 60,
        canBeOpposite: true,
        nearPhrase: 'po stronie parku',
        oppositePhrase: 'naprzeciwko parku',
        key: `park:${el.id}`,
      };
    }
    return {
      tier: 1,
      maxDist: 65,
      canBeOpposite: true,
      nearPhrase: `po stronie parku „${clean}”`,
      oppositePhrase: `naprzeciwko parku „${clean}”`,
      key: `park:${clean.toLowerCase()}`,
    };
  }

  // 6. Stadiony
  if (t.leisure === 'stadium') {
    if (name.length > 34) return null;
    const clean = stripLeadingCategory(name, /^stadion\s+(?:im\.?\s*)?/i);
    return {
      tier: 1,
      maxDist: 75,
      canBeOpposite: true,
      nearPhrase: `przy stadionie „${clean || name}”`,
      oppositePhrase: `naprzeciwko stadionu „${clean || name}”`,
      key: `stadium:${(clean || name).toLowerCase()}`,
    };
  }

  // 7. Szpitale
  if (t.amenity === 'hospital') {
    if (/gabinet|pracownia|przychodnia|centrum\s+medyczne|lux\s*med|medicover|enel/i.test(name)) {
      return null;
    }
    const clean = stripLeadingCategory(name, /^szpital\s+(?:im\.?\s*)?/i);
    if (!clean || clean.length > 34) return null;
    return {
      tier: 1,
      maxDist: 65,
      canBeOpposite: true,
      nearPhrase: `przy szpitalu „${clean}”`,
      oppositePhrase: `naprzeciwko szpitala „${clean}”`,
      key: `hospital:${clean.toLowerCase()}`,
    };
  }

  // 8. Teatry, kina, muzea
  if (t.amenity === 'theatre') {
    const clean = stripLeadingCategory(name, /^teatr\s+(?:im\.?\s*)?/i);
    if (!clean || clean.length < 3 || clean.length > 30) return null;
    return {
      tier: 1,
      maxDist: 60,
      canBeOpposite: true,
      nearPhrase: `przed teatrem „${clean}”`,
      oppositePhrase: `naprzeciwko teatru „${clean}”`,
      key: `theatre:${clean.toLowerCase()}`,
    };
  }

  if (t.amenity === 'cinema') {
    if (/dla\s+dzieci|studyjn|za\s+rogiem/i.test(name)) return null;
    const clean = stripLeadingCategory(name, /^kino\s+/i);
    if (!clean || clean.length < 3 || clean.length > 30) return null;
    return {
      tier: 1,
      maxDist: 60,
      canBeOpposite: true,
      nearPhrase: `obok kina „${clean}”`,
      oppositePhrase: `naprzeciwko kina „${clean}”`,
      key: `cinema:${clean.toLowerCase()}`,
    };
  }

  if (t.tourism === 'museum') {
    if (/^muzeum\s+/i.test(name) && name.length <= 38) {
      return {
        tier: 1,
        maxDist: 60,
        canBeOpposite: true,
        nearPhrase: `obok ${name}`,
        oppositePhrase: `naprzeciwko ${name}`,
        key: `museum:${name.toLowerCase()}`,
      };
    }
    if (name.length > 32) return null;
    return {
      tier: 1,
      maxDist: 60,
      canBeOpposite: true,
      nearPhrase: `obok muzeum „${name}”`,
      oppositePhrase: `naprzeciwko muzeum „${name}”`,
      key: `museum:${name.toLowerCase()}`,
    };
  }

  // 9. Uczelnie wyższe
  if (t.amenity === 'university' || t.amenity === 'college') {
    if (name.length > 36) return null;
    return {
      tier: 1,
      maxDist: 65,
      canBeOpposite: true,
      nearPhrase: `przy budynku „${name}”`,
      oppositePhrase: `naprzeciwko „${name}”`,
      key: `uni:${name.toLowerCase()}`,
    };
  }

  // 10. Kościoły i bazyliki
  if (t.amenity === 'place_of_worship') {
    const isVisibleChurch =
      t.religion === 'christian' ||
      /^(?:kościół|bazylika|katedra|archikatedra|sanktuarium|cerkiew)\b/i.test(name);
    if (!isVisibleChurch) return null;
    if (/domowy|ośrodek|sala\s+królestwa|zbór/i.test(name)) return null;

    const cleanedChurch = name
      .replace(/^(?:rzymskokatolicka\s+)?parafia\s+(?:pw\.?\s*)?/i, '')
      .replace(/^(?:kościół|bazylika|katedra|archikatedra|kaplica|sanktuarium)\s+(?:parafialny\s+)?(?:pw\.?\s*)?/i, '')
      .trim();

    if (
      !cleanedChurch ||
      cleanedChurch.length < 4 ||
      cleanedChurch.length > 28 ||
      /^(?:ewangelick|katolick|parafialn|rzymskokatolick|domow)/i.test(cleanedChurch)
    ) {
      return {
        tier: 1,
        maxDist: 55,
        canBeOpposite: true,
        nearPhrase: 'przy kościele',
        oppositePhrase: 'naprzeciwko kościoła',
        key: `church:${el.id}`,
      };
    }
    return {
      tier: 1,
      maxDist: 55,
      canBeOpposite: true,
      nearPhrase: `przy kościele ${cleanedChurch}`,
      oppositePhrase: `naprzeciwko kościoła ${cleanedChurch}`,
      key: `church:${cleanedChurch.toLowerCase()}`,
    };
  }

  // 11. Hotele
  if (t.tourism === 'hotel') {
    const clean = stripLeadingCategory(name, /^(?:hotel|aparthotel)\s+/i);
    if (!clean || clean.length < 3 || clean.length > 26) return null;
    return {
      tier: 1,
      maxDist: 50,
      canBeOpposite: true,
      nearPhrase: `przed hotelem „${clean}”`,
      oppositePhrase: `naprzeciwko hotelu „${clean}”`,
      key: `hotel:${clean.toLowerCase()}`,
    };
  }

  // 12. Urzędy miasta/dzielnicy i targowiska
  if (t.amenity === 'townhall') {
    if (/^ratusz\b/i.test(name)) {
      return {
        tier: 1,
        maxDist: 60,
        canBeOpposite: true,
        nearPhrase: 'przed ratuszem',
        oppositePhrase: 'naprzeciwko ratusza',
        key: `townhall:${el.id}`,
      };
    }
    if (/^urząd\s+(?:miasta|miejski|gminy|dzielnicy)/i.test(name)) {
      const label = /dzielnicy/i.test(name) ? 'urzędem dzielnicy' : 'urzędem miasta';
      const oppLabel = /dzielnicy/i.test(name) ? 'urzędu dzielnicy' : 'urzędu miasta';
      return {
        tier: 1,
        maxDist: 60,
        canBeOpposite: true,
        nearPhrase: `przed ${label}`,
        oppositePhrase: `naprzeciwko ${oppLabel}`,
        key: `townhall:${el.id}`,
      };
    }
    return null;
  }

  if (t.amenity === 'marketplace') {
    if (/^hala\s+targowa$/i.test(name)) {
      return {
        tier: 1,
        maxDist: 55,
        canBeOpposite: true,
        nearPhrase: 'przy Hali Targowej',
        oppositePhrase: 'naprzeciwko Hali Targowej',
        key: `market:hala-targowa`,
      };
    }
    const clean = stripLeadingCategory(
      name,
      /^(?:targowisko|bazarek|bazar|hala\s+targowa|plac\s+targowy|plac\s+handlowy)\s+/i,
    );
    if (
      !clean ||
      clean.length < 3 ||
      clean.length > 26 ||
      /^(?:miejskie|gminne|osiedlowe|dzielnicowe|główne|stare|nowe)$/i.test(clean)
    ) {
      return {
        tier: 1,
        maxDist: 55,
        canBeOpposite: true,
        nearPhrase: 'przy targowisku',
        oppositePhrase: 'naprzeciwko targowiska',
        key: `market:${el.id}`,
      };
    }
    const nice = capitalizeFirst(clean);
    return {
      tier: 1,
      maxDist: 55,
      canBeOpposite: true,
      nearPhrase: `przy targowisku „${nice}”`,
      oppositePhrase: `naprzeciwko targowiska „${nice}”`,
      key: `market:${nice.toLowerCase()}`,
    };
  }

  // 13. Szkoły i biblioteki
  if (t.amenity === 'school') {
    if (/szkoła\s+jazdy|nauka\s+jazdy|język|tańca|muzyczn|balet/i.test(name)) return null;
    if (/^(?:szkoła\s+podstawowa|sp\s+nr)/i.test(name)) {
      return {
        tier: 2,
        maxDist: 42,
        canBeOpposite: true,
        nearPhrase: 'przy szkole podstawowej',
        oppositePhrase: 'naprzeciwko szkoły podstawowej',
        key: `school:${el.id}`,
      };
    }
    if (/liceum|technikum|zespół\s+szkół/i.test(name)) {
      return {
        tier: 2,
        maxDist: 42,
        canBeOpposite: true,
        nearPhrase: 'przy szkole średniej',
        oppositePhrase: 'naprzeciwko szkoły średniej',
        key: `school:${el.id}`,
      };
    }
    return null;
  }

  if (t.amenity === 'library') {
    if (name.length > 30) return null;
    return {
      tier: 2,
      maxDist: 35,
      canBeOpposite: false,
      nearPhrase: 'przy bibliotece',
      oppositePhrase: 'naprzeciwko biblioteki',
      key: `library:${el.id}`,
    };
  }

  // 14. Poczta Polska
  if (t.amenity === 'post_office') {
    if (!/poczta/i.test(name)) return null;
    return {
      tier: 2,
      maxDist: 32,
      canBeOpposite: false,
      nearPhrase: 'obok poczty',
      oppositePhrase: 'naprzeciwko poczty',
      key: `post:${el.id}`,
    };
  }

  // 15. Duże banki
  if (t.amenity === 'bank' && MAJOR_BANKS_RE.test(name)) {
    const cleanBank = name
      .replace(/^bank\s+/i, '')
      .replace(/\s+(?:bank(?:\s+polski|\s+śląski)?|consumer\s+bank|s\.?a\.?|polska)$/i, '')
      .trim();
    if (!cleanBank) return null;
    return {
      tier: 2,
      maxDist: 28,
      canBeOpposite: false,
      nearPhrase: `obok oddziału banku ${cleanBank}`,
      oppositePhrase: `naprzeciwko banku ${cleanBank}`,
      key: `bank:${cleanBank.toLowerCase()}`,
    };
  }

  // 16. Stacje paliw innych sieci
  if (t.amenity === 'fuel') {
    const clean = stripLeadingCategory(name, /^stacja\s+(?:paliw|benzynowa)\s+/i);
    if (!clean || clean.length > 24) return null;
    return {
      tier: 2,
      maxDist: 42,
      canBeOpposite: true,
      nearPhrase: `obok stacji paliw „${clean}”`,
      oppositePhrase: `naprzeciwko stacji paliw „${clean}”`,
      key: `fuel:${clean.toLowerCase()}`,
    };
  }

  // 17. Supermarkety spoza głównej listy
  if (t.shop === 'supermarket') {
    const clean = stripLeadingCategory(name, /^(?:supermarket|market|sklep\s+spożywczy)\s+/i);
    if (!clean || clean.length < 3 || clean.length > 26) return null;
    return {
      tier: 2,
      maxDist: 34,
      canBeOpposite: true,
      nearPhrase: `obok supermarketu „${clean}”`,
      oppositePhrase: `naprzeciwko supermarketu „${clean}”`,
      key: `supermarket:${clean.toLowerCase()}`,
    };
  }

  // 18. Apteki
  if (t.amenity === 'pharmacy') {
    const clean = stripLeadingCategory(name, /^apteka\s+/i)
      .replace(/\s+apteka$/i, '')
      .trim();
    if (!clean || clean.length < 2 || clean.length > 24 || /^apteka$/i.test(clean)) {
      return {
        tier: 3,
        maxDist: 24,
        canBeOpposite: false,
        nearPhrase: 'obok apteki',
        oppositePhrase: 'naprzeciwko apteki',
        key: `pharmacy:${el.id}`,
      };
    }
    return {
      tier: 3,
      maxDist: 24,
      canBeOpposite: false,
      nearPhrase: `obok apteki „${clean}”`,
      oppositePhrase: `naprzeciwko apteki „${clean}”`,
      key: `pharmacy:${clean.toLowerCase()}`,
    };
  }

  // 19. Znane sieciowe piekarnie regionalne
  if (t.shop === 'bakery' && REGIONAL_BAKERIES_RE.test(name)) {
    const clean = stripLeadingCategory(name, /^(?:piekarnia|cukiernia|galeria\s+wypieków)\s+/i);
    return {
      tier: 3,
      maxDist: 24,
      canBeOpposite: false,
      nearPhrase: `obok piekarni „${clean || name}”`,
      oppositePhrase: `naprzeciwko piekarni „${clean || name}”`,
      key: `bakery:${(clean || name).toLowerCase()}`,
    };
  }

  // 20. Zwykłe piekarnie / kawiarnie / restauracje (<= 20m, ta sama strona)
  if (t.shop === 'bakery') {
    const clean = stripLeadingCategory(name, /^(?:piekarnia|cukiernia)(?:\s+cukiernia)?\s+/i);
    if (!clean || clean.length < 3 || clean.length > 22) return null;
    return {
      tier: 3,
      maxDist: 20,
      canBeOpposite: false,
      nearPhrase: `obok piekarni „${clean}”`,
      oppositePhrase: `naprzeciwko piekarni „${clean}”`,
      key: `bakery:${clean.toLowerCase()}`,
    };
  }

  if (t.amenity === 'cafe') {
    const clean = stripLeadingCategory(name, /^(?:kawiarnia|caf[eé])\s+/i);
    if (!clean || clean.length < 3 || clean.length > 22) return null;
    return {
      tier: 3,
      maxDist: 20,
      canBeOpposite: false,
      nearPhrase: `obok kawiarni „${clean}”`,
      oppositePhrase: `naprzeciwko kawiarni „${clean}”`,
      key: `cafe:${clean.toLowerCase()}`,
    };
  }

  if (t.amenity === 'restaurant') {
    const clean = stripLeadingCategory(name, /^(?:restauracja|bistro|pizzeria|karczma|bar)\s+/i);
    if (!clean || clean.length < 3 || clean.length > 22) return null;
    const isPizza = /pizzeria|pizza/i.test(name) || /pizza/i.test(t.cuisine || '');
    const cat = isPizza ? 'pizzerii' : 'restauracji';
    return {
      tier: 3,
      maxDist: 20,
      canBeOpposite: false,
      nearPhrase: `obok ${cat} „${clean}”`,
      oppositePhrase: `naprzeciwko ${cat} „${clean}”`,
      key: `rest:${clean.toLowerCase()}`,
    };
  }

  return null;
}
