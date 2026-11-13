import * as fflate from 'fflate';

export interface ParsedTicketMetadata {
  trainNumber?: string;
  wagon?: string;
  seat?: string;
  seatType?: string;
  passenger?: string;
  tariff?: string;
  ticketNumber?: string;
  fromStation?: string;
  toStation?: string;
  departDate?: string;
  departTime?: string;
  arriveTime?: string;
}

export interface ExtractedBarcode {
  bytes: Uint8Array;
  extension: 'png' | 'jpg';
  width: number;
  height: number;
  /** True gdy matryca przeszła filtr mono (Flate) albo JPEG DeviceGray. */
  monochromeVerified?: boolean;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

/**
 * Bezpieczny i ultra-szybki dekoder Base64 do Uint8Array zoptymalizowany pod silnik Hermes.
 * Nie korzysta z atob() ani wielkich alokacji stringów.
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  const clean = b64.replace(/[\r\n\s]/g, '');
  let pad = 0;
  if (clean.endsWith('==')) pad = 2;
  else if (clean.endsWith('=')) pad = 1;
  const len = clean.length;
  const outLen = Math.max(0, Math.floor((len * 3) / 4) - pad);
  const out = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = B64_LOOKUP[clean.charCodeAt(i)];
    const c1 = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c2 = B64_LOOKUP[clean.charCodeAt(i + 2)];
    const c3 = B64_LOOKUP[clean.charCodeAt(i + 3)];
    if (p < outLen) out[p++] = (c0 << 2) | (c1 >> 4);
    if (p < outLen) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (p < outLen) out[p++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}

/**
 * Bezpieczny i ultra-szybki koder Uint8Array do Base64 bez btoa() i bez przekraczania stosu.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  let out = '';
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < len ? B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < len ? B64_CHARS[b2 & 63] : '=';
  }
  return out;
}

/**
 * Wyciąga czytelny tekst ze strumieni obiektów PDF.
 * Obsługuje strumienie kompresowane FlateDecode (zlib i raw deflate),
 * tabele mapowania znaków CMap (/ToUnicode) oraz zapis tekstowy w nawiasach i hex.
 *
 * CMap-y są mapowane per czcionka (operator Tf): bilety PKP IC używają kilku
 * subset fontów, gdzie te same ID glyphów oznaczają różne znaki. Scalona mapa
 * (fallback) produkuje wtedy "Wagoł" zamiast "Wagon".
 */
export function extractTextFromPdf(pdfBytes: Uint8Array): string {
  const textChunks: string[] = [];
  const latin1Str = uint8ArrayToLatin1(pdfBytes);
  const objectIndex = buildObjectIndex(latin1Str);

  // contentStreamId -> fontName -> CMap tej czcionki
  const fontCMapsByContent = buildContentFontCMaps(pdfBytes, latin1Str, objectIndex);

  // Fallback: mapa scalona ze wszystkich CMap w dokumencie
  const glyphMap = buildCMap(pdfBytes, latin1Str);

  // Wyszukiwanie obiektów: obj ... stream ... endstream
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(latin1Str)) !== null) {
    const streamContent = match[1];
    const streamStart = match.index;
    const dictHeader = latin1Str.slice(Math.max(0, streamStart - 800), streamStart);

    // Pomiń strumienie będące obrazami oraz plikami fontów (FontFile/Length1):
    // binarne tabele outline to śmieci, z których regexy wyciągają fałszywe dane.
    if (dictHeader.includes('/Image')) {
      continue;
    }
    if (/\/(FontFile[123]?|Length[123])\b/.test(dictHeader)) {
      continue;
    }

    const isFlate = dictHeader.includes('/FlateDecode');

    let streamBytes: Uint8Array;
    if (isFlate) {
      try {
        const offset = streamStart + match[0].indexOf(streamContent);
        const rawSlice = pdfBytes.subarray(offset, offset + streamContent.length);
        try {
          streamBytes = fflate.unzlibSync(rawSlice);
        } catch {
          streamBytes = fflate.inflateSync(rawSlice);
        }
      } catch {
        streamBytes = latin1ToUint8Array(streamContent);
      }
    } else {
      streamBytes = latin1ToUint8Array(streamContent);
    }

    const decodedStreamText = uint8ArrayToLatin1(streamBytes);
    const ownerObjId = findOwningObjectId(objectIndex, streamStart);
    const fontCMaps = ownerObjId !== null ? fontCMapsByContent.get(ownerObjId) : undefined;
    extractStringsFromStream(decodedStreamText, textChunks, glyphMap, fontCMaps);
  }

  if (textChunks.length === 0) {
    extractStringsFromStream(latin1Str, textChunks, glyphMap, null);
  }

  return textChunks.join(' ');
}

