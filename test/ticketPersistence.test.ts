import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTicketForConnection,
  saveIndex,
  getTicketDir,
  getTicketConnectionIds,
  type AttachedRailTicket,
} from '../src/services/ticketStorage';
import { kvSet } from '../src/services/storage';
import { RoutingService } from '../src/services/api';
import { setActiveCityId } from '../src/services/cityStore';
import { stableConnectionId, normalizeConnectionId } from '../src/services/routing/connectionIdentity';
import type { Connection } from '../src/types/models';

describe('Ticket Persistence & Retrieval Edge Cases', () => {
  it('recovers ticket when searching connection with realtime delay and no train token match', async () => {
    const fsLegacy = require('expo-file-system/legacy');
    const origGetInfo = fsLegacy.getInfoAsync;
    try {
      const ticketId = 'ticket_delay_no_token_match';
      const currentDir = getTicketDir();
      const activeUri = `${currentDir}${ticketId}.pdf`;

      fsLegacy.getInfoAsync = async (uri: string) => {
        if (uri.includes(ticketId)) return { exists: true, size: 2048 };
        return { exists: false };
      };

      const originalConnId = 'conn-initial-reg';
      const ticket: AttachedRailTicket = {
        id: ticketId,
        connectionId: originalConnId,
        fileName: 'ticket_reg.pdf',
        fileUri: activeUri,
        fileSize: 2048,
        addedAt: Date.now(),
        tripDate: '2026-11-08',
        metadata: {
          trainNumber: '67201',
          departTime: '14:25',
          fromStation: 'Wrocław Główny',
          toStation: 'Poznań Główny',
        },
      };

      await saveIndex([
        {
          id: ticketId,
          connectionId: originalConnId,
          fileUri: activeUri,
          fileName: 'ticket_reg.pdf',
          fileSize: 2048,
          addedAt: Date.now(),
          tripDate: '2026-11-08',
          trainNumber: '67201',
          departTime: '14:25',
          fromStation: 'Wrocław Główny',
          toStation: 'Poznań Główny',
        },
      ]);
      await kvSet(`ticket_by_id:${ticketId}`, JSON.stringify(ticket));

      // Searched connection has line: 'R' (Polregio), trainNumber not yet enriched,
      // and live delay: departAt changed from 14:25 to 14:35, scheduledDepartureSec is 14:25 (51900)
      const delayedSearchConn = {
        id: 'conn-searched-reg-delayed',
        departureSec: 14 * 3600 + 35 * 60,
        arrivalSec: 17 * 3600 + 25 * 60,
        departAt: '14:35',
        arriveAt: '17:25',
        durationMin: 170,
        fromTitle: 'Wrocław Główny',
        toTitle: 'Poznań Główny',
        departInMin: 20,
        legs: [
          {
            id: 'l1',
            mode: 'train',
            line: 'R',
            fromStop: 'Wrocław Główny',
            toStop: 'Poznań Główny',
            departAt: '14:35',
            arriveAt: '17:25',
            scheduledDepartureSec: 14 * 3600 + 25 * 60,
            scheduledArrivalSec: 17 * 3600 + 15 * 60,
          },
        ],
      } as unknown as Connection;

      const found = await getTicketForConnection(delayedSearchConn.id, delayedSearchConn);
      assert.ok(found, 'Bilet powinien zostać znaleziony mimo opóźnienia pociągu (departAt != departTime)');
      assert.equal(found?.id, ticketId);
    } finally {
      fsLegacy.getInfoAsync = origGetInfo;
    }
  });

  it('recovers ticket when stations use common abbreviations (Wrocław Gł. vs Wrocław Główny)', async () => {
    const fsLegacy = require('expo-file-system/legacy');
    const origGetInfo = fsLegacy.getInfoAsync;
    try {
      const ticketId = 'ticket_station_abbrev_test';
      const currentDir = getTicketDir();
      const activeUri = `${currentDir}${ticketId}.pdf`;

      fsLegacy.getInfoAsync = async (uri: string) => {
        if (uri.includes(ticketId)) return { exists: true, size: 2048 };
        return { exists: false };
      };

      const originalConnId = 'conn-initial-kd';
      const ticket: AttachedRailTicket = {
        id: ticketId,
        connectionId: originalConnId,
        fileName: 'ticket_kd.pdf',
        fileUri: activeUri,
        fileSize: 2048,
        addedAt: Date.now(),
        metadata: {
          trainNumber: '69123',
          departTime: '15:20',
          fromStation: 'Wrocław Gł.',
          toStation: 'Legnica',
        },
      };

      await saveIndex([
        {
          id: ticketId,
          connectionId: originalConnId,
          fileUri: activeUri,
          fileName: 'ticket_kd.pdf',
          fileSize: 2048,
          addedAt: Date.now(),
          trainNumber: '69123',
          departTime: '15:20',
          fromStation: 'Wrocław Gł.',
          toStation: 'Legnica',
        },
      ]);
      await kvSet(`ticket_by_id:${ticketId}`, JSON.stringify(ticket));

      // Searched connection has full stop name 'Wrocław Główny' and line 'D1' (no trainNumber yet on leg)
      const kdConn = {
        id: 'conn-kd-reopened',
        departureSec: 15 * 3600 + 20 * 60,
        arrivalSec: 16 * 3600 + 10 * 60,
        departAt: '15:20',
        arriveAt: '16:10',
        durationMin: 50,
        fromTitle: 'Wrocław Główny',
        toTitle: 'Legnica',
        departInMin: 30,
        legs: [
          {
            id: 'l1',
            mode: 'train',
            line: 'D1',
            fromStop: 'Wrocław Główny',
            toStop: 'Legnica',
            departAt: '15:20',
            arriveAt: '16:10',
            scheduledDepartureSec: 15 * 3600 + 20 * 60,
          },
        ],
      } as unknown as Connection;

      const found = await getTicketForConnection(kdConn.id, kdConn);
      assert.ok(found, 'Bilet powinien zostać znaleziony mimo skrótu Wrocław Gł. vs Wrocław Główny');
      assert.equal(found?.id, ticketId);
    } finally {
      fsLegacy.getInfoAsync = origGetInfo;
    }
  });

  it('preserves and recovers ticket across app exit and return to connection', async () => {
    const fsLegacy = require('expo-file-system/legacy');
    const origGetInfo = fsLegacy.getInfoAsync;
    try {
      const ticketId = 'ticket_user_exit_return_test';
      const currentDir = getTicketDir();
      const activeUri = `${currentDir}${ticketId}.pdf`;

      fsLegacy.getInfoAsync = async (uri: string) => {
        if (uri.includes(ticketId)) return { exists: true, size: 4096 };
        return { exists: false };
      };

      const connPayload = JSON.stringify([
        [51.1079, 17.0385, 'Wrocław Główny'],
        [52.4064, 16.9252, 'Poznań Główny'],
        20760,
        [['train', 'IC 65100', 'Wrocław Główny', 'Poznań Główny', '14:25', '17:15']],
      ]);
      const connectionId = `conn-${encodeURIComponent(connPayload)}`;

      const testConnection = {
        id: connectionId,
        departureSec: 14 * 3600 + 25 * 60,
        arrivalSec: 17 * 3600 + 15 * 60,
        departAt: '14:25',
        arriveAt: '17:15',
        durationMin: 170,
        fromTitle: 'Wrocław Główny',
        toTitle: 'Poznań Główny',
        departInMin: 45,
        serviceDate: '2026-11-08',
        legs: [
          {
            id: 'l1',
            mode: 'train',
            line: 'IC',
            trainNumber: '65100',
            trainName: 'HEWELIUSZ',
            railAgency: 'PKP Intercity',
            fromStop: 'Wrocław Główny',
            toStop: 'Poznań Główny',
            departAt: '14:25',
            arriveAt: '17:15',
            scheduledDepartureSec: 14 * 3600 + 25 * 60,
            scheduledArrivalSec: 17 * 3600 + 15 * 60,
          },
        ],
      } as unknown as Connection;

      // Krok 1: Użytkownik dodaje bilet PDF do połączenia pociągiem
      const ticket: AttachedRailTicket = {
        id: ticketId,
        connectionId: testConnection.id,
        fileName: 'bilet_pkp.pdf',
        fileUri: activeUri,
        fileSize: 4096,
        addedAt: Date.now(),
        tripDate: '2026-11-08',
        metadata: {
          trainNumber: 'IC 65100',
          departTime: '14:25',
          fromStation: 'Wrocław Główny',
          toStation: 'Poznań Główny',
          passenger: 'Jan Kowalski',
          wagon: '5',
          seat: '74',
        },
      };

      const stableId = stableConnectionId(testConnection);
      const normalizedId = normalizeConnectionId(testConnection.id);

      await kvSet(`ticket:${testConnection.id}`, JSON.stringify(ticket));
      await kvSet(`ticket:${normalizedId}`, JSON.stringify(ticket));
      await kvSet(`ticket:${stableId}`, JSON.stringify(ticket));
      await kvSet(`ticket_by_id:${ticketId}`, JSON.stringify(ticket));

      await saveIndex([
        {
          id: ticketId,
          connectionId: testConnection.id,
          normalizedConnectionId: normalizedId,
          stableConnectionId: stableId,
          fileUri: activeUri,
          fileName: 'bilet_pkp.pdf',
          fileSize: 4096,
          addedAt: Date.now(),
          tripDate: '2026-11-08',
          trainNumber: 'IC 65100',
          departTime: '14:25',
          fromStation: 'Wrocław Główny',
          toStation: 'Poznań Główny',
        },
      ]);

      // Route is saved to storage
      await RoutingService.saveRoute(testConnection);

      // Krok 2: Użytkownik wychodzi z aplikacji (symulacja restartu / wyczyszczenia pamięci podręcznej)
      // I wraca do połączenia:
      // Ekran szczegółów połączenia ładuje trasę przez RoutingService.getConnectionById
      const restored = await RoutingService.getConnectionById(connectionId);
      assert.ok(restored, 'Połączenie powinno zostać odzyskane z bazy po restarcie aplikacji');

      // Krok 3: Ekran pobiera bilet dla odzyskanego połączenia
      const ticketFound = await getTicketForConnection(restored.connection.id, restored.connection);
      assert.ok(ticketFound, 'Bilet musi być załadowany i widoczny po powrocie do połączenia');
      assert.equal(ticketFound?.id, ticketId);
      assert.equal(ticketFound?.metadata.wagon, '5');
      assert.equal(ticketFound?.metadata.seat, '74');

      // Krok 4: Sprawdź czy getTicketConnectionIds zawiera to połączenie
      const connIdsWithTickets = await getTicketConnectionIds();
      assert.ok(
        connIdsWithTickets.has(connectionId) ||
          connIdsWithTickets.has(normalizedId) ||
          connIdsWithTickets.has(stableId),
        'Indeks biletów musi zawierać ID połączenia, aby pokazać ikonę biletu',
      );
    } finally {
      fsLegacy.getInfoAsync = origGetInfo;
    }
  });

  it('recovers connection and ticket across active city change', async () => {
    const fsLegacy = require('expo-file-system/legacy');
    const origGetInfo = fsLegacy.getInfoAsync;
    try {
      const ticketId = 'ticket_city_switch_test';
      const currentDir = getTicketDir();
      const activeUri = `${currentDir}${ticketId}.pdf`;

      fsLegacy.getInfoAsync = async (uri: string) => {
        if (uri.includes(ticketId)) return { exists: true, size: 1024 };
        return { exists: false };
      };

      // Zapisujemy trasę w mieście Wrocław
      setActiveCityId('wroclaw');

      const intercityConn = {
        id: 'conn-intercity-wroc-warsz',
        departureSec: 10 * 3600,
        arrivalSec: 14 * 3600,
        departAt: '10:00',
        arriveAt: '14:00',
        durationMin: 240,
        fromTitle: 'Wrocław Główny',
        toTitle: 'Warszawa Centralna',
        departInMin: 60,
        legs: [
          {
            id: 'l1',
            mode: 'train',
            line: 'EIC',
            trainNumber: '1600',
            fromStop: 'Wrocław Główny',
            toStop: 'Warszawa Centralna',
            departAt: '10:00',
            arriveAt: '14:00',
          },
        ],
      } as unknown as Connection;

      await RoutingService.saveRoute(intercityConn);

      const ticket: AttachedRailTicket = {
        id: ticketId,
        connectionId: intercityConn.id,
        fileName: 'eic.pdf',
        fileUri: activeUri,
        fileSize: 1024,
        addedAt: Date.now(),
        metadata: {
          trainNumber: 'EIC 1600',
          departTime: '10:00',
          fromStation: 'Wrocław Główny',
          toStation: 'Warszawa Centralna',
        },
      };

      await kvSet(`ticket:${intercityConn.id}`, JSON.stringify(ticket));
      await kvSet(`ticket_by_id:${ticketId}`, JSON.stringify(ticket));

      // User przełącza aktywne miasto na Kraków i otwiera trasę po identyfikatorze
      setActiveCityId('krakow');

      const retrieved = await RoutingService.getConnectionById(intercityConn.id);
      assert.ok(retrieved, 'Trasa powinna zostać odnaleziona nawet jeśli aktywne miasto się zmieniło');

      const ticketRetrieved = await getTicketForConnection(retrieved.connection.id, retrieved.connection);
      assert.ok(ticketRetrieved, 'Bilet musi być dostępny po przełączeniu miasta');
      assert.equal(ticketRetrieved?.id, ticketId);
    } finally {
      fsLegacy.getInfoAsync = origGetInfo;
    }
  });
});
