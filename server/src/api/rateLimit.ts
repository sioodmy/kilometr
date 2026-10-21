import rateLimit from 'express-rate-limit';

/**
 * Sufit ruchu na klienta dla publicznego API. Jedna instancja obsługuje
 * telefon i LAN, a część tras jest ciężka (wysyłka archiwum GTFS, planowanie
 * połączeń), więc bez limitu jedno zapętlone żądanie zajmuje proces.
 * 300 żądań na minutę z jednego IP to zapas dla normalnego używania aplikacji.
 */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate-limited' },
});