/** Id obiektu, w którym leży dany offset strumienia. */
function findOwningObjectId(
  objectIndex: Map<number, { start: number; end: number }>,
  streamStart: number,
): number | null {
  // Map zachowuje kolejność wstawiania, czyli kolejność w dokumencie.
  let bestId: number | null = null;
  let bestStart = -1;
  for (const [id, pos] of objectIndex) {
    if (pos.start > streamStart) break;
    if (pos.start > bestStart) {
      bestStart = pos.start;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Buduje mapę: id strumienia treści strony -> nazwa zasobu fontu (/F1) -> CMap.
 * Graf: Page -> Resources -> Font -> Type0 font -> ToUnicode (strumień CMap).
 */
function buildContentFontCMaps(
  pdfBytes: Uint8Array,
  latin1Str: string,
  objectIndex: Map<number, { start: number; end: number }>,
): Map<number, Map<string, Map<number, string>>> {
  const result = new Map<number, Map<string, Map<number, string>>>();
  const cmapCache = new Map<number, Map<number, string>>();

  const cmapForFont = (fontObjId: number): Map<number, string> | null => {
    if (cmapCache.has(fontObjId)) {
      return cmapCache.get(fontObjId)!;
    }
    let cmap: Map<number, string> | null = null;
    const fontText = getObjectText(latin1Str, objectIndex, fontObjId);
    const toUnicodeMatch = fontText?.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (toUnicodeMatch) {
      cmap = parseCMapObject(pdfBytes, latin1Str, objectIndex, parseInt(toUnicodeMatch[1], 10));
    }
    cmapCache.set(fontObjId, cmap ?? new Map());
    return cmap && cmap.size > 0 ? cmap : null;
  };

  // Strony: /Contents N 0 R + /Resources (ref lub inline)
  const pageRegex = /\/Type\s*\/Page\b[\s\S]*?\/Contents\s+\d+\s+0\s+R[\s\S]*?>>/g;
  let page: RegExpExecArray | null;
  while ((page = pageRegex.exec(latin1Str)) !== null) {
    const pageDict = page[0];
    const contentsRefs = [...pageDict.matchAll(/\/Contents\s+(\d+)\s+0\s+R/g)].map((m) =>
      parseInt(m[1], 10),
    );
    if (contentsRefs.length === 0) continue;

    // Parsuj pary /Nazwa N 0 R z dicta fontów
    const parseFontPairs = (fontDictText: string): Map<string, Map<number, string>> => {
      const fonts = new Map<string, Map<number, string>>();
      const pairRegex = /\/(\w+)\s+(\d+)\s+0\s+R/g;
      let pair: RegExpExecArray | null;
      while ((pair = pairRegex.exec(fontDictText)) !== null) {
        const cmap = cmapForFont(parseInt(pair[2], 10));
        if (cmap) fonts.set(pair[1], cmap);
      }
      return fonts;
    };

    const resourcesRef = pageDict.match(/\/Resources\s+(\d+)\s+0\s+R/);
    let fontDictText: string | null = null;
    if (resourcesRef) {
      const resourcesText = getObjectText(latin1Str, objectIndex, parseInt(resourcesRef[1], 10));
      const fontRef = resourcesText?.match(/\/Font\s+(\d+)\s+0\s+R/);
      if (fontRef) {
        fontDictText = getObjectText(latin1Str, objectIndex, parseInt(fontRef[1], 10));
      } else {
        const inlineFont = resourcesText?.match(/\/Font\s*<<([\s\S]*?)>>/);
        fontDictText = inlineFont ? inlineFont[1] : null;
      }
    } else {
      const inlineFont = pageDict.match(/\/Font\s*<<([\s\S]*?)>>/);
      fontDictText = inlineFont ? inlineFont[1] : null;
    }

    if (fontDictText) {
      const fonts = parseFontPairs(fontDictText);
      if (fonts.size > 0) {
        for (const contentsId of contentsRefs) {
          result.set(contentsId, fonts);
        }
      }
    }
  }

  return result;
}

/** Parsuje CMap z obiektu ToUnicode (strumień z beginbfchar/beginbfrange). */
function parseCMapObject(
  pdfBytes: Uint8Array,
  latin1Str: string,
  objectIndex: Map<number, { start: number; end: number }>,
  cmapObjId: number,
): Map<number, string> {
  const map = new Map<number, string>();
  const pos = objectIndex.get(cmapObjId);
  if (!pos) return map;
  const objRegion = latin1Str.slice(pos.start, pos.end);
  const streamMatch = objRegion.match(/stream[\r\n]+([\s\S]*?)[\r\n]+endstream/);
  if (!streamMatch) return map;
  const content = streamMatch[1];
  const offset = pos.start + objRegion.indexOf(content);
  const rawSlice = pdfBytes.subarray(offset, offset + content.length);
  let decoded: string;
  try {
    decoded = uint8ArrayToLatin1(fflate.unzlibSync(rawSlice));
  } catch {
    try {
      decoded = uint8ArrayToLatin1(fflate.inflateSync(rawSlice));
    } catch {
      decoded = content;
    }
  }
  if (decoded.includes('beginbfchar') || decoded.includes('beginbfrange')) {
    parseCMapContent(decoded, map);
  }
  return map;
}

/**
 * Skanuje PDF pod kątem osadzonych kodów Aztec / QR we wszystkich strumieniach XObject Image.
 * Zwraca listę wszystkich poprawnych kodów 2D (dla biletów z przesiadką).
 *
 * Obsługuje obrazy JPEG (DCTDecode), grayscale/maski 1-bit, DeviceRGB oraz
 * palety /Indexed z predyktorem PNG (typowy format kodu Aztec w nowych biletach PKP IC).
 * Kody rastrowe zapisujemy jako PNG: Fresco na Androidzie nie dekoduje BMP.
 */
export function extractBarcodesFromPdf(pdfBytes: Uint8Array): ExtractedBarcode[] {
  const latin1Str = uint8ArrayToLatin1(pdfBytes);
  const objectIndex = buildObjectIndex(latin1Str);
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;

  const candidates: Array<ExtractedBarcode & { offset: number }> = [];

  while ((match = streamRegex.exec(latin1Str)) !== null) {
    const streamContent = match[1];
    const streamStart = match.index;
    const dictHeader = latin1Str.slice(Math.max(0, streamStart - 800), streamStart);

    // Szukamy wyłącznie obiektów graficznych XObject Subtype Image
    if (!dictHeader.includes('/Image')) {
      continue;
    }

    const widthMatch = dictHeader.match(/\/Width\s+([0-9]+)/);
    const heightMatch = dictHeader.match(/\/Height\s+([0-9]+)/);
    if (!widthMatch || !heightMatch) {
      continue;
    }

    const width = parseInt(widthMatch[1], 10);
    const height = parseInt(heightMatch[1], 10);

    // Kody Aztec i QR są niemal kwadratowe (proporcje 0.8 do 1.25)
    // Logo przewoźników (PKP, KOLEO, KM) ma proporcje 3:1 do 6:1 i jest odrzucane.
    const ratio = width / height;
    if (ratio < 0.8 || ratio > 1.25) {
      continue;
    }

    // Logo i ikony mają kanał alfa (/SMask); kody do kontroli są zawsze nieprzezroczyste.
    if (/\/SMask\b/.test(dictHeader)) {
      continue;
    }

    // Kod kontrolny na bilecie ma min. 60x60 px (kompaktowe Aztec 79x79 w PKP IC)
    // i zazwyczaj nie przekracza 1200x1200 px.
    if (width < 60 || height < 60 || width > 1200 || height > 1200) {
      continue;
    }

    const offset = streamStart + match[0].indexOf(streamContent);
    const rawSlice = pdfBytes.subarray(offset, offset + streamContent.length);

    const isDct = dictHeader.includes('/DCTDecode');
    const isFlate = dictHeader.includes('/FlateDecode');

    // 1. JPEG (DCTDecode). Bez dekodera pikseli: DeviceGray / 1-składnikowy SOF
    // uznajemy za mono; DeviceRGB zostaje (stary PKP IC), ale bez zaufania.
    if (isDct) {
      if (rawSlice.length >= 3 && rawSlice[0] === 0xff && rawSlice[1] === 0xd8 && rawSlice[2] === 0xff) {
        const deviceGray = /\/DeviceGray\b/.test(dictHeader) || /\/ImageMask\s+true/.test(dictHeader);
        const sofGray = jpegSofIsGrayscale(rawSlice) === true;
        const monochromeVerified = deviceGray || sofGray;
        // Kolorowy kwadrat bez weryfikacji mono: tylko gdy wygląda na 1-bitowy kontrast w SOF
        // albo jest DeviceGray. Czyste RGB logo odpada, chyba że brak lepszego kandydata
        // i tekst biletu i tak potwierdzi import (patrz isLikelyRailTicket).
        if (!monochromeVerified && /\/DeviceRGB\b/.test(dictHeader)) {
          // Stary format PKP IC: Aztec jako JPEG RGB. Zostawiamy, ale niżej w sortowaniu.
        }
        candidates.push({
          bytes: rawSlice.slice(),
          extension: 'jpg',
          width,
          height,
          monochromeVerified,
          offset,
        });
        continue;
      }
    }

    // 2. Obraz skompresowany FlateDecode (częsty w biletach generowanych przez silniki PDF jak w KOLEO)
    if (isFlate) {
      let uncompressed: Uint8Array;
      try {
        uncompressed = fflate.unzlibSync(rawSlice);
      } catch {
        try {
          uncompressed = fflate.inflateSync(rawSlice);
        } catch {
          continue;
        }
      }

      const isImageMask = /\/ImageMask\s+true/.test(dictHeader);
      const bpcMatch = dictHeader.match(/\/BitsPerComponent\s+([0-9]+)/);
      const bpc = bpcMatch ? parseInt(bpcMatch[1], 10) : (isImageMask ? 1 : 8);
      const decodeInvert = /\/Decode\s*\[\s*1\s+0\s*\]/.test(dictHeader);

      // DecodeParms bywa obiektem po referencji (np. Predictor 15 w osobnym obj),
      // więc parametry predyktora czytamy też z ciała wskazanego obiektu.
      const decodeParms = resolveDecodeParms(latin1Str, objectIndex, dictHeader);
      const isIndexed = /\/Indexed/.test(dictHeader);
      const baseColors = isIndexed ? 1 : dictHeader.includes('/DeviceRGB') ? 3 : 1;
      const colors = decodeParms?.colors ?? baseColors;
      const predictor = decodeParms?.predictor ?? 0;

      if (predictor >= 10 && bpc === 8) {
        const bytesPerPixel = colors;
        const expectedLen = (width * bytesPerPixel + 1) * height;
        if (uncompressed.length >= expectedLen) {
          uncompressed = unfilterPngPredictor(uncompressed, width, height, bytesPerPixel);
        }
      }

      let gray: Uint8Array | null = null;

      if (isIndexed) {
        // Paleta: /ColorSpace [/Indexed /DeviceRGB hival N 0 R]
        const palMatch = dictHeader.match(
          /\/Indexed\s*\/Device(?:RGB|Gray)\s+\d+\s+(\d+)\s+0\s+R/,
        );
        if (palMatch) {
          const palette = loadIndexedPalette(
            pdfBytes,
            latin1Str,
            objectIndex,
            parseInt(palMatch[1], 10),
          );
          if (palette) {
            gray = mapIndexedToGray(uncompressed, width, height, palette);
          }
        }
      } else if (bpc === 1) {
        // Monochromatyczna 1-bitowa maska kodu 2D
        gray = unpack1BitToGray8(width, height, uncompressed, decodeInvert);
      } else if (bpc === 8) {
        if (colors === 3 && uncompressed.length >= width * height * 3) {
          gray = rgbToGray8(uncompressed, width, height);
        } else if (uncompressed.length >= width * height) {
          gray = new Uint8Array(uncompressed.subarray(0, width * height));
          if (decodeInvert) {
            for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i];
          }
        }
      }

      if (gray) {
        // Kod 2D to kontrastowa matryca czarno-biała; kolorowe kwadratowe
        // grafiki (logotypy, flagi) mają mało skrajnych wartości luminancji.
        if (!isMonochromeMatrix(gray)) {
          continue;
        }
        normalizeBarcodePolarity(gray, width, height);
        candidates.push({
          bytes: createPngGray8(width, height, gray),
          extension: 'png',
          width,
          height,
          monochromeVerified: true,
          offset,
        });
      }
    }
  }

  // Najpierw zweryfikowane matryce mono, potem kolejność w pliku (nie rozmiar).
  candidates.sort((a, b) => {
    const trust = Number(Boolean(b.monochromeVerified)) - Number(Boolean(a.monochromeVerified));
    if (trust !== 0) return trust;
    return a.offset - b.offset;
  });
  return candidates.map((c) => ({
    bytes: c.bytes,
    extension: c.extension,
    width: c.width,
    height: c.height,
    monochromeVerified: c.monochromeVerified,
  }));
}

/** Czy JPEG ma 1 składową w SOF (DeviceGray w praktyce). null = nie udało się odczytać. */
function jpegSofIsGrayscale(bytes: Uint8Array): boolean | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return bytes[i + 9] === 1;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) break;
    i += 2 + len;
  }
  return null;
}

