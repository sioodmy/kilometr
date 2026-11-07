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

/**
 * Wyciąga czytelny tekst ze strumieni obiektów PDF.
 * Obsługuje strumienie kompresowane FlateDecode (zlib i raw deflate) oraz zapis tekstowy w nawiasach i hex.
 */
export function extractTextFromPdf(pdfBytes: Uint8Array): string {
  const textChunks: string[] = [];
  const latin1Str = uint8ArrayToLatin1(pdfBytes);

  // Wyszukiwanie obiektów: obj ... stream ... endstream
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(latin1Str)) !== null) {
    const streamContent = match[1];
    const streamStart = match.index;
    const dictHeader = latin1Str.slice(Math.max(0, streamStart - 400), streamStart);
    const isFlate = dictHeader.includes('/FlateDecode');

    let streamBytes: Uint8Array;
    if (isFlate) {
      try {
        const offset = streamStart + match[0].indexOf(streamContent);
        const rawSlice = pdfBytes.subarray(offset, offset + streamContent.length);
        // Większość PDF używa standardowego strumienia zlib (nagłówek 78)
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

    const decodedText = uint8ArrayToLatin1(streamBytes);
    extractStringsFromStream(decodedText, textChunks);
  }

  if (textChunks.length === 0) {
    extractStringsFromStream(latin1Str, textChunks);
  }

  return textChunks.join(' ');
}

function uint8ArrayToLatin1(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  const chunkSize = 8192;
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
function extractStringsFromStream(streamText: string, out: string[]): void {
  // Literały w nawiasach: (...) Tj
  const stringRegex = /\(([^)]*)\)\s*(?:Tj|'|")/g;
  let match: RegExpExecArray | null;

  while ((match = stringRegex.exec(streamText)) !== null) {
    const raw = match[1];
    if (raw && raw.trim().length > 0) {
      out.push(decodePdfString(raw));
    }
  }

  // Bloki tablicowe TJ z literałami w nawiasach: [ (tekst) 120 (inny) ] TJ
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

    // Ciągi hex w tablicach TJ: [ <00410042> ] TJ
    const hexSubRegex = /<([0-9a-fA-F]+)>/g;
    let hexSub: RegExpExecArray | null;
    let hexAccumulated = '';
    while ((hexSub = hexSubRegex.exec(inside)) !== null) {
      hexAccumulated += decodeHexPdfString(hexSub[1]);
    }
    if (hexAccumulated.trim().length > 0) {
      out.push(hexAccumulated);
    }
  }

  // Ciągi hex pojedyncze: <00410042> Tj
  const singleHexRegex = /<([0-9a-fA-F]+)>\s*(?:Tj|'|")/g;
  while ((match = singleHexRegex.exec(streamText)) !== null) {
    const decoded = decodeHexPdfString(match[1]);
    if (decoded.trim().length > 0) {
      out.push(decoded);
    }
  }
}

function decodeHexPdfString(hex: string): string {
  if (hex.length % 2 !== 0) hex += '0';
  let str = '';
  // Sprawdź czy to UTF-16BE (częsty format z bajtem zerowym)
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
    .replace(/\\\\/g, '\\');
}

/**
 * Parsuje wyciągnięty tekst biletu kolejowego i ekstrahuje kluczowe dane podróży.
 */
export function parseRailTicketText(text: string, fileName?: string): ParsedTicketMetadata {
  const result: ParsedTicketMetadata = {};

  // 1. Numer pociągu (np. IC 65100, KD 69123, PR 67201, TLK 38102, EIP 1600)
  const trainMatch = text.match(/\b(EIP|EIC|IC|TLK|KD|REGIO|PR|KM|KŚ|ŁKA|KW|KMŁ)\s*([0-9]{3,6})\b/i);
  if (trainMatch) {
    result.trainNumber = `${trainMatch[1].toUpperCase()} ${trainMatch[2]}`;
  } else if (fileName) {
    const fileTrain = fileName.match(/\b(EIP|EIC|IC|TLK|KD|REGIO|PR|KM|KŚ|ŁKA|KW|KMŁ)[\s_\-]*([0-9]{3,6})\b/i);
    if (fileTrain) {
      result.trainNumber = `${fileTrain[1].toUpperCase()} ${fileTrain[2]}`;
    }
  }

  // 2. Wagon
  const wagonMatch = text.match(/\bwagon[:\s]*([0-9]{1,3})\b/i);
  if (wagonMatch) {
    result.wagon = wagonMatch[1];
  }

  // 3. Miejsce
  const seatMatch = text.match(/\bmiejsc[ea][:\s]*([0-9]{1,3})\b/i);
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

  // 5. Pasażer
  const passengerMatch = text.match(/(?:pasażer|pasazer|podróżny|podrozny)[:\s]*([A-ZŁŚĆŹŻĄĘÓŃa-złśćźżąęón]{2,}\s+[A-ZŁŚĆŹŻĄĘÓŃa-złśćźżąęón]{2,})/i);
  if (passengerMatch) {
    result.passenger = passengerMatch[1].trim();
  }

  // 6. Ulga / taryfa
  const tariffMatch = text.match(/\b(ulga\s*[0-9]{1,2}%|bilet\s+normalny|taryfa\s+normalna|student|senior)\b/i);
  if (tariffMatch) {
    result.tariff = tariffMatch[1].trim();
  }

  // 7. Numer biletu
  const ticketNoMatch = text.match(/(?:nr\s+biletu|bilet\s+nr|numer\s+biletu)[:\s]*([A-Z0-9\-\/]{5,20})/i);
  if (ticketNoMatch) {
    result.ticketNumber = ticketNoMatch[1].trim();
  }

  // 8. Czas odjazdu
  const timeMatch = text.match(/\bodjazd[:\s]*([0-2]?[0-9]:[0-5][0-9])\b/i);
  if (timeMatch) {
    result.departTime = timeMatch[1];
  }

  return result;
}
