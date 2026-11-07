import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slugifyStation, buildKoleoUrl, getTrainLegSummary, hasTrainLegs } from '../src/services/ticketing';
import { parseRailTicketText, extractTextFromPdf } from '../src/services/ticketParser';
import { isTicketExpired } from '../src/services/ticketStorage';
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
    fromStop: 'Krzyki',
    toStop: 'Dworzec Główny',
    departAt: '14:00',
    arriveAt: '14:15',
    stopsCount: 5,
    stops: [],
    fromCoords: [51.08, 17.01],
    toCoords: [51.098, 17.036],
  } as unknown as Leg;

  it('detects train legs correctly', () => {
    const tramOnly = {
      id: 'conn-1',
      departAt: '14:00',
      arriveAt: '14:15',
      legs: [dummyTramLeg],
      transfers: 0,
    } as unknown as Connection;
    assert.equal(hasTrainLegs(tramOnly), false);
    assert.equal(getTrainLegSummary(tramOnly), null);
    assert.equal(buildKoleoUrl(tramOnly), null);

    const withTrain = {
      id: 'conn-2',
      departAt: '14:00',
      arriveAt: '15:10',
      legs: [dummyTramLeg, dummyTrainLeg1],
      transfers: 1,
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
});