/**
 * Zwraca najlepszy znaleziony kod kreskowy / Aztec z pliku PDF.
 */
export function extractBarcodeFromPdf(pdfBytes: Uint8Array): ExtractedBarcode | null {
  const all = extractBarcodesFromPdf(pdfBytes);
  return all.length > 0 ? all[0] : null;
}

/**
 * Sprawdza, czy obraz to kontrastowa matryca czarno-biała (kod 2D),
 * a nie kolorowa grafika: wymagamy wyraźnych udziałów czerni i bieli.
 */
function isMonochromeMatrix(gray: Uint8Array): boolean {
  let dark = 0;
  let light = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] < 48) dark++;
    else if (gray[i] > 207) light++;
  }
  const total = gray.length;
  return dark >= total * 0.15 && light >= total * 0.15;
}

/**
 * Gwarantuje prawidłową polaryzację matrycy 2D (czarne moduły na białej strefie ciszy Quiet Zone).
 * Jeśli margines kodu jest ciemny (negatyw), odwraca piksele.
 */function normalizeBarcodePolarity(pixels: Uint8Array, width: number, height: number): void {
  let borderSum = 0;
  let borderCount = 0;
  for (let x = 0; x < width; x++) {
    borderSum += pixels[x] + pixels[(height - 1) * width + x];
    borderCount += 2;
  }
  for (let y = 1; y < height - 1; y++) {
    borderSum += pixels[y * width] + pixels[y * width + (width - 1)];
    borderCount += 2;
  }
  const avgBorder = borderSum / Math.max(1, borderCount);
  if (avgBorder < 128) {
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = 255 - pixels[i];
    }
  }
}

