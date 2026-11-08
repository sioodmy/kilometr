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
}

export interface ExtractedBarcode {
  bytes: Uint8Array;
  extension: 'jpg' | 'bmp';
  width: number;
  height: number;
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
 */
export function extractTextFromPdf(pdfBytes: Uint8Array): string {
  const textChunks: string[] = [];
  const latin1Str = uint8ArrayToLatin1(pdfBytes);

  // Wstępna budowa mapy znaków CMap (częsta w biletach KOLEO / PKP IC z fontami subset)
  const glyphMap = buildCMap(pdfBytes, latin1Str);

  // Wyszukiwanie obiektów: obj ... stream ... endstream
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(latin1Str)) !== null) {
    const streamContent = match[1];
    const streamStart = match.index;
    const dictHeader = latin1Str.slice(Math.max(0, streamStart - 800), streamStart);

    // Pomiń strumienie będące obrazami lub samymi tabelami CMap przy czytaniu tekstu
    if (dictHeader.includes('/Image')) {
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
    extractStringsFromStream(decodedStreamText, textChunks, glyphMap);
  }

  if (textChunks.length === 0) {
    extractStringsFromStream(latin1Str, textChunks, glyphMap);
  }

  return textChunks.join(' ');
}

/**
 * Skanuje PDF pod kątem osadzonych kodów Aztec / QR we wszystkich strumieniach XObject Image.
 * Zwraca listę wszystkich poprawnych kodów 2D (dla biletów z przesiadką).
 */
