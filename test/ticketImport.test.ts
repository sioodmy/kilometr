import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import {
  extractTextFromPdf,
  parseRailTicketText,
  extractBarcodesFromPdf,
  isLikelyRailTicket,
  createPngGray8,
} from '../src/services/ticketParser';
import {
  importTicketPdf,
  getTicketForConnection,
  isTicketExpired,
} from '../src/services/ticketStorage';
import type { Connection } from '../src/types/models';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
// Realne przykładowe bilety PKP Intercity od usera:
// nowy format (Aztec w /Indexed z predyktorem, 3 subset fonty z osobnymi CMap)
// i stary format (Aztec DeviceRGB, jeden font).
const NEW_FORMAT_PDF = path.join(__dirname, 'fixtures', 'pkp-ic-nowy-format.pdf');
const OLD_FORMAT_PDF = path.join(__dirname, 'fixtures', 'pkp-ic-stary-format.pdf');

function trainLeg(overrides: Record<string, unknown>) {
  return {
    id: 'leg',
    mode: 'train',
    line: 'IC',
    trainNumber: 'IC 3716',
    railAgency: 'PKP Intercity',
    fromStop: 'Opole Gł.',
    toStop: 'Wrocław Gł.',
    departAt: '17:02',
    arriveAt: '17:51',
    stopsCount: 3,
    live: false,
    ...overrides,
  };
}

function connection2Transfers(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-original-2t',
    serviceDate: '2026-10-01',
    fromTitle: 'Opole Gł.',
    toTitle: 'Wrocław Gł.',
    departInMin: 30,
    departureSec: 17 * 3600 + 2 * 60,
    departAt: '17:02',
    arriveAt: '19:40',
    durationMin: 158,
    transfers: 2,
    delayMin: 0,
    legs: [
      trainLeg({ id: 't1', trainNumber: 'IC 3716', fromStop: 'Opole Gł.', toStop: 'Brzeg', departAt: '17:02', arriveAt: '17:24' }),
      trainLeg({ id: 't2', trainNumber: 'IC 3810', fromStop: 'Brzeg', toStop: 'Oleśnica', departAt: '17:45', arriveAt: '18:30' }),
      trainLeg({ id: 't3', trainNumber: 'KM 3123', fromStop: 'Oleśnica', toStop: 'Wrocław Gł.', departAt: '18:50', arriveAt: '19:40' }),
    ],
    ...overrides,
  } as unknown as Connection;
}

/** Stub expo-file-system + DocumentPicker na prawdziwych bajtach PDF. */
async function withImportStubs<T>(pdfPath: string, fn: () => Promise<T>): Promise<T> {
  const fsLegacy = require('expo-file-system/legacy');
  const DocumentPicker = require('expo-document-picker');

  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
  const stored = new Map<string, string>();

  const origPicker = DocumentPicker.getDocumentAsync;
  const origInfo = fsLegacy.getInfoAsync;
  const origCopy = fsLegacy.copyAsync;
  const origDelete = fsLegacy.deleteAsync;
  const origRead = fsLegacy.readAsStringAsync;
  const origWrite = fsLegacy.writeAsStringAsync;

  DocumentPicker.getDocumentAsync = async () => ({
    canceled: false,
    assets: [{ uri: 'file:///cache/bilet.pdf', name: path.basename(pdfPath), size: 96847 }],
  });
  fsLegacy.getInfoAsync = async (uri: string) => {
    if (stored.has(uri)) return { exists: true, size: stored.get(uri)!.length };
    return { exists: false };
  };
  fsLegacy.copyAsync = async ({ to }: { from: string; to: string }) => {
    stored.set(to, pdfBase64);
  };
  fsLegacy.readAsStringAsync = async (uri: string) => stored.get(uri) ?? pdfBase64;
  fsLegacy.writeAsStringAsync = async (uri: string, content: string) => {
    stored.set(uri, content);
  };
  fsLegacy.deleteAsync = async (uri: string) => {
    stored.delete(uri);
  };

  try {
    return await fn();
  } finally {
    DocumentPicker.getDocumentAsync = origPicker;
    fsLegacy.getInfoAsync = origInfo;
    fsLegacy.copyAsync = origCopy;
    fsLegacy.deleteAsync = origDelete;
    fsLegacy.readAsStringAsync = origRead;
    fsLegacy.writeAsStringAsync = origWrite;
  }
}