/**
 * Odwraca predyktor PNG (Paeth, Sub, Up, Average) używany przy kompresji strumieni FlateDecode w PDF.
 */
export function unfilterPngPredictor(
  data: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
): Uint8Array {
  const rowBytes = width * bytesPerPixel;
  const stride = rowBytes + 1;
  const out = new Uint8Array(width * height * bytesPerPixel);
  let prevRow = new Uint8Array(rowBytes);

  for (let y = 0; y < height; y++) {
    const filterType = data[y * stride];
    const srcRow = y * stride + 1;
    const dstRow = y * rowBytes;
    const currentRow = new Uint8Array(rowBytes);

    for (let x = 0; x < rowBytes; x++) {
      const raw = data[srcRow + x];
      const left = x >= bytesPerPixel ? currentRow[x - bytesPerPixel] : 0;
      const up = prevRow[x];
      const upLeft = x >= bytesPerPixel ? prevRow[x - bytesPerPixel] : 0;

      let val = raw;
      if (filterType === 1) {
        val = (raw + left) & 0xff;
      } else if (filterType === 2) {
        val = (raw + up) & 0xff;
      } else if (filterType === 3) {
        val = (raw + Math.floor((left + up) / 2)) & 0xff;
      } else if (filterType === 4) {
        val = (raw + paethPredictor(left, up, upLeft)) & 0xff;
      }
      currentRow[x] = val;
      out[dstRow + x] = val;
    }
    prevRow = currentRow;
  }
  return out;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Rozpakowuje 1-bitowe piksele z wierszy do pełnej 8-bitowej skali szarości.
 * W PDF DeviceGray: 0 = czerń, 1 = biel. Gdy invert = true (/Decode [1 0]): 0 = biel, 1 = czerń.
 */
function unpack1BitToGray8(
  width: number,
  height: number,
  rawBits: Uint8Array,
  invert: boolean,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const rowBytes = Math.ceil(width / 8);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const byte = rawBits[rowStart + (x >> 3)];
      const bit = (byte >> (7 - (x & 7))) & 1;
      const pixel = invert ? (bit ? 0 : 255) : bit ? 255 : 0;
      out[y * width + x] = pixel;
    }
  }
  return out;
}

/**
 * Tworzy plik PNG 8-bit grayscale (color type 0) ze surowych pikseli.
 * Fresco w React Native nie dekoduje BMP, więc kody Aztec muszą być PNG.
 */
export function createPngGray8(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const stride = width + 1; // bajt filtra 0 na początku każdego wiersza
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * stride + 1);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = pngChunk('IHDR', ihdr);
  const idatChunk = pngChunk('IDAT', fflate.zlibSync(raw));
  const iendChunk = pngChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let offset = 0;
  png.set(signature, offset);
  offset += signature.length;
  png.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  png.set(idatChunk, offset);
  offset += idatChunk.length;
  png.set(iendChunk, offset);
  return png;
}

const PNG_CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  PNG_CRC_TABLE[n] = c >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  let c = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) {
    c = PNG_CRC_TABLE[(c ^ out[i]) & 0xff] ^ (c >>> 8);
  }
  view.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
  return out;
}

