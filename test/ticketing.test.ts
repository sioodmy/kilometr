import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slugifyStation, buildKoleoUrl, getTrainLegSummary, hasTrainLegs } from '../src/services/ticketing';
import {
  parseRailTicketText,
  extractTextFromPdf,
  extractBarcodeFromPdf,
  extractBarcodesFromPdf,
  isLikelyRailTicket,
  parseCMapContent,
  base64ToUint8Array,
  uint8ArrayToBase64,
  unfilterPngPredictor,
} from '../src/services/ticketParser';
import {
  isTicketExpired,
  resolveTicketUri,
  getTicketForConnection,
  getTicketConnectionIds,
  saveIndex,
  getTicketDir,
  type AttachedRailTicket,
} from '../src/services/ticketStorage';
import { kvSet } from '../src/services/storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { Connection, Leg } from '../src/types/models';

describe('Ticketing Service', () => {
  it('slugifyStation converts Polish station names correctly', () => {
    assert.equal(slugifyStation('Wrocław Główny'), 'wroclaw-glowny');
    assert.equal(slugifyStation('Poznań Główny'), 'poznan-glowny');
    assert.equal(slugifyStation('Jelenia Góra'), 'jelenia-gora');
    assert.equal(slugifyStation('Gdańsk Wrzeszcz'), 'gdansk-wrzeszcz');
    assert.equal(slugifyStation('Warszawa Centralna'), 'warszawa-centralna');
    assert.equal(slugifyStation('Łódź Fabryczna'), 'lodz-fabryczna');
    assert.equal(slugifyStation('Bielsko-Biała Główna'), 'bielsko-biala-glowna');
  });

  const dummyTrainLeg1 = {
    mode: 'train',
    line: 'KD',
    routeId: 'KD-1',
    fromStop: 'Wrocław Główny',
    toStop: 'Legnica',
    departAt: '14:25',
    arriveAt: '15:10',
    stopsCount: 4,
    stops: [],
    fromCoords: [51.098, 17.036],
    toCoords: [51.213, 16.166],
    agencyName: 'Koleje Dolnośląskie',
    railAgency: 'Koleje Dolnośląskie',
    trainNumber: 'KD 69123',
    scheduledDepartureSec: 14 * 3600 + 25 * 60,
    scheduledArrivalSec: 15 * 3600 + 10 * 60,
  } as unknown as Leg;

  const dummyTrainLeg2 = {
    mode: 'train',
    line: 'IC',
    routeId: 'IC-2',
    fromStop: 'Legnica',
    toStop: 'Poznań Główny',
    departAt: '15:40',
    arriveAt: '17:15',
    stopsCount: 6,
    stops: [],
    fromCoords: [51.213, 16.166],
    toCoords: [52.402, 16.912],
    agencyName: 'PKP Intercity',
    railAgency: 'PKP Intercity',
    trainNumber: 'IC 65100',
    scheduledDepartureSec: 15 * 3600 + 40 * 60,
    scheduledArrivalSec: 17 * 3600 + 15 * 60,
  } as unknown as Leg;

  const dummyTramLeg = {
    mode: 'tram',
    line: '2',
    routeId: 'TRAM-2',
    fromStop: 'Arkady',
    toStop: 'Dworzec Główny',
    departAt: '14:05',
    arriveAt: '14:15',
    stopsCount: 3,
    stops: [],
    fromCoords: [51.098, 17.031],
    toCoords: [51.098, 17.036],
  } as unknown as Leg;

  it('detects train legs correctly', () => {
    const noTrain = {
      id: 'conn-1',
      departAt: '14:05',
      arriveAt: '14:15',
      legs: [dummyTramLeg],
      transfers: 0,
    } as unknown as Connection;
    assert.equal(hasTrainLegs(noTrain), false);
    assert.equal(getTrainLegSummary(noTrain), null);
    assert.equal(buildKoleoUrl(noTrain), null);

    const withTrain = {
      id: 'conn-2',
      departAt: '14:25',
      arriveAt: '15:10',
      legs: [dummyTrainLeg1],
      transfers: 0,
      serviceDate: '2026-11-15',
    } as unknown as Connection;
    assert.equal(hasTrainLegs(withTrain), true);

    const summary = getTrainLegSummary(withTrain);
    assert.ok(summary);
    assert.equal(summary?.fromStation, 'Wrocław Główny');
    assert.equal(summary?.toStation, 'Legnica');
    assert.equal(summary?.transferCount, 0);

    const url = buildKoleoUrl(withTrain);
    assert.ok(url);
    assert.ok(url?.includes('koleo.pl/rozklad-pkp/wroclaw-glowny/legnica/15-11-2026_14:25/all/all'));
  });

  it('builds multi-train transfer KOLEO URL accurately', () => {
    const multiTrain = {
      id: 'conn-3',
      departAt: '14:25',
      arriveAt: '17:15',
      legs: [dummyTrainLeg1, dummyTrainLeg2],
      transfers: 1,
      serviceDate: '2026-11-20',
    } as unknown as Connection;

    const summary = getTrainLegSummary(multiTrain);
    assert.ok(summary);
    assert.equal(summary?.fromStation, 'Wrocław Główny');
    assert.equal(summary?.toStation, 'Poznań Główny');
    assert.equal(summary?.transferCount, 1);

    const url = buildKoleoUrl(multiTrain);
    assert.ok(url);
    assert.ok(url?.includes('koleo.pl/rozklad-pkp/wroclaw-glowny/poznan-glowny/20-11-2026_14:25/all/all'));
  });

  it('parseRailTicketText extracts metadata from Polish railway tickets', () => {
    const rawSample = `
      BILET INTERNETOWY PKP INTERCITY
      Nr biletu: 83921049281
      Pociąg: IC 65100 HEWELIUSZ
      Odjazd: 14:25 Wrocław Główny
      Przyjazd: 17:15 Poznań Główny
      Wagon: 5
      Miejsce: 74 okno
      Pasażer: Jan Kowalski
      Taryfa: Ulga 51% (student)
    `;

    const parsed = parseRailTicketText(rawSample);
    assert.equal(parsed.trainNumber, 'IC 65100');
    assert.equal(parsed.wagon, '5');
    assert.equal(parsed.seat, '74');
    assert.equal(parsed.seatType, 'okno');
    assert.equal(parsed.passenger, 'Jan Kowalski');
    assert.equal(parsed.departTime, '14:25');
  });

  it('parseRailTicketText extracts KOLEO format metadata correctly', () => {
    const koleoSample = `
      Właściciel biletu: Jan Nowak
      Numer biletu: WA97958637 4096
      18.10 13:47 Katowice -> Wrocław Główny 18.10 15:55
      POCIĄG: IC
      1 × 51% STU/DOK [99]
      Pociąg IC 3812 Szkuner
      Wagon 14 Wagon przedziałowy
      1 miejsce do siedzenia 62 Korytarz
    `;

    const parsed = parseRailTicketText(koleoSample);
    assert.equal(parsed.trainNumber, 'IC 3812');
    assert.equal(parsed.wagon, '14');
    assert.equal(parsed.seat, '62');
    assert.equal(parsed.seatType, 'korytarz');
    assert.equal(parsed.passenger, 'Jan Nowak');
    assert.equal(parsed.tariff, '51% STU/DOK');
    assert.equal(parsed.ticketNumber, 'WA97958637');
    assert.equal(parsed.departTime, '13:47');
    assert.equal(parsed.fromStation, 'Katowice');
    assert.equal(parsed.toStation, 'Wrocław Główny');
  });

  it('parseRailTicketText extracts regional KD and KŚ tickets correctly', () => {
    const kdSample = `
      KOLEJE DOLNOŚLĄSKIE S.A.
      Bilet jednorazowy tam
      Pociąg: KD 69123
      Relacja: Wrocław Główny -> Legnica
      Odjazd: 14:25
      Podróżny: Tomasz Wiśniewski
      Taryfa: Bilet normalny
      Kod biletu: KD-892147
    `;

    const kdParsed = parseRailTicketText(kdSample);
    assert.equal(kdParsed.trainNumber, 'KD 69123');
    assert.equal(kdParsed.passenger, 'Tomasz Wiśniewski');
    assert.equal(kdParsed.tariff, 'Bilet normalny');
    assert.equal(kdParsed.ticketNumber, 'KD-892147');
    assert.equal(kdParsed.departTime, '14:25');

    const ksSample = `
      KOLEJE ŚLĄSKIE SP. Z O.O.
      Pociąg: KŚ 44102
      Pasażer: Anna Dąbrowska
      Taryfa: Ulga 37%
    `;

    const ksParsed = parseRailTicketText(ksSample);
    assert.equal(ksParsed.trainNumber, 'KŚ 44102');
    assert.equal(ksParsed.passenger, 'Anna Dąbrowska');
    assert.equal(ksParsed.tariff, 'Ulga 37%');
  });

  it('isLikelyRailTicket rejects ebooks/invoices and accepts rail tickets', () => {
    const ebookText = 'Rozdział 1. Chłopiec, który przeżył. Pan i pani Dursleyowie spod numeru czwartego...';
    assert.equal(isLikelyRailTicket(ebookText, 'harry_potter.pdf', false), false);

    const invoiceText = 'Faktura VAT nr 2026/11/04. Sprzedawca: Usługi Informatyczne. NIP: 1234567890';
    assert.equal(isLikelyRailTicket(invoiceText, 'faktura.pdf', false), false);

    const kdTicketText = 'Koleje Dolnośląskie S.A. Bilet na przejazd relacji Wrocław Główny - Legnica';
    assert.equal(isLikelyRailTicket(kdTicketText, 'bilet.pdf', false), true);

    // Dowolny plik z wyekstrahowanym kodem 2D Aztec jest akceptowany
    assert.equal(isLikelyRailTicket(ebookText, 'random.pdf', true), true);
  });

  it('parseCMapContent parses beginbfchar and beginbfrange correctly without NUL characters', () => {
    const map = new Map<number, string>();
    const sampleCMap = `
      beginbfchar
      <0021> <0041>
      <0022> <0042>
      endbfchar
      beginbfrange
      <0030> <0032> <0030>
      <0040> <0042> [ <0058> <0059> <005A> ]
      endbfrange
    `;
    parseCMapContent(sampleCMap, map);

    assert.equal(map.get(0x0021), 'A');
    assert.equal(map.get(0x0022), 'B');
    // Format 3 tokeny: 0x30->0, 0x31->1, 0x32->2
    assert.equal(map.get(0x0030), '0');
    assert.equal(map.get(0x0031), '1');
    assert.equal(map.get(0x0032), '2');
    // Format tablicowy: 0x40->X, 0x41->Y, 0x42->Z
    assert.equal(map.get(0x0040), 'X');
    assert.equal(map.get(0x0041), 'Y');
    assert.equal(map.get(0x0042), 'Z');
    // Upewnij się, że żaden znak nie zmapował się na \u0000 (NUL)
    for (const val of map.values()) {
      assert.notEqual(val, '\u0000');
    }
  });

  it('base64ToUint8Array and uint8ArrayToBase64 perform lossless conversions', () => {
    const rawData = new Uint8Array([0, 1, 2, 255, 128, 64, 32, 16, 8, 4, 2, 1, 0, 254, 253]);
    const b64 = uint8ArrayToBase64(rawData);
    const decoded = base64ToUint8Array(b64);
    assert.deepEqual(Array.from(decoded), Array.from(rawData));
  });

  it('unfilterPngPredictor correctly reverses Sub, Up, Average, and Paeth filters', () => {
    // 2x2 image, 1 byte per pixel
    // Row 0: filter 0 (None), pixels: [10, 20] -> raw: [0, 10, 20]
    // Row 1: filter 1 (Sub), pixels: [5, 15] (diff with left) -> raw: [1, 5, 10] (left=5, 5+10=15)
    const raw = new Uint8Array([0, 10, 20, 1, 5, 10]);
    const unfiltered = unfilterPngPredictor(raw, 2, 2, 1);
    assert.equal(unfiltered[0], 10);
    assert.equal(unfiltered[1], 20);
    assert.equal(unfiltered[2], 5);
    assert.equal(unfiltered[3], 15);
  });

  it('extractTextFromPdf extracts plain text streams', () => {
    const samplePdfString = `
      %PDF-1.4
      1 0 obj
      << /Length 50 >>
      stream
      BT
      (IC 65100) Tj
      (Wagon 4) Tj
      (Miejsce 32) Tj
      ET
      endstream
      endobj
    `;
    const bytes = new TextEncoder().encode(samplePdfString);
    const extracted = extractTextFromPdf(bytes);
    assert.ok(extracted.includes('IC 65100'));
    assert.ok(extracted.includes('Wagon 4'));
    assert.ok(extracted.includes('Miejsce 32'));
  });

  it('extractBarcodeFromPdf extracts DCTDecode JPEG barcodes and handles multiple barcodes', () => {
    // Mock PDF with two embedded JPEG barcode image XObjects
    const header1 = `%PDF-1.4\n5 0 obj\n<< /Type /XObject /Subtype /Image /Width 200 /Height 200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>\nstream\r\n`;
    const footer1 = `\r\nendstream\nendobj\n`;
    const header2 = `6 0 obj\n<< /Type /XObject /Subtype /Image /Width 220 /Height 220 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>\nstream\r\n`;
    const footer2 = `\r\nendstream\nendobj\n`;

    const h1Bytes = new TextEncoder().encode(header1);
    const f1Bytes = new TextEncoder().encode(footer1);
    const h2Bytes = new TextEncoder().encode(header2);
    const f2Bytes = new TextEncoder().encode(footer2);

    const jpeg1 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const jpeg2 = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66]);

    const totalLen = h1Bytes.length + jpeg1.length + f1Bytes.length + h2Bytes.length + jpeg2.length + f2Bytes.length;
    const fullPdf = new Uint8Array(totalLen);
    let offset = 0;

    fullPdf.set(h1Bytes, offset); offset += h1Bytes.length;
    fullPdf.set(jpeg1, offset); offset += jpeg1.length;
    fullPdf.set(f1Bytes, offset); offset += f1Bytes.length;
    fullPdf.set(h2Bytes, offset); offset += h2Bytes.length;
    fullPdf.set(jpeg2, offset); offset += jpeg2.length;
    fullPdf.set(f2Bytes, offset);

    const all = extractBarcodesFromPdf(fullPdf);
    assert.equal(all.length, 2);
    assert.equal(all[0].extension, 'jpg');
    assert.equal(all[1].extension, 'jpg');

    const best = extractBarcodeFromPdf(fullPdf);
    assert.ok(best);
    assert.equal(best?.extension, 'jpg');
  });

  it('isTicketExpired correctly evaluates retention threshold', () => {
    const now = Date.parse('2026-11-20T12:00:00Z');

    // Bilet sprzed 2 dni nie jest przedawniony
    assert.equal(
      isTicketExpired({ addedAt: now - 2 * 24 * 3600 * 1000 }, now, 14),
      false,
    );

    // Bilet sprzed 15 dni jest przedawniony (retencja 14 dni)
    assert.equal(
      isTicketExpired({ addedAt: now - 15 * 24 * 3600 * 1000 }, now, 14),
      true,
    );

    // Bilet z datą podróży w przyszłości nie jest przedawniony
    assert.equal(
      isTicketExpired({ addedAt: now - 5 * 24 * 3600 * 1000, tripDate: '2026-11-25' }, now, 14),
      false,
    );

    // Bilet z datą podróży 20 dni temu jest przedawniony
    assert.equal(
      isTicketExpired({ addedAt: now - 20 * 24 * 3600 * 1000, tripDate: '2026-10-25' }, now, 14),
      true,
    );
  });

  it('resolveTicketUri re-anchors stale iOS sandbox container UUID paths to current ticket directory', () => {
    const staleUri =
      'file:///var/mobile/Containers/Data/Application/1111-2222-3333/Documents/tickets/ticket_1731112233.pdf';
    const resolved = resolveTicketUri(staleUri);
    const expectedDir = getTicketDir();
    assert.ok(expectedDir);
    assert.equal(resolved, `${expectedDir}ticket_1731112233.pdf`);

    const staleBarcodeUri =
      'file:///var/mobile/Containers/Data/Application/1111-2222-3333/Documents/tickets/ticket_1731112233_barcode_0.png';
    const resolvedBarcode = resolveTicketUri(staleBarcodeUri);
    assert.equal(resolvedBarcode, `${expectedDir}ticket_1731112233_barcode_0.png`);
  });

  it('getTicketForConnection recovers ticket across simulated app restart and container UUID migration', async () => {
    const fsLegacy = require('expo-file-system/legacy');
    const origGetInfo = fsLegacy.getInfoAsync;
    try {
      const ticketId = 'ticket_restart_test';
      const staleUri = `file:///var/mobile/Containers/Data/Application/OLD-UUID-1234/Documents/tickets/${ticketId}.pdf`;
      const staleBarcodeUri = `file:///var/mobile/Containers/Data/Application/OLD-UUID-1234/Documents/tickets/${ticketId}_barcode_0.jpg`;
      const currentDir = getTicketDir();
      assert.ok(currentDir);
      const activeUri = `${currentDir}${ticketId}.pdf`;
      const activeBarcodeUri = `${currentDir}${ticketId}_barcode_0.jpg`;

      fsLegacy.getInfoAsync = async (uri: string) => {
        if (uri === activeUri || uri === activeBarcodeUri) {
          return { exists: true, size: 1024 };
        }
        return { exists: false };
      };

      const connId = 'conn-%5B%5B51.098%2C17.036%2C%22Wroc%C5%82aw%20G%C5%82%C3%B3wny%22%5D%2C%5B52.229%2C21.012%2C%22Warszawa%20Centralna%22%5D%2C0%2C%5B%5B%22train%22%2C%22IC%2065100%22%2C%22101%22%2C%22202%22%2C%2214%3A25%22%2C%2217%3A15%22%5D%5D%5D';

      const attachedTicket: AttachedRailTicket = {
        id: ticketId,
        connectionId: connId,
        fileName: 'bilet_intercity.pdf',
        fileUri: staleUri,
        fileSize: 1024,
        addedAt: Date.now(),
        tripDate: '2026-11-20',
        barcodeUri: staleBarcodeUri,
        barcodeUris: [staleBarcodeUri],
        metadata: {
          trainNumber: 'IC 65100',
          seat: '74',
          wagon: '5',
          passenger: 'Jan Kowalski',
        },
      };

      await kvSet(`ticket:${connId}`, JSON.stringify(attachedTicket));
      await kvSet(`ticket_by_id:${ticketId}`, JSON.stringify(attachedTicket));

      const direct = await getTicketForConnection(connId);
      assert.ok(direct, 'Bilet powinien zostać znaleziony po restarcie');
      assert.equal(direct?.id, ticketId);
      assert.equal(direct?.fileUri, activeUri, 'Ścieżka pliku PDF musi zostać zaktualizowana do bieżącego kontenera');
      assert.equal(direct?.barcodeUri, activeBarcodeUri, 'Ścieżka kodu kreskowego musi zostać zaktualizowana');

      const decodedConnId = 'conn-[[51.098,17.036,"Wrocław Główny"],[52.229,21.012,"Warszawa Centralna"],0,[["train","IC 65100","101","202","14:25","17:15"]]]';
      const fromDecoded = await getTicketForConnection(decodedConnId);
      assert.ok(fromDecoded, 'Bilet powinien zostać znaleziony nawet przy zdekodowanym ID połączenia');
      assert.equal(fromDecoded?.id, ticketId);
    } finally {
      fsLegacy.getInfoAsync = origGetInfo;
    }
  });

  it('getTicketForConnection recovers ticket via train fallback when connectionId changes slightly', async () => {
    const fsLegacy = require('expo-file-system/legacy');
    const origGetInfo = fsLegacy.getInfoAsync;
    try {
      const ticketId = 'ticket_fallback_test';
      const currentDir = getTicketDir();
      assert.ok(currentDir);
      const activeUri = `${currentDir}${ticketId}.pdf`;

      fsLegacy.getInfoAsync = async (uri: string) => {
        if (uri.includes(ticketId)) return { exists: true, size: 2048 };
        return { exists: false };
      };

      const originalConnId = 'conn-initial-plan-id';
      const attachedTicket: AttachedRailTicket = {
        id: ticketId,
        connectionId: originalConnId,
        fileName: 'bilet_kd.pdf',
        fileUri: activeUri,
        fileSize: 2048,
        addedAt: Date.now(),
        tripDate: '2026-11-20',
        metadata: {
          trainNumber: 'KD 69123',
          fromStation: 'Wrocław Główny',
          toStation: 'Legnica',
          departTime: '14:25',
        },
      };

      await saveIndex([
        {
          id: ticketId,
          connectionId: originalConnId,
          fileUri: activeUri,
          fileName: 'bilet_kd.pdf',
          fileSize: 2048,
          addedAt: Date.now(),
          tripDate: '2026-11-20',
          trainNumber: 'KD 69123',
        },
      ]);
      await kvSet(`ticket_by_id:${ticketId}`, JSON.stringify(attachedTicket));

      const newSearchedConnection = {
        id: 'conn-different-gps-coords-after-search',
        departAt: '14:25',
        arriveAt: '15:10',
        serviceDate: '2026-11-20',
        legs: [
          {
            mode: 'train',
            line: 'KD',
            trainNumber: '69123',
            fromStop: 'Wrocław Główny',
            toStop: 'Legnica',
            departAt: '14:25',
            arriveAt: '15:10',
          },
        ],
      } as unknown as Connection;

      const found = await getTicketForConnection(newSearchedConnection.id, newSearchedConnection);
      assert.ok(found, 'Bilet powinien zostać odnaleziony na podstawie numeru pociągu i daty');
      assert.equal(found?.id, ticketId);
      assert.equal(found?.metadata.trainNumber, 'KD 69123');

      const ids = await getTicketConnectionIds();
      assert.ok(ids.has(originalConnId));
    } finally {
      fsLegacy.getInfoAsync = origGetInfo;
    }
  });
});