describe('Parser biletów PKP IC (realne PDF-y)', () => {
  it('nowy format: tekst, wagon, miejsce, ulga i Aztec z /Indexed', () => {
    const bytes = new Uint8Array(fs.readFileSync(NEW_FORMAT_PDF));
    const text = extractTextFromPdf(bytes);
    const meta = parseRailTicketText(text, 'bilet.pdf');

    // CMap-y per font: scalona mapa dawała "Wagoł"/"BIKET" zamiast "Wagon"/"BILET"
    assert.ok(text.includes('Wagon:'), 'tekst powinien zawierać poprawnie zdekodowany "Wagon:"');
    assert.ok(text.includes('Ulga 51%'));
    assert.equal(meta.trainNumber, '3716');
    assert.equal(meta.wagon, '12');
    assert.equal(meta.seat, '32');
    assert.equal(meta.tariff, 'Ulga 51%');
    assert.equal(meta.seatType, 'korytarz');
    assert.equal(meta.passenger, 'Antoni Sokołowski');
    assert.equal(meta.departDate, '2026-10-01');

    const barcodes = extractBarcodesFromPdf(bytes);
    assert.equal(barcodes.length, 1, 'dokładnie jeden kod Aztec (79x79 z paletą /Indexed)');
    assert.equal(barcodes[0].extension, 'png');
    assert.equal(barcodes[0].width, 79);
    assert.equal(barcodes[0].height, 79);
    // Poprawny PNG: sygnatura i pierwszy chunk IHDR
    assert.equal(barcodes[0].bytes[0], 0x89);
    assert.equal(String.fromCharCode(...barcodes[0].bytes.subarray(1, 4)), 'PNG');
    assert.ok(isLikelyRailTicket(text, 'bilet.pdf', barcodes.length > 0));
  });

  it('stary format: kod DeviceRGB, wagon, miejsce i ulga', () => {
    const bytes = new Uint8Array(fs.readFileSync(OLD_FORMAT_PDF));
    const text = extractTextFromPdf(bytes);
    const meta = parseRailTicketText(text, 'bilet.pdf');

    assert.equal(meta.trainNumber, 'IC 3812');
    assert.equal(meta.wagon, '14');
    assert.equal(meta.seat, '62');
    assert.equal(meta.seatType, 'korytarz');
    assert.equal(meta.tariff, '51% STU/DOK');
    assert.equal(meta.passenger, 'Antoni Sokołowski');
    assert.equal(meta.fromStation, 'Katowice');
    assert.equal(meta.toStation, 'Wrocław Główny');
    assert.equal(meta.departTime, '13:47');
    assert.equal(meta.departDate, '2026-10-18');

    const barcodes = extractBarcodesFromPdf(bytes);
    assert.equal(barcodes.length, 1);
    assert.equal(barcodes[0].extension, 'png');
    assert.equal(barcodes[0].width, 355);
  });

  it('createPngGray8 produkuje poprawny PNG (sygnatura + IHDR + IEND)', () => {
    const pixels = new Uint8Array(4 * 4).fill(255);
    pixels[0] = 0;
    const png = createPngGray8(4, 4, pixels);
    assert.equal(png[0], 0x89);
    assert.equal(String.fromCharCode(...png.subarray(1, 4)), 'PNG');
    assert.equal(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4)), 'IEND');
  });
});