/**
 * Konwertuje piksele RGB24 na grayscale 8-bit (luminancja ITU-R BT.601).
 */
function rgbToGray8(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    out[i] = (rgb[i * 3] * 299 + rgb[i * 3 + 1] * 587 + rgb[i * 3 + 2] * 114) / 1000;
  }
  return out;
}

/**
 * Mapuje indeksy palety /Indexed na grayscale według luminancji kolorów palety.
 * Paleta to zdekompresowane wpisy RGB (3 bajty na kolor).
 */
function mapIndexedToGray(
  data: Uint8Array,
  width: number,
  height: number,
  palette: Uint8Array,
): Uint8Array | null {
  if (data.length < width * height) return null;
  const paletteCount = Math.floor(palette.length / 3);
  const lum = new Uint8Array(paletteCount);
  for (let i = 0; i < paletteCount; i++) {
    lum[i] = (palette[i * 3] * 299 + palette[i * 3 + 1] * 587 + palette[i * 3 + 2] * 114) / 1000;
  }
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const idx = data[i];
    out[i] = idx < paletteCount ? lum[idx] : 255;
  }
  return out;
}

/** Pozycje obiektów PDF: id -> [start, end) w latin1. Pierwsze wystąpienie wygrywa. */
function buildObjectIndex(latin1Str: string): Map<number, { start: number; end: number }> {
  const positions: Array<{ id: number; start: number }> = [];
  const re = /(\d+)\s+0\s+obj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin1Str)) !== null) {
    positions.push({ id: parseInt(m[1], 10), start: m.index });
  }
  const index = new Map<number, { start: number; end: number }>();
  for (let i = 0; i < positions.length; i++) {
    if (index.has(positions[i].id)) continue;
    const end = i + 1 < positions.length ? positions[i + 1].start : latin1Str.length;
    index.set(positions[i].id, { start: positions[i].start, end });
  }
  return index;
}

/** Tekst obiektu (nagłówek dict) po id; tnimy do 4 KB, żeby nie ciąć binarnych strumieni. */
function getObjectText(
  latin1Str: string,
  objectIndex: Map<number, { start: number; end: number }>,
  objectId: number,
): string | null {
  const pos = objectIndex.get(objectId);
  if (!pos) return null;
  return latin1Str.slice(pos.start, Math.min(pos.end, pos.start + 4096));
}

/**
 * Parametry dekodowania obrazu: /DecodeParms bywa wpisane inline lub przez
 * referencję do innego obiektu (predyktor PNG w osobnym obj, jak w PKP IC).
 */
function resolveDecodeParms(
  latin1Str: string,
  objectIndex: Map<number, { start: number; end: number }>,
  dictHeader: string,
): { predictor: number; colors: number } | null {
  const parseParms = (text: string): { predictor: number; colors: number } | null => {
    const predictorMatch = text.match(/\/Predictor\s+([0-9]+)/);
    if (!predictorMatch) return null;
    const colorsMatch = text.match(/\/Colors\s+([0-9]+)/);
    return {
      predictor: parseInt(predictorMatch[1], 10),
      colors: colorsMatch ? parseInt(colorsMatch[1], 10) : 1,
    };
  };

  const inlineMatch = dictHeader.match(/\/DecodeParms\s*<<([^>]*)>>/);
  if (inlineMatch) {
    const parsed = parseParms(inlineMatch[1]);
    if (parsed) return parsed;
  }

  const refMatch = dictHeader.match(/\/DecodeParms\s+(\d+)\s+0\s+R/);
  if (refMatch) {
    const objText = getObjectText(latin1Str, objectIndex, parseInt(refMatch[1], 10));
    if (objText) {
      const parsed = parseParms(objText);
      if (parsed) return parsed;
    }
  }
  return null;
}

/**
 * Ładuje paletę colorspace /Indexed: strumień obiektu wskazanego w /ColorSpace,
 * zdekompresowany do wpisów RGB (3 bajty na kolor).
 */
function loadIndexedPalette(
  pdfBytes: Uint8Array,
  latin1Str: string,
  objectIndex: Map<number, { start: number; end: number }>,
  paletteObjId: number,
): Uint8Array | null {
  const pos = objectIndex.get(paletteObjId);
  if (!pos) return null;
  const objRegion = latin1Str.slice(pos.start, pos.end);
  const streamMatch = objRegion.match(/stream[\r\n]+([\s\S]*?)[\r\n]+endstream/);
  if (!streamMatch) return null;
  const content = streamMatch[1];
  const offset = pos.start + objRegion.indexOf(content);
  const rawSlice = pdfBytes.subarray(offset, offset + content.length);
  try {
    return fflate.unzlibSync(rawSlice);
  } catch {
    try {
      return fflate.inflateSync(rawSlice);
    } catch {
      return null;
    }
  }
}

/**
 * Wyszukuje i buduje zunifikowaną mapę znaków CMap z osadzonych strumieni PDF.
 */
function buildCMap(pdfBytes: Uint8Array, latin1Str: string): Map<number, string> {
  const glyphMap = new Map<number, string>();
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(latin1Str)) !== null) {
    const streamContent = match[1];
    const streamStart = match.index;
    const offset = streamStart + match[0].indexOf(streamContent);
    const rawSlice = pdfBytes.subarray(offset, offset + streamContent.length);

    let decompressedStr = '';
    try {
      const decomp = fflate.unzlibSync(rawSlice);
      decompressedStr = uint8ArrayToLatin1(decomp);
    } catch {
      try {
        const decomp = fflate.inflateSync(rawSlice);
        decompressedStr = uint8ArrayToLatin1(decomp);
      } catch {
        decompressedStr = streamContent;
      }
    }

    if (decompressedStr.includes('beginbfchar') || decompressedStr.includes('beginbfrange')) {
      parseCMapContent(decompressedStr, glyphMap);
    }
  }

  return glyphMap;
}

