/**
 * Zweryfikowane z GTFS wskazówki dla najbardziej złożonych węzłów przesiadkowych
 * (wielopoziomowe ronda, wykop, tunele, podziemne terminale, wyspy tramwajowe),
 * których geometrii 3D/poziomów nie da się wiarygodnie odczytać z samego 2D OSM.
 *
 * ZASADA BEZPIECZEŃSTWA:
 * Każdy wpis MUSI posiadać `expectedName`. Generator twardo weryfikuje, że klucz
 * istnieje w aktualnym GTFS i że jego nazwa przystanku zgadza się z `expectedName`.
 * Dzięki temu rozjazd stop_id / halucynacja z pamięci są niemożliwe.
 */

export const VERIFIED_HUB_OVERRIDES = {
  warszawa: {
    // --- Centrum (7013xx) ---
    '701301': { expectedName: 'Centrum', hint: 'Przystanek autobusowy na ul. Marszałkowskiej przy rondzie Dmowskiego, po stronie hotelu Novotel.' },
    '701302': { expectedName: 'Centrum', hint: 'Przystanek autobusowy na ul. Marszałkowskiej przed Domami Towarowymi Wars Sawa Junior.' },
    '701303': { expectedName: 'Centrum', hint: 'Przystanek autobusowy na ul. Marszałkowskiej od strony wejścia na patelnię i do metra Centrum.' },
    '701306': { expectedName: 'Centrum', hint: 'Przystanek autobusowy w Al. Jerozolimskich po północnej stronie, od strony Pałacu Kultury.' },
    '701307': { expectedName: 'Centrum', hint: 'Peron tramwajowy na wysepce ul. Marszałkowskiej od strony południowej przy rondzie Dmowskiego.' },
    '701308': { expectedName: 'Centrum', hint: 'Peron tramwajowy na wysepce ul. Marszałkowskiej przy Rotundzie, zejście z przejścia podziemnego.' },
    '701309': { expectedName: 'Centrum', hint: 'Peron tramwajowy na wysepce Al. Jerozolimskich od strony hotelu Novotel przy rondzie Dmowskiego.' },
    '701310': { expectedName: 'Centrum', hint: 'Peron tramwajowy na wysepce Al. Jerozolimskich przy Rotundzie, zejście z przejścia podziemnego.' },
    '701315': { expectedName: 'Centrum', hint: 'Przystanek autobusowy w Al. Jerozolimskich po stronie hotelu Novotel, za rondem Dmowskiego.' },

    // --- Dw. Centralny (7002xx) ---
    '700201': { expectedName: 'Dw. Centralny', hint: 'Przystanek autobusowy w Al. Jerozolimskich po stronie hotelu Marriott, naprzeciwko hali dworca.' },
    '700202': { expectedName: 'Dw. Centralny', hint: 'Przystanek autobusowy w Al. Jerozolimskich bezpośrednio przed głównym wejściem do Dworca Centralnego.' },
    '700204': { expectedName: 'Dw. Centralny', hint: 'Przystanek autobusowy przy al. Jana Pawła II obok Dworca Centralnego i Złotych Tarasów.' },
    '700205': { expectedName: 'Dw. Centralny', hint: 'Przystanek autobusowy na ul. Chałubińskiego za skrzyżowaniem z Al. Jerozolimskimi, przy hotelu Marriott.' },
    '700207': { expectedName: 'Dw. Centralny', hint: 'Peron tramwajowy na wysepce Al. Jerozolimskich przed Dworcem Centralnym, dojście z przejścia podziemnego.' },
    '700208': { expectedName: 'Dw. Centralny', hint: 'Peron tramwajowy na wysepce Al. Jerozolimskich przed Dworcem Centralnym, dojście z przejścia podziemnego.' },
    '700209': { expectedName: 'Dw. Centralny', hint: 'Peron tramwajowy na wysepce al. Jana Pawła II przy rondzie Czterdziestolatka, obok hali dworca.' },
    '700210': { expectedName: 'Dw. Centralny', hint: 'Peron tramwajowy na wysepce al. Jana Pawła II obok Złotych Tarasów, dojście z przejścia podziemnego.' },
    '700211': { expectedName: 'Dw. Centralny', hint: 'Przystanek autobusowy na ul. Emilii Plater obok Złotych Tarasów i Dworca Centralnego.' },
    '700212': { expectedName: 'Dw. Centralny', hint: 'Przystanek autobusowy na ul. Emilii Plater na wysokości Złotych Tarasów, naprzeciwko PKiN.' },
    '700221': { expectedName: 'Dw. Centralny', hint: 'Stanowisko na pętli autobusowej między Dworcem Centralnym a centrum handlowym Złote Tarasy.' },
    '700223': { expectedName: 'Dw. Centralny', hint: 'Stanowisko na pętli autobusowej między Dworcem Centralnym a centrum handlowym Złote Tarasy.' },
    '700225': { expectedName: 'Dw. Centralny', hint: 'Stanowisko na pętli autobusowej między Dworcem Centralnym a centrum handlowym Złote Tarasy.' },
    '700227': { expectedName: 'Dw. Centralny', hint: 'Stanowisko na pętli autobusowej między Dworcem Centralnym a centrum handlowym Złote Tarasy.' },
    '700229': { expectedName: 'Dw. Centralny', hint: 'Stanowisko na pętli autobusowej między Dworcem Centralnym a centrum handlowym Złote Tarasy.' },

    // --- Pl. Bankowy (7016xx) ---
    '701602': { expectedName: 'Pl. Bankowy', hint: 'Przystanek autobusowy na pl. Bankowym przed Ratuszem, blisko wyjścia z metra Ratusz Arsenał.' },
    '701603': { expectedName: 'Pl. Bankowy', hint: 'Przystanek autobusowy na pl. Bankowym po stronie Ratusza i Urzędu Wojewódzkiego.' },
    '701604': { expectedName: 'Pl. Bankowy', hint: 'Przystanek autobusowy na pl. Bankowym po stronie Błękitnego Wieżowca.' },
    '701607': { expectedName: 'Pl. Bankowy', hint: 'Peron tramwajowy na wysepce pl. Bankowego po stronie Ratusza.' },
    '701608': { expectedName: 'Pl. Bankowy', hint: 'Peron tramwajowy na wysepce pl. Bankowego po stronie Błękitnego Wieżowca.' },

    // --- Pl. Na Rozdrożu (7037xx — zgłaszany przez użytkownika!) ---
    '703701': { expectedName: 'Pl. Na Rozdrożu', hint: 'Przystanek autobusowy na górnym poziomie w Al. Ujazdowskich po stronie parku Ujazdowskiego.' },
    '703702': { expectedName: 'Pl. Na Rozdrożu', hint: 'Przystanek autobusowy na górnym poziomie w Al. Ujazdowskich po stronie Zamku Ujazdowskiego.' },
    '703705': { expectedName: 'Pl. Na Rozdrożu', hint: 'Przystanek autobusowy w wykopie Trasy Łazienkowskiej (al. Armii Ludowej), zejście schodami lub windą z placu.' },
    '703706': { expectedName: 'Pl. Na Rozdrożu', hint: 'Przystanek autobusowy w wykopie Trasy Łazienkowskiej (al. Armii Ludowej), zejście schodami lub windą z placu.' },

    // --- Dolna (3027xx — zgłaszany przez użytkownika!) ---
    '302701': { expectedName: 'Dolna', hint: 'Wspólny peron tramwajowo-autobusowy na środku ul. Belwederskiej przed skrzyżowaniem z ul. Dolną.' },
    '302702': { expectedName: 'Dolna', hint: 'Wspólny peron tramwajowo-autobusowy na środku ul. Sobieskiego za skrzyżowaniem z ul. Dolną.' },
    '302703': { expectedName: 'Dolna', hint: 'Przystanek autobusowy na ul. Chełmskiej za skrzyżowaniem z ul. Sobieskiego.' },
    '302704': { expectedName: 'Dolna', hint: 'Przystanek autobusowy na ul. Dolnej za skrzyżowaniem z ul. Belwederską.' },

    // --- Rondo Daszyńskiego (5040xx) ---
    '504001': { expectedName: 'Rondo Daszyńskiego', hint: 'Przystanek autobusowy na ul. Prostej przy wyjściu z metra Rondo Daszyńskiego.' },
    '504002': { expectedName: 'Rondo Daszyńskiego', hint: 'Przystanek autobusowy na ul. Prostej przed biurowcem Warsaw Spire, przy wyjściu z metra.' },
    '504005': { expectedName: 'Rondo Daszyńskiego', hint: 'Peron tramwajowy na wysepce ul. Towarowej przed rondem, po stronie biurowca Warsaw Unit.' },
    '504006': { expectedName: 'Rondo Daszyńskiego', hint: 'Peron tramwajowy na wysepce ul. Towarowej za rondem, przy wyjściu z metra.' },
    '504007': { expectedName: 'Rondo Daszyńskiego', hint: 'Peron tramwajowy na wysepce ul. Prostej przy biurowcu The Warsaw Hub i wyjściu z metra.' },
    '504008': { expectedName: 'Rondo Daszyńskiego', hint: 'Peron tramwajowy na wysepce ul. Prostej przy biurowcu Warsaw Spire i wyjściu z metra.' },

    // --- Rondo ONZ (7088xx) ---
    '708801': { expectedName: 'Rondo ONZ', hint: 'Przystanek autobusowy przy al. Jana Pawła II za rondem ONZ, po stronie wyjścia z metra.' },
    '708802': { expectedName: 'Rondo ONZ', hint: 'Przystanek autobusowy przy al. Jana Pawła II za rondem ONZ, po stronie biurowca Rondo 1.' },
    '708803': { expectedName: 'Rondo ONZ', hint: 'Peron tramwajowy na wysepce al. Jana Pawła II za rondem ONZ, przy wyjściu z metra.' },
    '708804': { expectedName: 'Rondo ONZ', hint: 'Peron tramwajowy na wysepce al. Jana Pawła II za rondem ONZ, przy biurowcu Rondo 1.' },
    '708805': { expectedName: 'Rondo ONZ', hint: 'Przystanek autobusowy na ul. Świętokrzyskiej przy rondzie ONZ i wyjściu z metra.' },
    '708806': { expectedName: 'Rondo ONZ', hint: 'Przystanek autobusowy na ul. Prostej za rondem ONZ, przy wyjściu z metra.' },
    '708808': { expectedName: 'Rondo ONZ', hint: 'Peron tramwajowy na wysepce ul. Prostej za rondem ONZ, przy wyjściu z metra.' },

    // --- Metro Młociny (6059xx) ---
    '605901': { expectedName: 'Metro Młociny', hint: 'Przystanek autobusowy na ul. Kasprowicza przy południowym wyjściu z metra Młociny.' },
    '605903': { expectedName: 'Metro Młociny', hint: 'Przystanek autobusowy przy al. gen. Wittek obok pętli i wejścia do metra Młociny.' },
    '605904': { expectedName: 'Metro Młociny', hint: 'Przystanek autobusowy na ul. Nocznickiego obok pętli tramwajowej Metro Młociny.' },
    '605905': { expectedName: 'Metro Młociny', hint: 'Peron tramwajowy na węźle Metro Młociny od strony ul. Nocznickiego.' },
    '605906': { expectedName: 'Metro Młociny', hint: 'Peron tramwajowy na ul. Nocznickiego przy wyjściu z węzła Metro Młociny.' },
    '605911': { expectedName: 'Metro Młociny', hint: 'Zadaszony peron na pętli tramwajowej Metro Młociny bezpośrednio nad wyjściem z metra.' },
    '605912': { expectedName: 'Metro Młociny', hint: 'Zadaszony peron na pętli tramwajowej Metro Młociny bezpośrednio nad wyjściem z metra.' },
    '605913': { expectedName: 'Metro Młociny', hint: 'Zadaszony peron na pętli tramwajowej Metro Młociny bezpośrednio nad wyjściem z metra.' },
    '605914': { expectedName: 'Metro Młociny', hint: 'Zadaszony peron na pętli tramwajowej Metro Młociny bezpośrednio nad wyjściem z metra.' },
    '605915': { expectedName: 'Metro Młociny', hint: 'Zadaszony peron na pętli tramwajowej Metro Młociny bezpośrednio nad wyjściem z metra.' },
    '605916': { expectedName: 'Metro Młociny', hint: 'Zadaszony peron na pętli tramwajowej Metro Młociny bezpośrednio nad wyjściem z metra.' },
    '605917': { expectedName: 'Metro Młociny', hint: 'Stanowisko na zadaszonej pętli autobusowej węzła Metro Młociny przy wyjściu z metra.' },
    '605918': { expectedName: 'Metro Młociny', hint: 'Stanowisko na zadaszonej pętli autobusowej węzła Metro Młociny przy wyjściu z metra.' },
    '605919': { expectedName: 'Metro Młociny', hint: 'Stanowisko na zadaszonej pętli autobusowej węzła Metro Młociny przy wyjściu z metra.' },
    '605920': { expectedName: 'Metro Młociny', hint: 'Stanowisko na zadaszonej pętli autobusowej węzła Metro Młociny przy wyjściu z metra.' },
    '605921': { expectedName: 'Metro Młociny', hint: 'Stanowisko na zadaszonej pętli autobusowej węzła Metro Młociny przy wyjściu z metra.' },
    '605922': { expectedName: 'Metro Młociny', hint: 'Stanowisko na zadaszonej pętli autobusowej węzła Metro Młociny przy wyjściu z metra.' },
    '605923': { expectedName: 'Metro Młociny', hint: 'Stanowisko na zadaszonej pętli autobusowej węzła Metro Młociny przy wyjściu z metra.' },
    '605924': { expectedName: 'Metro Młociny', hint: 'Stanowisko na zadaszonej pętli autobusowej węzła Metro Młociny przy wyjściu z metra.' },
  },

  wroclaw: {
    // --- Pl. Grunwaldzki (Rondo Reagana — wyspa centralna + ulice dojazdowe) ---
    '20815': { expectedName: 'PL. GRUNWALDZKI', hint: 'Peron 1 na wyspie centralnej Ronda Reagana (zadaszona płyta przesiadkowa po stronie Pasażu Grunwaldzkiego).' },
    '120815': { expectedName: 'PL. GRUNWALDZKI', hint: 'Peron 1 na wyspie centralnej Ronda Reagana (wspólny peron autobusowo-tramwajowy po stronie Pasażu Grunwaldzkiego).' },
    '20824': { expectedName: 'PL. GRUNWALDZKI', hint: 'Peron 2 na wyspie centralnej Ronda Reagana (strona południowo-zachodnia w stronę mostu Grunwaldzkiego).' },
    '120824': { expectedName: 'PL. GRUNWALDZKI', hint: 'Peron 2 na wyspie centralnej Ronda Reagana (strona południowo-zachodnia w stronę mostu Grunwaldzkiego).' },
    '20820': { expectedName: 'PL. GRUNWALDZKI', hint: 'Peron 3 na wyspie centralnej Ronda Reagana (strona północna od ul. Piastowskiej i Reja).' },
    '120820': { expectedName: 'PL. GRUNWALDZKI', hint: 'Peron 3 na wyspie centralnej Ronda Reagana (strona północna od ul. Piastowskiej i Reja).' },
    '20823': { expectedName: 'PL. GRUNWALDZKI', hint: 'Peron 4 na wyspie centralnej Ronda Reagana (strona północno-wschodnia przed Pasażem Grunwaldzkim).' },
    '120823': { expectedName: 'PL. GRUNWALDZKI', hint: 'Peron 4 na wyspie centralnej Ronda Reagana (strona północno-wschodnia przed Pasażem Grunwaldzkim).' },
    '20816': { expectedName: 'PL. GRUNWALDZKI', hint: 'Peron tramwajowy na ul. Skłodowskiej-Curie obok budynku Politechniki (C-13) przed Rondem Reagana.' },
    '20855': { expectedName: 'PL. GRUNWALDZKI', hint: 'Peron tramwajowy na ul. Skłodowskiej-Curie po stronie Pasażu Grunwaldzkiego za Rondem Reagana.' },
    '20916': { expectedName: 'PL. GRUNWALDZKI', hint: 'Przystanek autobusowy na ul. Piastowskiej tuż przy wejściu do Pasażu Grunwaldzkiego.' },
    '20920': { expectedName: 'PL. GRUNWALDZKI', hint: 'Przystanek autobusowy na pl. Grunwaldzkim przy wejściu do Pasażu Grunwaldzkiego od strony mostu Szczytnickiego.' },
    '20921': { expectedName: 'PL. GRUNWALDZKI', hint: 'Przystanek autobusowy na pl. Grunwaldzkim przy Pasażu Grunwaldzkim, w pobliżu ul. Polaka.' },
    '20922': { expectedName: 'PL. GRUNWALDZKI', hint: 'Przystanek autobusowy na pl. Grunwaldzkim przy Pasażu Grunwaldzkim, w pobliżu ul. Polaka.' },

    // --- Dworzec Główny (prawdziwe kody z GTFS!) ---
    '10268': { expectedName: 'DWORZEC GŁÓWNY', hint: 'Peron tramwajowy na wysepce ul. Piłsudskiego naprzeciwko głównego budynku Dworca Głównego PKP.' },
    '20267': { expectedName: 'DWORZEC GŁÓWNY', hint: 'Peron tramwajowy na wysepce ul. Piłsudskiego bezpośrednio przed głównym budynkiem Dworca Głównego PKP.' },
    '120267': { expectedName: 'DWORZEC GŁÓWNY', hint: 'Wspólny peron autobusowo-tramwajowy na ul. Piłsudskiego bezpośrednio przed Dworcem Głównym PKP.' },
    '20362': { expectedName: 'DWORZEC GŁÓWNY', hint: 'Przystanek autobusowy na ul. Peronowej po stronie Dworca Głównego PKP.' },
    '20364': { expectedName: 'DWORZEC GŁÓWNY', hint: 'Przystanek autobusowy na ul. Peronowej naprzeciwko głównego wyjścia z Dworca Głównego PKP.' },

    // --- Galeria Dominikańska (prawdziwe kody z GTFS!) ---
    '10021': { expectedName: 'GALERIA DOMINIKAŃSKA', hint: 'Peron tramwajowy na pl. Dominikańskim bezpośrednio przed głównym wejściem do Galerii Dominikańskiej.' },
    '110021': { expectedName: 'GALERIA DOMINIKAŃSKA', hint: 'Wspólny peron na pl. Dominikańskim bezpośrednio przed głównym wejściem do Galerii Dominikańskiej.' },
    '10022': { expectedName: 'GALERIA DOMINIKAŃSKA', hint: 'Peron tramwajowy na pl. Dominikańskim naprzeciwko Galerii Dominikańskiej, od strony ul. Oławskiej.' },
    '10111': { expectedName: 'GALERIA DOMINIKAŃSKA', hint: 'Przystanek autobusowy w wykopie pl. Społecznego pod Galerią Dominikańską, zejście z przejścia podziemnego.' },
    '10123': { expectedName: 'GALERIA DOMINIKAŃSKA', hint: 'Przystanek autobusowy na ul. Kazimierza Wielkiego za Galerią Dominikańską, przed ul. Świdnicką.' },
    '10126': { expectedName: 'GALERIA DOMINIKAŃSKA', hint: 'Przystanek autobusowy na ul. Piotra Skargi naprzeciwko Galerii Dominikańskiej, obok hotelu Mercure.' },
  },

  krakow: {
    // --- Dworzec Główny Tunel (poziom -1) ---
    '901-01': { expectedName: 'Dworzec Główny Tunel', hint: 'Podziemny peron tramwajowy (poziom -1) w tunelu pod Dworcem Głównym PKP i Galerią Krakowską.' },
    '901-02': { expectedName: 'Dworzec Główny Tunel', hint: 'Podziemny peron tramwajowy (poziom -1) w tunelu pod Dworcem Głównym PKP i Galerią Krakowską.' },

    // --- Dworzec Główny Zachód (ul. Pawia) ---
    '760-01': { expectedName: 'Dworzec Główny Zachód', hint: 'Peron tramwajowy na ul. Pawiej bezpośrednio przed głównym wejściem do Galerii Krakowskiej.' },
    '760-02': { expectedName: 'Dworzec Główny Zachód', hint: 'Peron tramwajowy na ul. Pawiej po stronie Galerii Krakowskiej i hotelu Mercure.' },
    '760-03': { expectedName: 'Dworzec Główny Zachód', hint: 'Przystanek autobusowy na ul. Pawiej po zachodniej stronie, naprzeciwko Galerii Krakowskiej.' },
    '760-07': { expectedName: 'Dworzec Główny Zachód', hint: 'Przystanek autobusowy na ul. Pawiej bezpośrednio przy wejściu do Galerii Krakowskiej.' },
    '760-09': { expectedName: 'Dworzec Główny Zachód', hint: 'Przystanek autobusowy na ul. Kurniki obok Galerii Krakowskiej i pl. Jana Nowaka-Jeziorańskiego.' },

    // --- Dworzec Główny Wschód (MDA) ---
    '461-01': { expectedName: 'Dworzec Główny Wschód', hint: 'Stanowisko autobusowe na pętli przy górnej płycie dworca MDA i wschodnim wyjściu z PKP.' },
    '461-02': { expectedName: 'Dworzec Główny Wschód', hint: 'Stanowisko autobusowe na pętli przy górnej płycie dworca MDA i wschodnim wyjściu z PKP.' },

    // --- Rondo Mogilskie (poziom -1 wykop + poziom 0 rondo) ---
    '802-01': { expectedName: 'Rondo Mogilskie', hint: 'Dolny peron na płycie Ronda Mogilskiego (poziom -1), dojście schodami lub windą z ronda.' },
    '802-02': { expectedName: 'Rondo Mogilskie', hint: 'Dolny peron na płycie Ronda Mogilskiego (poziom -1), dojście schodami lub windą z ronda.' },
    '802-03': { expectedName: 'Rondo Mogilskie', hint: 'Dolny peron na płycie Ronda Mogilskiego (poziom -1) od strony al. Powstania Warszawskiego.' },
    '802-04': { expectedName: 'Rondo Mogilskie', hint: 'Dolny peron na płycie Ronda Mogilskiego (poziom -1) od strony ul. Lubicz i Sądu Okręgowego.' },
    '802-05': { expectedName: 'Rondo Mogilskie', hint: 'Dolny peron tramwajowy (poziom -1) przy wlocie tunelu KST w stronę Dworca Głównego.' },
    '802-06': { expectedName: 'Rondo Mogilskie', hint: 'Górny przystanek autobusowy na poziomie ulicy (0) przy al. Beliny-Prażmowskiego nad rondem.' },
    '802-08': { expectedName: 'Rondo Mogilskie', hint: 'Górny przystanek autobusowy na poziomie ulicy (0) przy ul. Lubomirskiego obok biurowca Unity Tower.' },

    // --- Rondo Grzegórzeckie ---
    '809-01': { expectedName: 'Rondo Grzegórzeckie', hint: 'Wspólny peron tramwajowo-autobusowy na al. Pokoju przy Rondzie Grzegórzeckim i biurowcach Błękitek.' },
    '809-02': { expectedName: 'Rondo Grzegórzeckie', hint: 'Wspólny peron tramwajowo-autobusowy na ul. Grzegórzeckiej za Rondem Grzegórzeckim.' },
    '809-03': { expectedName: 'Rondo Grzegórzeckie', hint: 'Wspólny peron tramwajowo-autobusowy na al. Powstania Warszawskiego przy Rondzie Grzegórzeckim.' },
    '809-04': { expectedName: 'Rondo Grzegórzeckie', hint: 'Wspólny peron tramwajowo-autobusowy na ul. Kotlarskiej przy wjeździe na most Kotlarski.' },

    // --- Rondo Grunwaldzkie ---
    '501-01': { expectedName: 'Rondo Grunwaldzkie', hint: 'Wspólny peron tramwajowo-autobusowy na ul. Monte Cassino przy Centrum Kongresowym ICE.' },
    '501-02': { expectedName: 'Rondo Grunwaldzkie', hint: 'Wspólny peron tramwajowo-autobusowy przy wjeździe na most Grunwaldzki obok Centrum Kongresowego ICE.' },
    '501-03': { expectedName: 'Rondo Grunwaldzkie', hint: 'Przystanek autobusowy na ul. Konopnickiej po stronie hotelu Park Inn, za Rondem Grunwaldzkim.' },
    '501-04': { expectedName: 'Rondo Grunwaldzkie', hint: 'Przystanek autobusowy na ul. Konopnickiej przy Centrum Kongresowym ICE, obok zjazdu do tunelu.' },
  },

  poznan: {
    // --- Poznań Główny ---
    'poznan-glowny01': { expectedName: 'Poznań Główny 01', hint: 'Przystanek autobusowy na ul. Dworcowej przed starym gmachem dworca PKP.' },
    'poznan-glowny02': { expectedName: 'Poznań Główny 02', hint: 'Przystanek autobusowy na ul. Dworcowej przy starym gmachu dworca PKP i Międzynarodowych Targach.' },
    'poznan-glowny41': { expectedName: 'Poznań Główny 41', hint: 'Peron tramwajowy na moście Dworcowym (ul. Matyi) przy wejściu do galerii Avenida i dworca PKP.' },
    'poznan-glowny42': { expectedName: 'Poznań Główny 42', hint: 'Peron tramwajowy na ul. Matyi przy wejściu do galerii Avenida i nowego budynku dworca PKP.' },
    'poznan-glowny73': { expectedName: 'Poznań Główny 73', hint: 'Wspólny peron tramwajowo-autobusowy na ul. Matyi naprzeciwko galerii Avenida, przy parku Marcinkowskiego.' },
    'poznan-glowny74': { expectedName: 'Poznań Główny 74', hint: 'Wspólny peron tramwajowo-autobusowy na ul. Matyi przy wyjściu z galerii Avenida i dworca PKP.' },

    // --- Dworzec Zachodni (podziemny peron PST + górny poziom) ---
    'dworzec-zachodni41': { expectedName: 'Dworzec Zachodni 41', hint: 'Dolny peron trasy PST pod ul. Głogowską, bezpośrednie przejście do tunelu peronów PKP.' },
    'dworzec-zachodni42': { expectedName: 'Dworzec Zachodni 42', hint: 'Dolny peron trasy PST pod ul. Głogowską, bezpośrednie przejście do tunelu peronów PKP.' },
    'dworzec-zachodni71': { expectedName: 'Dworzec Zachodni 71', hint: 'Górny peron tramwajowo-autobusowy na ul. Głogowskiej przed wejściem na Dworzec Zachodni PKP.' },
    'dworzec-zachodni72': { expectedName: 'Dworzec Zachodni 72', hint: 'Górny peron tramwajowo-autobusowy na ul. Głogowskiej naprzeciwko wejścia na Dworzec Zachodni PKP.' },

    // --- Rondo Kaponiera (poziom -2 PST + poziom 0 rondo) ---
    'rondo-kaponiera45': { expectedName: 'Rondo Kaponiera 45', hint: 'Podziemny peron trasy PST (poziom -2) pod Rondem Kaponiera, zejście schodami lub windą z przejścia.' },
    'rondo-kaponiera46': { expectedName: 'Rondo Kaponiera 46', hint: 'Podziemny peron trasy PST (poziom -2) pod Rondem Kaponiera, zejście schodami lub windą z przejścia.' },
    'rondo-kaponiera71': { expectedName: 'Rondo Kaponiera 71', hint: 'Górny peron tramwajowo-autobusowy na ul. Roosevelta (poziom 0) przy biurowcu Bałtyk i hotelu Sheraton.' },
    'rondo-kaponiera72': { expectedName: 'Rondo Kaponiera 72', hint: 'Górny peron tramwajowo-autobusowy na ul. Roosevelta (poziom 0) przy hotelu Mercure.' },
    'rondo-kaponiera73': { expectedName: 'Rondo Kaponiera 73', hint: 'Górny peron tramwajowo-autobusowy na ul. Święty Marcin (poziom 0) przy wyjściu z Ronda Kaponiera.' },
    'rondo-kaponiera74': { expectedName: 'Rondo Kaponiera 74', hint: 'Górny peron tramwajowo-autobusowy na ul. Święty Marcin (poziom 0) od strony hotelu Mercure.' },

    // --- Most Teatralny (dolny poziom PST + górny poziom) ---
    'most-teatralny44': { expectedName: 'Most Teatralny 44', hint: 'Peron tramwajowy na ul. Roosevelta nad wykopem PST, po stronie Teatru Nowego.' },
    'most-teatralny45': { expectedName: 'Most Teatralny 45', hint: 'Dolny peron trasy PST w wykopie pod Mostem Teatralnym, zejście schodami z wiaduktu.' },
    'most-teatralny46': { expectedName: 'Most Teatralny 46', hint: 'Dolny peron trasy PST w wykopie pod Mostem Teatralnym, zejście schodami z wiaduktu.' },
    'most-teatralny71': { expectedName: 'Most Teatralny 71', hint: 'Górny peron tramwajowo-autobusowy na ul. Roosevelta na Moście Teatralnym.' },
    'most-teatralny72': { expectedName: 'Most Teatralny 72', hint: 'Górny peron tramwajowo-autobusowy na ul. Dąbrowskiego za Mostem Teatralnym.' },
    'most-teatralny73': { expectedName: 'Most Teatralny 73', hint: 'Górny peron tramwajowo-autobusowy na ul. Fredry obok Opery i Teatru Wielkiego.' },
  },

  gzm: {
    // --- Katowice Dworzec (podziemny terminal pod Galerią Katowicką i PKP — poziom -1) ---
    '2469011-00101': { expectedName: 'Katowice Dworzec', hint: 'Stanowisko 1 na podziemnym dworcu autobusowym (poziom -1) pod Galerią Katowicką i dworcem PKP.' },
    '2469011-00102': { expectedName: 'Katowice Dworzec', hint: 'Stanowisko 2 na podziemnym dworcu autobusowym (poziom -1) pod Galerią Katowicką i dworcem PKP.' },
    '2469011-00103': { expectedName: 'Katowice Dworzec', hint: 'Stanowisko 3 na podziemnym dworcu autobusowym (poziom -1) pod Galerią Katowicką i dworcem PKP.' },
    '2469011-00104': { expectedName: 'Katowice Dworzec', hint: 'Stanowisko 4 na podziemnym dworcu autobusowym (poziom -1) pod Galerią Katowicką i dworcem PKP.' },
    '2469011-00105': { expectedName: 'Katowice Dworzec', hint: 'Stanowisko 5 na podziemnym dworcu autobusowym (poziom -1) pod Galerią Katowicką i dworcem PKP.' },
    '2469011-00106': { expectedName: 'Katowice Dworzec', hint: 'Stanowisko 6 na podziemnym dworcu autobusowym (poziom -1) pod Galerią Katowicką i dworcem PKP.' },
    '2469011-00107': { expectedName: 'Katowice Dworzec', hint: 'Stanowisko 7 na podziemnym dworcu autobusowym (poziom -1) pod Galerią Katowicką i dworcem PKP.' },
    '2469011-00108': { expectedName: 'Katowice Dworzec', hint: 'Stanowisko 8 na podziemnym dworcu autobusowym (poziom -1) pod Galerią Katowicką i dworcem PKP.' },
    '2469011-00109': { expectedName: 'Katowice Dworzec', hint: 'Stanowisko 9 na podziemnym dworcu autobusowym (poziom -1) pod Galerią Katowicką i dworcem PKP.' },
    '2469011-00110': { expectedName: 'Katowice Dworzec', hint: 'Stanowisko 10 na podziemnym dworcu autobusowym (poziom -1) pod Galerią Katowicką, odjazdy na lotnisko.' },

    // --- Katowice Rynek ---
    '2469011-00301t': { expectedName: 'Katowice Rynek Teatr Śląski', hint: 'Peron tramwajowy na Rynku bezpośrednio przed budynkiem Teatru Śląskiego.' },
    '2469011-00302t': { expectedName: 'Katowice Rynek Teatr Śląski', hint: 'Peron tramwajowy na Rynku naprzeciwko Teatru Śląskiego, od strony domu handlowego Skarbek.' },
    '2469011-00401t': { expectedName: 'Katowice Rynek', hint: 'Peron tramwajowy na Rynku przy al. Korfantego, przed domem handlowym Skarbek.' },
    '2469011-00402t': { expectedName: 'Katowice Rynek', hint: 'Peron tramwajowy na Rynku przy al. Korfantego, przed domem handlowym Zenit.' },
  },
};