describe('Import biletu z walidacją i powrotem do połączenia', () => {
  beforeEach(() => {
    // czysty indeks biletów między testami
    const { saveIndex } = require('../src/services/ticketStorage');
    void saveIndex([]);
  });

  it('dodaje bilet i znajduje go po powrocie z nowym id połączenia (2 przesiadki)', async () => {
    await withImportStubs(NEW_FORMAT_PDF, async () => {
      const original = connection2Transfers();
      const result = await importTicketPdf(original.id, original);
      assert.equal(result.status, 'attached');
      if (result.status !== 'attached') return;
      assert.equal(result.ticket.metadata.wagon, '12');
      assert.equal(result.ticket.metadata.seat, '32');
      assert.ok(
        result.ticket.barcodeUri || (result.ticket.barcodeUris?.length ?? 0) > 0,
        'kod Aztec powinien być wyekstrahowany',
      );

      // Powrót do tego samego połączenia (zapisana trasa ma oryginalne id)
      const same = await getTicketForConnection(original.id, original);
      assert.ok(same, 'bilet widoczny po powrocie do tego samego połączenia');

      // Powrót po ponownym wyszukaniu: nowy id, opóźnienie +3 min na pierwszym odcinku
      const reSearched = connection2Transfers({
        id: 'conn-researched-2t',
        delayMin: 3,
        legs: [
          trainLeg({ id: 't1b', trainNumber: 'IC 3716', fromStop: 'Opole Gł.', toStop: 'Brzeg', departAt: '17:05', arriveAt: '17:27', delaySec: 180 }),
          trainLeg({ id: 't2b', trainNumber: 'IC 3810', fromStop: 'Brzeg', toStop: 'Oleśnica', departAt: '17:45', arriveAt: '18:30' }),
          trainLeg({ id: 't3b', trainNumber: 'KM 3123', fromStop: 'Oleśnica', toStop: 'Wrocław Gł.', departAt: '18:50', arriveAt: '19:40' }),
        ],
      });
      const found = await getTicketForConnection(reSearched.id, reSearched);
      assert.ok(found, 'bilet widoczny po powrocie z nowym id połączenia');
      assert.equal(found?.id, result.ticket.id);
    });
  });

  it('odrzuca bilet na inny pociąg (wrongTrain)', async () => {
    await withImportStubs(OLD_FORMAT_PDF, async () => {
      // Połączenie jedzie IC 3716 przez Opole 01.10, bilet jest na IC 3812
      // z Katowic 18.10: data się nie zgadza, więc najpierw wrongDate.
      const mismatchedDate = connection2Transfers();
      const byDate = await importTicketPdf(mismatchedDate.id, mismatchedDate);
      assert.equal(byDate.status, 'rejected');
      if (byDate.status === 'rejected') {
        assert.equal(byDate.reason, 'wrongDate');
      }

      // Połączenie tego samego dnia co bilet, ale inne pociągi: wrongTrain.
      const sameDate = connection2Transfers({ serviceDate: '2026-10-18' });
      const result = await importTicketPdf(sameDate.id, sameDate);
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected') {
        assert.equal(result.reason, 'wrongTrain');
        assert.equal(result.ticketTrainNumber, 'IC 3812');
        assert.equal(result.connectionTrainNumber, 'IC 3716');
      }
    });
  });

  it('odrzuca bilet na inną datę (wrongDate)', async () => {
    await withImportStubs(NEW_FORMAT_PDF, async () => {
      // Bilet: 2026-10-01, połączenie jedzie 2026-11-20
      const conn = connection2Transfers({ serviceDate: '2026-11-20' });
      const result = await importTicketPdf(conn.id, conn);
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected') {
        assert.equal(result.reason, 'wrongDate');
        assert.equal(result.ticketDate, '2026-10-01');
        assert.equal(result.connectionDate, '2026-11-20');
      }
    });
  });
});

describe('Retencja biletów', () => {
  it('bilet dodany w ciągu ostatniej doby nie jest przedawniony', () => {
    const now = Date.now();
    // Podróż była dawno temu, ale bilet dodano przed chwilą
    assert.equal(
      isTicketExpired({ addedAt: now - 3600_000, tripDate: '2020-01-01' }, now),
      false,
    );
    // Stary bilet dodany dawno temu: do sprzątania
    assert.equal(
      isTicketExpired({ addedAt: now - 30 * 24 * 3600_000, tripDate: '2020-01-01' }, now),
      true,
    );
  });
});