export function parseCMapContent(cmapText: string, map: Map<number, string>): void {
  // Format 1: beginbfchar <src> <dst>
  const bfCharRegex = /beginbfchar[\s\S]*?endbfchar/g;
  let m: RegExpExecArray | null;
  while ((m = bfCharRegex.exec(cmapText)) !== null) {
    const lines = m[0].split('\n');
    for (const l of lines) {
      const match = l.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
      if (match) {
        const src = parseInt(match[1], 16);
        const dstCode = parseInt(match[2], 16);
        map.set(src, String.fromCharCode(dstCode));
      }
    }
  }

  // Format 2: beginbfrange
  // Wariant A: <start> <end> <dest_start>
  // Wariant B: <start> <end> [ <dest1> <dest2> ... ]
  const bfRangeRegex = /beginbfrange[\s\S]*?endbfrange/g;
  while ((m = bfRangeRegex.exec(cmapText)) !== null) {
    const lines = m[0].split('\n');
    for (const l of lines) {
      // Wariant B: tablicowy
      const matchArray = l.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/);
      if (matchArray) {
        const start = parseInt(matchArray[1], 16);
        const end = parseInt(matchArray[2], 16);
        const hexList = matchArray[3].match(/<([0-9a-fA-F]+)>/g) || [];
        for (let i = 0; i < hexList.length && start + i <= end; i++) {
          const hex = hexList[i].replace(/[<>]/g, '');
          map.set(start + i, String.fromCharCode(parseInt(hex, 16)));
        }
        continue;
      }

      // Wariant A: 3 tokeny szesnastkowe
      const match3 = l.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
      if (match3) {
        const start = parseInt(match3[1], 16);
        const end = parseInt(match3[2], 16);
        let dst = parseInt(match3[3], 16);
        for (let code = start; code <= end; code++) {
          map.set(code, String.fromCharCode(dst++));
        }
      }
    }
  }
}

function uint8ArrayToLatin1(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  const chunkSize = 4096;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    result += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return result;
}

function latin1ToUint8Array(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Wyciąga literały tekstowe z poleceń PDF (Tj, TJ, ', ") zapisane w nawiasach lub hex.
 * Gdy dostępne są CMap-y per czcionka, hexy dekodowane są mapą aktualnego fontu
 * z ostatniego operatora Tf przed danym tekstem.
 */
function extractStringsFromStream(
  streamText: string,
  out: string[],
  glyphMap: Map<number, string>,
  fontCMaps?: Map<string, Map<number, string>> | null,
): void {
  // Pozycje operatorów Tf: /F1 12 Tf - zmienia aktywną czcionkę
  const tfOps: Array<{ end: number; font: string }> = [];
  if (fontCMaps && fontCMaps.size > 0) {
    const tfRegex = /\/(\w+)\s+[-0-9.]+\s+Tf/g;
    let tf: RegExpExecArray | null;
    while ((tf = tfRegex.exec(streamText)) !== null) {
      tfOps.push({ end: tf.index + tf[0].length, font: tf[1] });
    }
  }
  const cmapAt = (pos: number): Map<number, string> => {
    for (let i = tfOps.length - 1; i >= 0; i--) {
      if (tfOps[i].end <= pos) {
        return fontCMaps?.get(tfOps[i].font) ?? glyphMap;
      }
    }
    return glyphMap;
  };

  const stringRegex = /\(([^)]*)\)\s*(?:Tj|'|")/g;
  let match: RegExpExecArray | null;

  while ((match = stringRegex.exec(streamText)) !== null) {
    const raw = match[1];
    if (raw && raw.trim().length > 0) {
      out.push(decodePdfString(raw));
    }
  }

  const arrayTjRegex = /\[([\s\S]*?)\]\s*TJ/g;
  while ((match = arrayTjRegex.exec(streamText)) !== null) {
    const inside = match[1];
    const activeMap = cmapAt(match.index);
    const subMatchRegex = /\(([^)]*)\)/g;
    let sub: RegExpExecArray | null;
    let accumulated = '';
    while ((sub = subMatchRegex.exec(inside)) !== null) {
      accumulated += decodePdfString(sub[1]);
    }
    if (accumulated.trim().length > 0) {
      out.push(accumulated);
    }

    const hexSubRegex = /<([0-9a-fA-F]+)>/g;
    let hexSub: RegExpExecArray | null;
    let hexAccumulated = '';
    while ((hexSub = hexSubRegex.exec(inside)) !== null) {
      hexAccumulated += decodeHexPdfString(hexSub[1], activeMap);
    }
    if (hexAccumulated.trim().length > 0) {
      out.push(hexAccumulated);
    }
  }

  const singleHexRegex = /<([0-9a-fA-F]+)>\s*(?:Tj|'|")/g;
  while ((match = singleHexRegex.exec(streamText)) !== null) {
    const decoded = decodeHexPdfString(match[1], cmapAt(match.index));
    if (decoded.trim().length > 0) {
      out.push(decoded);
    }
  }
}

function decodeHexPdfString(hex: string, glyphMap: Map<number, string>): string {
  if (glyphMap.size > 0 && hex.length >= 4 && hex.length % 4 === 0) {
    let decoded = '';
    let mappedAny = false;
    for (let i = 0; i < hex.length; i += 4) {
      const code = parseInt(hex.slice(i, i + 4), 16);
      if (glyphMap.has(code)) {
        decoded += glyphMap.get(code)!;
        mappedAny = true;
      } else {
        decoded += ' ';
      }
    }
    if (mappedAny) {
      return decoded;
    }
  }

  if (hex.length % 2 !== 0) hex += '0';
  let str = '';
  if (hex.length >= 4 && hex.length % 4 === 0) {
    let looksLikeUtf16 = true;
    for (let i = 0; i < hex.length; i += 4) {
      const b0 = parseInt(hex.slice(i, i + 2), 16);
      if (b0 !== 0 && b0 !== 1) {
        looksLikeUtf16 = false;
        break;
      }
    }
    if (looksLikeUtf16) {
      for (let i = 0; i < hex.length; i += 4) {
        const code = parseInt(hex.slice(i, i + 4), 16);
        if (code >= 32 && code <= 126) {
          str += String.fromCharCode(code);
        } else if (code > 126) {
          str += ' ';
        }
      }
      return str;
    }
  }

  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code >= 32 && code <= 126) {
      str += String.fromCharCode(code);
    }
  }
  return str;
}