export function extractBarcodesFromPdf(pdfBytes: Uint8Array): ExtractedBarcode[] {
  const latin1Str = uint8ArrayToLatin1(pdfBytes);
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;

  const candidates: Array<ExtractedBarcode & { score: number }> = [];

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

    // Kod kontrolny na bilecie ma min. 80x80 px i zazwyczaj nie przekracza 1200x1200 px
    if (width < 80 || height < 80 || width > 1200 || height > 1200) {
      continue;
    }

    const offset = streamStart + match[0].indexOf(streamContent);
    const rawSlice = pdfBytes.subarray(offset, offset + streamContent.length);

    const isDct = dictHeader.includes('/DCTDecode');
    const isFlate = dictHeader.includes('/FlateDecode');

    // 1. Obraz skompresowany JPEG (częsty w biletach PKP IC / KOLEO / KD)
    if (isDct) {
      if (rawSlice.length >= 3 && rawSlice[0] === 0xff && rawSlice[1] === 0xd8 && rawSlice[2] === 0xff) {
        const aspectDiff = Math.abs(1 - ratio);
        const score = 100 - aspectDiff * 50 + Math.min(width, 400) / 10;
        candidates.push({
          bytes: rawSlice,
          extension: 'jpg',
          width,
          height,
          score,
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
      const isRgb = dictHeader.includes('/DeviceRGB');
      const decodeInvert = /\/Decode\s*\[\s*1\s+0\s*\]/.test(dictHeader);

      // Sprawdź czy strumień używa filtra PNG Predictor (np. Predictor 15 w KOLEO)
      const hasPngPredictor = /\/Predictor\s+(?:10|11|12|13|14|15)/.test(dictHeader);
      if (hasPngPredictor && bpc === 8) {
        const bytesPerPixel = isRgb ? 3 : 1;
        const expectedLen = (width * bytesPerPixel + 1) * height;
        if (uncompressed.length >= expectedLen) {
          uncompressed = unfilterPngPredictor(uncompressed, width, height, bytesPerPixel);
        }
      }

      let bmpBytes: Uint8Array | null = null;

      if (bpc === 1) {
        // Monochromatyczna 1-bitowa maska kodu 2D z automatyczną normalizacją polaryzacji
        const gray8 = unpack1BitToGray8(width, height, uncompressed, decodeInvert);
        normalizeBarcodePolarity(gray8, width, height);
        bmpBytes = createBmpGray8(width, height, gray8);
      } else if (bpc === 8) {
        if (isRgb && uncompressed.length >= width * height * 3) {
          bmpBytes = createBmpRgb24(width, height, uncompressed);
        } else if (uncompressed.length >= width * height) {
          const grayCopy = new Uint8Array(uncompressed.subarray(0, width * height));
          if (decodeInvert) {
            for (let i = 0; i < grayCopy.length; i++) grayCopy[i] = 255 - grayCopy[i];
          }
          normalizeBarcodePolarity(grayCopy, width, height);
          bmpBytes = createBmpGray8(width, height, grayCopy);
        }
      }

      if (bmpBytes) {
        const aspectDiff = Math.abs(1 - ratio);
        const score = 80 - aspectDiff * 50 + Math.min(width, 400) / 10;
        candidates.push({
          bytes: bmpBytes,
          extension: 'bmp',
          width,
          height,
          score,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.map((c) => ({
    bytes: c.bytes,
    extension: c.extension,
    width: c.width,
    height: c.height,
  }));
}

/**
 * Zwraca najlepszy znaleziony kod kreskowy / Aztec z pliku PDF.
 */
export function extractBarcodeFromPdf(pdfBytes: Uint8Array): ExtractedBarcode | null {
  const all = extractBarcodesFromPdf(pdfBytes);
  return all.length > 0 ? all[0] : null;
}

/**
 * Gwarantuje prawidłową polaryzację matrycy 2D (czarne moduły na białej strefie ciszy Quiet Zone).
 * Jeśli margines kodu jest ciemny (negatyw), odwraca piksele.
 */
function normalizeBarcodePolarity(pixels: Uint8Array, width: number, height: number): void {
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
 * Tworzy poprawny plik BMP 8-bit ze skali szarości z 1024-bajtową paletą barw.
 */
function createBmpGray8(width: number, height: number, rawPixels: Uint8Array): Uint8Array {
  const stride = (width + 3) & ~3;
  const padding = stride - width;
  const dataSize = stride * height;
  const fileSize = 54 + 1024 + dataSize;
  const buf = new Uint8Array(fileSize);
  const view = new DataView(buf.buffer);

  buf[0] = 0x42; // 'B'
  buf[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54 + 1024, true);

  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 8, true);
  view.setUint32(34, dataSize, true);

  let pOffset = 54;
  for (let i = 0; i < 256; i++) {
    buf[pOffset++] = i;
    buf[pOffset++] = i;
    buf[pOffset++] = i;
    buf[pOffset++] = 0;
  }

  let dst = 54 + 1024;
  for (let y = height - 1; y >= 0; y--) {
    const src = y * width;
    buf.set(rawPixels.subarray(src, src + width), dst);
    dst += width;
    for (let p = 0; p < padding; p++) {
      buf[dst++] = 0;
    }
  }

  return buf;
}

/**
 * Tworzy 24-bitowy plik BMP RGB (BGR order) z paddingiem wierszy do wielokrotności 4 bajtów.
 */
function createBmpRgb24(width: number, height: number, rawRgb: Uint8Array): Uint8Array {
  const rowSize = width * 3;
  const stride = (rowSize + 3) & ~3;
  const padding = stride - rowSize;
  const dataSize = stride * height;
  const fileSize = 54 + dataSize;
  const buf = new Uint8Array(fileSize);
  const view = new DataView(buf.buffer);

  buf[0] = 0x42;
  buf[1] = 0x4d;
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);

  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, dataSize, true);

  let dst = 54;
  for (let y = height - 1; y >= 0; y--) {
    let src = y * rowSize;
    for (let x = 0; x < width; x++) {
      const r = rawRgb[src++];
      const g = rawRgb[src++];
      const b = rawRgb[src++];
      buf[dst++] = b;
      buf[dst++] = g;
      buf[dst++] = r;
    }
    for (let p = 0; p < padding; p++) {
      buf[dst++] = 0;
    }
  }

  return buf;
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
 */
function extractStringsFromStream(
  streamText: string,
  out: string[],
  glyphMap: Map<number, string>,
): void {
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
      hexAccumulated += decodeHexPdfString(hexSub[1], glyphMap);
    }
    if (hexAccumulated.trim().length > 0) {
      out.push(hexAccumulated);
    }
  }

  const singleHexRegex = /<([0-9a-fA-F]+)>\s*(?:Tj|'|")/g;
  while ((match = singleHexRegex.exec(streamText)) !== null) {
    const decoded = decodeHexPdfString(match[1], glyphMap);
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
 * Sprawdza czy dokument PDF wykazuje cechy biletu kolejowego (słowa kluczowe przewoźników, relacji lub kod 2D).
 */
export function isLikelyRailTicket(
  text: string,
  fileName?: string,
  hasBarcode = false,
): boolean {
  if (hasBarcode) return true;

  const keywords = [
    'bilet',
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
    'pociąg',
    'pociag',
    'wagon',
    'miejsce',
    'przejazd',
    'taryfa',
    'relacja',
    'pkp',
    'uic',
    'przewoźnik',
    'przewoznik',
    'stacja',
  ];

  const lower = `${text} ${fileName || ''}`.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Parsuje wyciągnięty tekst biletu kolejowego i ekstrahuje kluczowe dane podróży.
 * Wspiera formaty PKP IC, Polregio, Koleje Dolnośląskie (KD), Koleje Śląskie (KŚ), KM, KOLEO, SkyCash itp.
 */
export function parseRailTicketText(text: string, fileName?: string): ParsedTicketMetadata {
  const result: ParsedTicketMetadata = {};

  // 1. Numer pociągu (np. IC 65100, KD 69123, KŚ 44102, PR 67201, TLK 38102, EIP 1600, OsP 69123, D1 66201, S1 44102)
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

  // 8. Czas odjazdu i stacje z zapisu relacji (np. "18.10 13:47 Katowice -> Wrocław Główny" lub "Wrocław Główny - Legnica")
  const relacjaMatch = text.match(
    /([0-2]?[0-9]:[0-5][0-9])\s+([A-ZŁŚĆŹŻĄĘÓŃa-złśćźżąęón\s]+?)\s*->\s*([A-ZŁŚĆŹŻĄĘÓŃa-złśćźżąęón\s]+?)(?:\s+[0-9]{2}\.[0-9]{2}|\s+[0-2]?[0-9]:[0-5][0-9]|\s+\*|$)/i,
  );
  if (relacjaMatch) {
    result.departTime = relacjaMatch[1];
    result.fromStation = relacjaMatch[2].trim();
    result.toStation = relacjaMatch[3].trim();
  } else {
    const timeMatch = text.match(/\bodjazd[:\s]*([0-2]?[0-9]:[0-5][0-9])\b/i);
    if (timeMatch) {
      result.departTime = timeMatch[1];
    }
  }

  return result;
}