function decodePdfString(str: string): string {
  return str
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\/g, ' ');
}

/**
 * Sprawdza czy dokument PDF wykazuje cechy biletu kolejowego.
 * Samo słowo w nazwie pliku albo sam nieweryfikowany kwadrat JPEG nie wystarcza.
 * `hasTrustedBarcode` = matryca mono (Flate / DeviceGray), nie logo.
 */
export function isLikelyRailTicket(
  text: string,
  fileName?: string,
  hasTrustedBarcode = false,
): boolean {
  const body = text.toLowerCase();
  const name = (fileName || '').toLowerCase();

  const carriers = [
    'intercity',
    'koleo',
    'polregio',
    'koleje dolnośląskie',
    'koleje dolnoslaskie',
    'koleje śląskie',
    'koleje slaskie',
    'koleje mazowieckie',
    'koleje wielkopolskie',
    'koleje małopolskie',
    'koleje malopolskie',
    'łódzka kolej',
    'lodzka kolej',
    'pkp',
  ];
  const hasCarrier = carriers.some((kw) => body.includes(kw));
  const hasRailNoun =
    /\b(bilet|pociąg|pociag|wagon|relacja|przejazd|taryfa|przewoźnik|przewoznik|uic)\b/.test(
      body,
    );

  if (hasCarrier || hasRailNoun) return true;

  // Zaufany kod 2D + ślad treści kolejowej (bez ebooka z przypadkowym kwadratem).
  if (hasTrustedBarcode && /\b(bilet|pkp|pociąg|pociag|wagon|stacja|peron|aztec)\b/.test(body + ' ' + name)) {
    return true;
  }
  return false;
}

/**
 * Parsuje wyciągnięty tekst biletu kolejowego i ekstrahuje kluczowe dane podróży.
 * Wspiera formaty PKP IC, Polregio, Koleje Dolnośląskie (KD), Koleje Śląskie (KŚ), KM, KOLEO, SkyCash itp.
 */
export function parseRailTicketText(text: string, fileName?: string): ParsedTicketMetadata {
  const result: ParsedTicketMetadata = {};

  // 1. Numer pociągu. Najpierw etykieta "Pociąg: 1514" / "Pociąg IC 3812" (nowe bilety
  // PKP IC podają sam numer bez prefiksu przewoźnika), potem wzorzec z prefiksem.
  const pociagMatch = text.match(
    /\bpoci[ąa]g(?:\s+(?:numer|nr))?\s*[:\-]?\s*((?:EIP|EIC|IC|TLK|KD|REGIO|PR|KM)?\s*[0-9]{3,6})\b/i,
  );
  if (pociagMatch) {
    result.trainNumber = pociagMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
  } else {
    const trainMatch = text.match(
      /\b(EIP|EIC|IC|TLK|KD|REGIO|PR|KM|KŚ|KS|ŁKA|LKA|KW|KMŁ|KML|SKM|OsP?|D[0-9]{1,2}|S[0-9]{1,2})\s*([0-9]{3,6})\b/i,
    );
    if (trainMatch) {
      result.trainNumber = `${trainMatch[1].toUpperCase()} ${trainMatch[2]}`;
    } else if (fileName) {
      const fileTrain = fileName.match(
        /\b(EIP|EIC|IC|TLK|KD|REGIO|PR|KM|KŚ|KS|ŁKA|LKA|KW|KMŁ|KML|SKM|OsP?|D[0-9]{1,2}|S[0-9]{1,2})[\s_\-]*([0-9]{3,6})\b/i,
      );
      if (fileTrain) {
        result.trainNumber = `${fileTrain[1].toUpperCase()} ${fileTrain[2]}`;
      }
    }
  }

  // 2. Wagon (jeśli pociąg z rezerwacją miejsc; w regionalnych KD/KŚ często brak)
  const wagonMatch = text.match(/\bwagon[:\s]*([0-9]{1,3})\b/i);
  if (wagonMatch) {
    result.wagon = wagonMatch[1];
  }

  // 3. Miejsce (obsługuje standardowe "miejsce: 74" oraz KOLEO "miejsce do siedzenia 62")
  const seatMatch = text.match(/\bmiejsc[ea](?:\s+do\s+siedzenia)?[:\s]*([0-9]{1,3})\b/i);
  if (seatMatch) {
    result.seat = seatMatch[1];
  }

  // 4. Typ miejsca (okno / korytarz / środek)
  if (/\bokno\b/i.test(text)) {
    result.seatType = 'okno';
  } else if (/\bkorytarz\b/i.test(text)) {
    result.seatType = 'korytarz';
  } else if (/\bśrodek\b/i.test(text) || /\bsrodek\b/i.test(text)) {
    result.seatType = 'środek';
  }

  // 5. Pasażer (wspiera "Pasażer:", "Podróżny:" oraz KOLEO "Właściciel biletu:")
  const passengerMatch = text.match(
    /(?:pasażer|pasazer|podróżny|podrozny|właściciel\s+biletu|wlasciciel\s+biletu)[:\s]*([A-ZŁŚĆŹŻĄĘÓŃa-złśćźżąęón]{2,}\s+[A-ZŁŚĆŹŻĄĘÓŃa-złśćźżąęón]{2,})/i,
  );
  if (passengerMatch) {
    result.passenger = passengerMatch[1].trim();
  }

  // 6. Ulga / taryfa (wspiera "51% STU/DOK", "Ulga 51%", "Bilet normalny", "Taryfa podstawowa")
  const tariffMatch = text.match(
    /\b(ulga\s*[0-9]{1,2}%|[0-9]{1,2}%\s*(?:STU\/DOK|[A-Z0-9\/]+)|bilet\s+normalny|taryfa\s+normalna|taryfa\s+podstawowa|student|senior)(?=$|[\s,\.\]\)])/i,
  );
  if (tariffMatch) {
    result.tariff = tariffMatch[1].trim();
  }

  // 7. Numer biletu
  const ticketNoMatch = text.match(
    /(?:nr\s+biletu|bilet\s+nr|numer\s+biletu|kod\s+biletu|kod\s+transakcji)[:\s]*([A-Z0-9\-\/]{5,20})/i,
  );
  if (ticketNoMatch) {
    result.ticketNumber = ticketNoMatch[1].trim();
  }

  // 8. Czas odjazdu i stacje z zapisu relacji (np. "18.10 13:47 Katowice -> Wrocław Główny", "Wrocław Główny - Legnica" lub PKP IC "Odjazd: 14:25 Wrocław Główny")
  const relacjaMatch = text.match(
    /([0-2]?[0-9]:[0-5][0-9])\s+([A-ZŁŚĆŹŻĄĘÓŃa-złśćźżąęón.\s-]+?)\s*->\s*([A-ZŁŚĆŹŻĄĘÓŃa-złśćźżąęón.\s-]+?)(?:\s+[0-9]{2}\.[0-9]{2}|\s+[0-2]?[0-9]:[0-5][0-9]|\s+\*|$)/i,
  );
  if (relacjaMatch) {
    result.departTime = relacjaMatch[1];
    result.fromStation = relacjaMatch[2].trim();
    result.toStation = relacjaMatch[3].trim();
  } else {
    // Format PKP Intercity / Polregio / Koleje Śląskie:
    // Odjazd: 14:25 Wrocław Główny
    // Przyjazd: 17:15 Poznań Główny
    const odjazdMatch = text.match(
      /\bodjazd[:\s]*([0-2]?[0-9]:[0-5][0-9])(?:\s+([A-ZŁŚĆŹŻĄĘÓŃa-złśćźżąęón.\s-]+?))?(?=\s*(?:przyjazd|wagon|miejsce|klasa|\n|\r|$))/i,
    );
    if (odjazdMatch) {
      result.departTime = odjazdMatch[1];
      const st = odjazdMatch[2]?.trim();
      if (st && st.length > 2) {
        result.fromStation = st;
      }
    } else {
      const timeMatch = text.match(/\bodjazd[:\s]*([0-2]?[0-9]:[0-5][0-9])\b/i);
      if (timeMatch) {
        result.departTime = timeMatch[1];
      }
    }

    const przyjazdMatch = text.match(
      /\bprzyjazd[:\s]*([0-2]?[0-9]:[0-5][0-9])(?:\s+([A-ZŁŚĆŹŻĄĘÓŃa-złśćźżąęón.\s-]+?))?(?=\s*(?:wagon|miejsce|klasa|\n|\r|$))/i,
    );
    if (przyjazdMatch) {
      result.arriveTime = przyjazdMatch[1];
      const st = przyjazdMatch[2]?.trim();
      if (st && st.length > 2) {
        result.toStation = st;
      }
    }
  }

  // 9. Data odjazdu. Tylko etykieta "Data odjazdu" albo wiersz relacji z godziną.
  // Pierwsza data w PDF bywa datą wystawienia: nie bierzemy jej jako odjazdu.
  const labeledDate = text.match(
    /\bdata\s+odjazdu[\s\S]{0,40}?([0-3]?[0-9])\.(0[1-9]|1[0-2])\.(20[2-3][0-9])/i,
  );
  const relacjaDate = text.match(
    /\b([0-3]?[0-9])\.(0[1-9]|1[0-2])\.?\s+([0-2]?[0-9]:[0-5][0-9])\s+[A-ZŁŚĆŹŻĄĘÓŃ]/,
  );

  if (labeledDate) {
    result.departDate = `${labeledDate[3]}-${labeledDate[2]}-${labeledDate[1].padStart(2, '0')}`;
  } else if (relacjaDate) {
    const day = relacjaDate[1].padStart(2, '0');
    const month = relacjaDate[2];
    // Rok z pełnej daty o tym samym dniu i miesiącu; inaczej bieżący (Warszawa).
    const sameDayYear = text.match(
      new RegExp(`\\b${relacjaDate[1]}\\.${month}\\.(20[2-3][0-9])\\b`),
    );
    const year = sameDayYear
      ? parseInt(sameDayYear[1], 10)
      : warsawYearFallback();
    result.departDate = `${year}-${month}-${day}`;
  }

  return result;
}

function warsawYearFallback(): number {
  try {
    // Unikamy importu cyklicznego: lokalny formatter jak w geo.ts.
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
    }).formatToParts(new Date());
    const year = parts.find((p) => p.type === 'year')?.value;
    return year ? parseInt(year, 10) : new Date().getFullYear();
  } catch {
    return new Date().getFullYear();
  }
}
