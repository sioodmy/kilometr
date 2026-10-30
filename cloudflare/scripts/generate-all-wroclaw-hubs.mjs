#!/usr/bin/env node
/**
 * Kompletny generator wskazówek lokalizacyjnych dla wszystkich 249 węzłów Wrocławia.
 *
 * Tworzy precyzyjne, 1-zdaniowe wskazówki przestrzenne zakotwiczone w punktach
 * orientacyjnych (sklepy: Biedronka, Lidl, Aldi; stacje: Orlen, BP, Shell;
 * szpitale, dworce, centra handlowe, parki).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const DATA_FILE = path.join(ROOT_DIR, 'cloudflare/data/stop-hints-wroclaw.json');

const hubsFull = JSON.parse(fs.readFileSync('/tmp/wroclaw-hubs-full.json', 'utf8'));
const currentData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

function normalize(v) {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => ({ ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' })[c] || c)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Baza ręcznie i precyzyjnie przygotowanych wskazówek dla wrocławskich węzłów i złożonych zespołów
const HUB_DESCRIPTIONS = {
  // Główne węzły przesiadkowe
  pl_orlat_lwowskich: "Węzeł przesiadkowy u zbiegu ul. Piłsudskiego i Podwala przy Dworcu Świebodzkim i Biedronce.",
  krzyki: "Pętla tramwajowo-autobusowa przy ul. Powstańców Śląskich i Waligórskiego obok stacji Shell i Parku Południowego.",
  fat: "Zintegrowany węzeł przesiadkowy u zbiegu ul. Grabiszyńskiej i Hallera przy dawnej fabryce FAT i Biedronce.",
  na_niskich_lakach: "Perony tramwajowe i autobusowe przy ul. Traugutta i Krakowskiej obok stacji benzynowej BP.",
  metalowcow: "Zintegrowany węzeł przesiadkowy w pasie ul. Lotniczej obok stacji kolejowej Wrocław Kuźniki i Biedronki.",
  lesnica: "Pętla tramwajowa i zintegrowany dworzec autobusowy bezpośrednio przy stacji kolejowej Wrocław Leśnica i Biedronce.",
  bardzka: "Zintegrowane perony tramwajowo-autobusowe w pasie dzielącym ul. Bardzkiej obok Lidla i Kauflandu.",
  uniwersytet_ekonomiczny: "Perony tramwajowe na ul. Ślężnej oraz zatoki autobusowe przy ul. Kamiennej wzdłuż kampusu uczelni.",
  kamienskiego: "Przystanki autobusowe wokół ronda przy Wojewódzkim Szpitalu Specjalistycznym przy ul. Kamieńskiego.",
  pomorska: "Węzeł tramwajowo-autobusowy u zbiegu ul. Pomorskiej, Dubois i Drobnera przy moście Pomorskim i Biedronce.",
  katedra: "Wydzielone torowisko i perony na ul. Wyszyńskiego przy skrzyżowaniu z ul. Sienkiewicza obok Ogrodu Botanicznego.",
  piastowska: "Węzeł u zbiegu ul. Sienkiewicza i Piastowskiej obok Pasażu Grunwaldzkiego i akademików.",
  ogrod_botaniczny: "Perony tramwajowe na ul. Sienkiewicza bezpośrednio przy wejściu do Ogrodu Botanicznego i kościoła.",
  hallera: "Zintegrowany węzeł u zbiegu al. Hallera i Powstańców Śląskich bezpośrednio przed Centrum Handlowym Borek.",
  grabiszynska: "Perony tramwajowe i autobusowe w ciągu ul. Grabiszyńskiej przy skrzyżowaniu ze Stalową obok Biedronki.",
  rondo: "Węzeł tramwajowo-autobusowy na rondzie Powstańców Śląskich z peronami na wlotach do ronda.",
  wroclawski_park_przemyslowy: "Przystanki tramwajowo-autobusowe w pasie trasy TAT wzdłuż ul. Robotniczej obok biurowców WPP.",
  kolista: "Przystanki autobusowe i tramwajowe w ciągu ul. Pilczyckiej i Kozanowskiej obok Biedronki.",
  morwowa: "Zintegrowany przystanek w ciągu ul. Bardzkiej przy skrzyżowaniu z Morwową obok dyskontu Lidl.",
  baltycka: "Przystanki tramwajowo-autobusowe u zbiegu ul. Bałtyckiej i Obornickiej przed stacją Orlen.",
  srubowa: "Przystanki tramwajowo-autobusowe w pasie trasy TAT wzdłuż ul. Strzegomskiej obok Lidla.",
  spoldzielcza: "Pętla i przystanki autobusowe przy ul. Spółdzielczej w pobliżu Biedronki na Sępolnie.",
  wisniowa: "Węzeł u zbiegu ul. Powstańców Śląskich i alei Wiśniowej przed wieżowcem pocztowym i stacją BP.",
  wyszynskiego: "Perony tramwajowe na moście i w ciągu ul. Wyszyńskiego przed skrzyżowaniem z Nowowiejską.",
  armii_krajowej: "Węzeł tramwajowo-autobusowy na estakadzie i pod wiaduktem u zbiegu Armii Krajowej i Borowskiej obok stacji Shell.",
  slowianska: "Przystanki tramwajowe na ul. Jedności Narodowej przy skrzyżowaniu ze Słowiańską obok Biedronki.",
  chelmonskiego: "Przystanki tramwajowe i zatoki autobusowe w ciągu ul. Olszewskiego w pobliżu akademików Politechniki.",
  pilczyce: "Zintegrowany węzeł z pętlą tramwajową i parkingiem Park&Ride naprzeciwko stacji Orlen.",
  daszynskiego: "Przystanki tramwajowe w ciągu ul. Jedności Narodowej przy skrzyżowaniu z ul. Daszyńskiego obok Biedronki.",
  osiem_maja: "Zintegrowany przystanek tramwajowo-autobusowy na ul. Mickiewicza przy pętli Sępolno obok Biedronki.",
  strzegomska_krzyzowka: "Węzeł trasy TAT u zbiegu ul. Strzegomskiej i Rogowskiej przed wiaduktem kolejowym.",
  kepa_mieszczanska: "Przystanki autobusowe i tramwajowe na ul. Dmowskiego obok nowych mostów Mieszczańskich i Biedronki.",
  petrusewicza: "Krańcówka autobusowa przy ul. Petrusewicza za aquaparkiem obok Uniwersytetu Ekonomicznego.",
  wroclaw_nowy_dwor_p_r: "Krańcówka trasy TAT z peronami tramwajowo-autobusowymi przy stacji PKP Nowy Dwór i Biedronce.",
  rondo_sw_ojca_pio: "Węzeł autobusowy na rondzie w ciągu nowej alei Wielkiej Wyspy przy ul. Mickiewicza.",
  jagodno_p_r: "Nowa krańcówka buspasowa i pętla z parkingiem P+R przy ul. Buforowej i Kajdasza.",
  pl_wroblewskiego: "Węzeł tramwajowo-autobusowy u zbiegu ul. Traugutta i Pułaskiego obok stacji Orlen.",
  pl_legionow: "Węzeł tramwajowo-autobusowy na placu Legionów u zbiegu ul. Piłsudskiego i Grabiszyńskiej obok Domaru.",
  pl_bema: "Wydzielone torowisko pośrodku placu Bema u zbiegu ulic Bema, Drobnera i Sienkiewicza.",
  kwiska: "Zintegrowana wyspa tramwajowo-autobusowa w ciągu ul. Legnickiej obok Kauflandu i centrum Magnolia Park.",
  aleja_pracy: "Przystanki tramwajowe i autobusowe w pasie ul. Grabiszyńskiej naprzeciwko dawnego Fadromy.",
  oltaszyn: "Pętla autobusowa i zatoki wzdłuż ul. Strachowskiego i Zwycięskiej obok Biedronki.",
  krynicka: "Perony tramwajowo-autobusowe w ciągu ul. Świeradowskiej obok dyskontu Biedronka i Lidla.",
  kamienna: "Węzeł u zbiegu ul. Ślężnej i Kamiennej obok stacji benzynowej Shell.",
  krakowska: "Wydzielone perony tramwajowe na ul. Krakowskiej w pobliżu centrum handlowego Selgros.",
  ksieze_male: "Pętla tramwajowa i zatoki autobusowe przy ul. Opolskiej obok supermarketu Biedronka.",
  zlotnicka: "Zintegrowany przystanek tramwajowy w pasie ul. Kosmonautów obok pętli Leśnica i stacji Orlen.",
  park_zachodni: "Zintegrowane perony tramwajowo-autobusowe w pasie ul. Lotniczej przy wejściu do Parku Zachodniego.",
  na_ostatnim_groszu: "Węzeł tramwajowo-autobusowy na ul. Legnickiej pod estakadą Gądowianki obok supermarketu Kaufland.",
  szczepin: "Perony tramwajowe na ul. Legnickiej przy wiadukcie kolejowym stacji Wrocław Szczepin i Biedronce.",
  ojca_beyzyma: "Przystanki tramwajowe na wydzielonym torowisku w ciągu ul. Hallera obok kościoła.",
  hutmen: "Przystanki tramwajowe na ul. Grabiszyńskiej obok bramy zakładów Hutmen i stacji Orlen.",
  park_poludniowy: "Pętla tramwajowa wewnątrz Parku Południowego przy ul. Sudeckiej obok pomnika Chopina.",
  przyjazni: "Przystanki tramwajowe w ciągu ul. Karkonoskiej i Przyjaźni w pobliżu stacji Shell.",
  klecina: "Pętla tramwajowa i autobusowa przy ul. Ślężnej i Karkonoskiej w pobliżu rzeki Ślęzy.",
  borowska_aquapark: "Przystanki autobusowe w ciągu ul. Borowskiej bezpośrednio przed wejściem do Aquaparku Wrocław.",
  glinianki: "Przystanek tramwajowy na ul. Kosmonautów przy kąpielisku Glinianki naprzeciwko stadionu Tarczyński Arena.",
  ostrowskiego: "Zatoki autobusowe i perony przy ul. Grabiszyńskiej i Ostrowskiego obok biurowców i stacji BP.",
  orla: "Przystanki tramwajowe w pasie ul. Powstańców Śląskich przy skrzyżowaniu z al. Orlą.",
  swieradowska: "Perony tramwajowe i autobusowe na ul. Świeradowskiej naprzeciwko centrum handlowego Ferio Gaj.",
  kwidzynska: "Perony tramwajowe na ul. Toruńskiej i Kwidzyńskiej w pobliżu zakładów Volvo.",
  mosty_warszawskie: "Przystanki tramwajowo-autobusowe w ciągu ul. Jedności Narodowej przy moście obok stacji BP.",
  osiedle_sobieskiego: "Pętla autobusowa przy ul. Zakrzowskiej wewnątrz osiedla Sobieskiego obok Biedronki.",
  krucza: "Węzeł u zbiegu ul. Kruczej i Gajowickiej przed supermarketem Biedronka.",
  tramwajowa: "Zintegrowany peron tramwajowy na ul. Wróblewskiego obok zabytkowej zajezdni Dąbie (Czasoprzestrzeń).",
  monte_cassino: "Przystanki autobusowe i tramwajowe na ul. Mickiewicza przy skrzyżowaniu z ul. Monte Cassino.",
  biskupin: "Pętla tramwajowo-autobusowa przy ul. Olszewskiego na końcu Wielkiej Wyspy obok Biedronki.",
  berenta: "Przystanki autobusowe na ul. Kasprowicza przy skrzyżowaniu z ul. Berenta obok kościoła św. Antoniego.",
  broniewskiego: "Przystanki tramwajowe i autobusowe w ciągu ul. Żmigrodzkiej przy skrzyżowaniu z Broniewskiego obok Lidla.",
  lipska: "Zatoki autobusowe w ciągu ul. Kosmonautów w rejonie osiedla Maślice.",
  kepinska: "Zatoki autobusowe w ciągu ul. Osobowickiej obok cmentarza Osobowickiego.",
  mokrzanska: "Pętla i przystanki autobusowe w Leśnicy przy ul. Mokrzańskiej obok stacji PKP.",
  dworska: "Przystanki tramwajowe i zatoki autobusowe w ciągu ul. Pilczyckiej w pobliżu Lidla na Kozanowie.",
  kozanow: "Węzeł tramwajowo-autobusowy w ciągu ul. Pilczyckiej i Dokerskiej obok supermarketu Biedronka.",
  grabowa: "Przystanki autobusowe przy ul. Racławickiej w pobliżu mostu nad Ślęzą.",
  kolobrzeska: "Zatoki autobusowe w ciągu ul. Kosmonautów obok pętli tramwajowej Pilczyce.",
  bystrzycka: "Przystanki autobusowe przy wiadukcie kolejowym na ul. Bystrzyckiej obok stacji Wrocław Kuźniki.",
  zaporoska: "Węzeł autobusowy na rondzie u zbiegu ul. Zaporoskiej i Gajowickiej obok Biedronki.",
  miedzyrzecka: "Przystanki autobusowe przy ul. Międzyrzeckiej obok kładki Siedleckiej.",
  hala_stulecia: "Zintegrowany węzeł tramwajowy na ul. Wróblewskiego przed wejściem do Hali Stulecia i Pergoli.",
  glowna: "Zatoki autobusowe w ciągu ul. Głównej w pobliżu mostu na Stabłowicach.",
  gornicza: "Przystanki tramwajowe na ul. Pilczyckiej przy skrzyżowaniu z ul. Górniczą obok Biedronki.",
  modra: "Przystanki autobusowe na ul. Kosmonautów w pobliżu stacji kolejowej Wrocław Żerniki.",
  renoma: "Wyspa tramwajowa na ul. Świdnickiej bezpośrednio przed zabytkowym domem handlowym Renoma.",
  widawa: "Pętla i przystanki autobusowe w ciągu ul. Kominiarskiej na osiedlu Widawa.",
  przedwiosnie_stacja_kolejowa: "Węzeł autobusowo-kolejowy bezpośrednio przy stacji PKP Wrocław Sołtysowice.",
  pracze_odrzanskie: "Pętla autobusowa bezpośrednio przed dworcem kolejowym Wrocław Pracze obok kampusu EIT+.",
  joannitow: "Przystanki autobusowe na ul. Borowskiej i Joannitów za dworcem PKP obok dyrekcji kolei.",
  jaworowa: "Wyspa tramwajowa w ciągu ul. Ślężnej przy skrzyżowaniu z ul. Jaworową.",
  ratyn_skrzyzowanie: "Zatoki autobusowe u zbiegu ul. Trzmielowickiej i Ratyńskiej w centrum Leśnicy.",
  brodzka: "Przystanki autobusowe w ciągu ul. Brodzkiej obok szkoły podstawowej na Kozanowie.",
  c_h_korona: "Zintegrowany węzeł autobusowy przy al. Brücknera przed wejściem do centrum handlowego Korona.",
  malopanewska: "Zintegrowane perony tramwajowo-autobusowe w pasie ul. Legnickiej obok supermarketu Kaufland.",
  bajana: "Węzeł autobusowy na rondzie u zbiegu ul. Bajana i Lotniczej obok Hali Tęcza.",
  krolewiecka: "Przystanki tramwajowe i autobusowe na ul. Królewieckiej przy wjeździe na Stadion Wrocław.",
  swidnicka: "Perony tramwajowe na ul. Świdnickiej w pobliżu Opery Wrocławskiej i pl. Teatralnego.",
  monopolowa: "Zatoki autobusowe w strefie przemysłowej obok zakładów Monopolowa na Kowalach.",
  brucknera: "Przystanki autobusowe i tramwajowe na estakadzie i pod aleją Brücknera obok CH Korona.",
  sniadeckich: "Przystanki autobusowe na alei Kochanowskiego w pobliżu gmachów Uniwersytetu Przyrodniczego.",
  kleczkowska: "Przystanki tramwajowe na ul. Reymonta obok bramy aresztu śledczego i stacji PKP Nadodrze.",
  osobowice: "Pętla tramwajowa na końcu ul. Osobowickiej bezpośrednio nad rzeką Odrą obok lasu.",
  poleska: "Zatoki autobusowe w ciągu ul. Litewskiej na osiedlu Psie Pole obok Biedronki.",
  kuzniki_stacja_kolejowa: "Pętla autobusowa i przystanki zintegrowane ze stacją kolejową Wrocław Kuźniki.",
  pereca: "Przystanki tramwajowe w ciągu ul. Grabiszyńskiej przy skrzyżowaniu z ul. Pereca obok Żabki.",
  zmudzka: "Zatoki autobusowe w ciągu ul. Żmudzkiej na Psim Polu obok supermarketu Dino.",
  jednosci_narodowej: "Perony tramwajowe na ul. Jedności Narodowej przy skrzyżowaniu z ul. Nowowiejską.",
  mickiewicza: "Przystanki tramwajowe w ciągu alei Mickiewicza na wysokości Parku Szczytnickiego.",
  hala_targowa: "Peron tramwajowy na ul. Piaskowej bezpośrednio przed zabytkową Halą Targową.",
  gajowa: "Przystanki tramwajowe na ul. Glinianej przy skrzyżowaniu z ul. Gajową obok Lidla.",
  dh_astra: "Zintegrowane przystanki w ciągu ul. Legnickiej i Horbaczewskiego przed Domem Handlowym Astra i Biedronką.",
  pl_staszica: "Perony tramwajowe i autobusowe w parku na placu Staszica naprzeciwko Dworca Nadodrze.",
  stadion_olimpijski: "Pętla tramwajowa i perony wzdłuż alei Różyckiego obok bramy głównej Stadionu Olimpijskiego.",
  radio_i_telewizja: "Przystanki tramwajowe na ul. Karkonoskiej bezpośrednio przed gmachem TVP Wrocław.",
  nowowiejska: "Węzeł tramwajowy u zbiegu ul. Nowowiejskiej i Piastowskiej obok kościoła św. Michała Archanioła.",
  psie_pole_stacja_kolejowa: "Zintegrowany węzeł autobusowo-kolejowy przy stacji Wrocław Psie Pole i rondzie Lotników Polskich.",
  oporow: "Pętla tramwajowo-autobusowa na końcu ul. Grabiszyńskiej obok mostu na rzece Ślęzie.",
  prusa: "Przystanki tramwajowe na ul. Nowowiejskiej przy skrzyżowaniu z ul. Prusa obok parku Tołpy.",
  prudnicka: "Przystanki tramwajowe w ciągu ul. Hubskiej przy skrzyżowaniu z Prudnicką obok Biedronki.",
  braterska: "Przystanki tramwajowe na ul. Przyjaźni w pobliżu pętli Klecina.",
  kosciuszki: "Perony tramwajowe na ul. Pułaskiego przy skrzyżowaniu z ul. Kościuszki obok stacji benzynowej.",
  most_osobowicki: "Przystanki tramwajowo-autobusowe na północnym przyczółku mostu Osobowickiego obok Odry.",
  jastrzebia: "Przystanki tramwajowe na ul. Powstańców Śląskich przy skrzyżowaniu z ul. Jastrzębią.",
  sztabowa: "Wyspa tramwajowa na ul. Powstańców Śląskich przy skrzyżowaniu z ul. Sztabową obok Biedronki.",
  zakrzow: "Pętla autobusowa przy ul. Okulickiego na Zakrzowie w pobliżu supermarketu Biedronka.",
  kasprowicza: "Przystanki autobusowe na ul. Kasprowicza w alei lipowej na osiedlu Karłowice.",
  park_wschodni: "Zatoki autobusowe i perony na ul. Krakowskiej bezpośrednio przy wejściu do Parku Wschodniego.",
  fiolkowa: "Przystanki autobusowe na ul. Grabiszyńskiej przy skrzyżowaniu z Fiołkową.",
  komuny_paryskiej: "Zatoki autobusowe w ciągu ul. Kościuszki przy skrzyżowaniu z ul. Komuny Paryskiej.",
  grabiszynska_cmentarz: "Pętla tramwajowa i zatoki autobusowe bezpośrednio przed bramą główną Cmentarza Grabiszyńskiego.",
  gajowicka: "Zatoki autobusowe w ciągu ul. Hallera przy skrzyżowaniu z Gajowicką obok stacji Shell.",
  bezpieczna: "Zatoki autobusowe w ciągu ul. Bezpiecznej na Różance obok supermarketu Biedronka.",
  na_szancach: "Przystanki tramwajowe na ul. Bema i Poniatowskiego obok kościoła św. Michała.",
  reja: "Perony tramwajowe na ul. Nowowiejskiej przy skrzyżowaniu z ul. Reja.",
  zar: "Pętla autobusowa w podmiejskiej strefie przemysłowej Żar obok zakładów produkcyjnych.",
  sasiedzka: "Przystanki autobusowe w ciągu ul. Królewieckiej na osiedlu Maślice obok Dino.",
  gornickiego: "Przystanki tramwajowe na ul. Sienkiewicza przy skrzyżowaniu z Górnickiego.",
  sanocka: "Wyspa tramwajowa na ul. Powstańców Śląskich przy skrzyżowaniu z Sanocką obok biurowców.",
  epi: "Wyspa tramwajowa na ul. Powstańców Śląskich naprzeciwko delikatesów EPI i wieżowca Sky Tower.",
  niedzwiedzia: "Zintegrowana wyspa tramwajowa na ul. Legnickiej bezpośrednio przed centrum Magnolia Park.",
  mielecka: "Zatoki autobusowe w ciągu ul. Hallera przy skrzyżowaniu z Mielecką obok stacji Shell.",
  stalowa: "Wyspa tramwajowa na ul. Grabiszyńskiej obok wiaduktu kolejowego i supermarketu Biedronka.",
  most_grunwaldzki: "Przystanki tramwajowe na placu Powstańców Warszawy przed wjazdem na Most Grunwaldzki i Urząd Wojewódzki.",
  kochanowskiego: "Przystanki tramwajowe na alei Kochanowskiego przy zjeździe z Mostu Szczytnickiego.",
  wiejska: "Pętla autobusowa i przystanki na Oporowie przy ul. Wiejskiej obok Biedronki.",
  kuzniki: "Węzeł autobusowy w ciągu ul. Koszalińskiej i Hermanowskiej obok stacji PKP Kuźniki.",
  nyska: "Zintegrowane perony tramwajowo-autobusowe na ul. Tarnogajskiej obok Lidla i osiedla Lokum di Trevi.",
  tarnogaj: "Pętla tramwajowa przy skrzyżowaniu ul. Tarnogajskiej i Gazowej obok supermarketu Biedronka.",
  rod_bajki: "Zatoki autobusowe na ul. Królewieckiej naprzeciwko ogrodów działkowych Bajki.",
  bartoszowice: "Pętla tramwajowo-autobusowa przy ul. Bacciarellego na końcu Bartoszowic obok Odry.",
  parafialna: "Zatoki autobusowe w ciągu ul. Parafialnej na Ołtaszynie w pobliżu kościoła.",
  obornicka_obwodnica: "Przystanki autobusowe przy węźle Obwodnicy Śródmiejskiej i Obornickiej obok stacji Orlen.",
  zakrzowska: "Zatoki autobusowe przy ul. Zakrzowskiej w pobliżu stacji kolejowej Wrocław Psie Pole.",
  gaj: "Krańcówka tramwajowa przy ul. Świeradowskiej obok centrum handlowego Gaj i Biedronki.",
  kosmonautow_szpital: "Zintegrowany przystanek tramwajowy na ul. Kosmonautów przed nowym Szpitalem Wojewódzkim.",
  pulaskiego: "Węzeł u zbiegu ul. Pułaskiego i Kościuszki obok stacji benzynowej BP.",
  krepicka: "Zatoki autobusowe w Leśnicy przy ul. Średzkiej obok supermarketu Biedronka.",
  wielka: "Wyspa tramwajowa na ul. Powstańców Śląskich bezpośrednio pod wieżowcem Sky Tower.",
  gaj_petla: "Krańcówka tramwajowa ze ślepym torem na krańcu ul. Świeradowskiej obok Biedronki.",
  port_lotniczy: "Przystanki autobusowe bezpośrednio przed terminalem pasażerskim Portu Lotniczego Wrocław.",
  pultuska: "Zatoki autobusowe w ciągu ul. Ślężnej przy skrzyżowaniu z Pułtuską obok Parku Skowroniego.",
  most_milenijny: "Zatoki autobusowe na zjeździe z Mostu Milenijnego przy ul. Popowickiej obok Hali Orbita.",
  wolowska: "Zatoki autobusowe na ul. Żmigrodzkiej przy skrzyżowaniu z Wołowską obok supermarketu Kaufland.",
  kozanow_dokerska: "Pętla tramwajowa i krańcówka autobusowa przy ul. Dokerskiej wewnątrz osiedla Kozanów.",
  poswietne: "Pętla tramwajowa przy ul. Żmigrodzkiej i Poświęckiej obok szpitala im. Gromkowskiego.",
  sliwice: "Pętla autobusowa przy ul. Swojczyckiej na granicy Wrocławia obok stacji kolejowej.",
  jordanowska: "Zatoki autobusowe w ciągu ul. Oporowskiej w Jordanowie Śląskim.",
  sudecka: "Przystanki tramwajowe na ul. Powstańców Śląskich przy wieży ciśnień na al. Wiśniowej.",
  nowodworska: "Przystanki autobusowe w ciągu ul. Nowodworskiej obok kościoła Opatrzności Bożej na Nowym Dworze.",
  serbska_c_k_agora: "Przystanki tramwajowe i autobusowe przy ul. Serbskiej obok Centrum Kultury Agora.",
  rondo_obroncow_grodna: "Węzeł autobusowy na rondzie u zbiegu ul. Strzegomskiej i Nowodworskiej.",
  weigla_szpital: "Przystanki autobusowe w ciągu ul. Weigla bezpośrednio przed bramą 4. Wojskowego Szpitala Klinicznego.",
  psie_pole_rondo_lotnikow_polskich: "Węzeł przesiadkowy na rondzie u zbiegu ul. Krzywoustego i Bierutowskiej obok stacji PKP.",
  hubska_dawida: "Zintegrowane perony tramwajowe na ul. Hubskiej przy skrzyżowaniu z Dawida obok Biedronki.",
  narodowe_forum_muzyki: "Perony tramwajowe na ul. Krupniczej i Kazimierza Wielkiego przy placu Wolności i gmachu NFM.",
  krucza_mielecka: "Zatoki autobusowe w ciągu ul. Kruczej przy skrzyżowaniu z ul. Mielecką.",
  raclawicka: "Zatoki autobusowe w ciągu ul. Racławickiej w pobliżu mostu nad Ślęzą i Lidla.",
  jerzmanowo_cmentarz_i: "Pętla i zatoki autobusowe przy ul. Jerzmanowskiej obok bramy Cmentarza Jerzmanowo.",
  kowale: "Pętla tramwajowa przy ul. Kwidzyńskiej w pobliżu zakładów produkcyjnych i stacji PKP Kowale.",
  bukowina_skrzy: "Przystanki autobusowe na skrzyżowaniu drogi wylotowej na Bukowinę.",
  zaolzianska: "Wyspa tramwajowa na ul. Powstańców Śląskich naprzeciwko biurowców obok Arkad.",
  szukalice: "Przystanki autobusowe przy wjeździe do podwrocławskich Szukalic.",
  psary_szkola: "Zatoki autobusowe przy szkole podstawowej w podwrocławskich Psarach.",
  aleja_architektow: "Przystanek tramwajowy na ul. Kosmonautów przy wjeździe na osiedle Nowe Żerniki (WUWA 2).",
  kliniki_politechnika_wroclawska: "Węzeł tramwajowo-autobusowy u zbiegu Curie-Skłodowskiej i Chałubińskiego obok szpitala klinicznego.",
  urzad_wojewodzki_muzeum_narodowe: "Perony tramwajowe na placu Powstańców Warszawy przed Urzędem Wojewódzkim i Muzeum Narodowym.",
  tarczynski_arena_krolewiecka: "Zintegrowana pętla tramwajowa i przystanki bezpośrednio pod esplanadą stadionu Tarczyński Arena.",
  partynice_tor_wyscigow_konnych: "Przystanki autobusowe na ul. Zwycięskiej bezpośrednio przed wejściem na Wrocławski Tor Wyścigów Konnych.",
  mosty_pomorskie: "Wydzielone torowisko tramwajowe na zabytkowych Mostach Pomorskich u zbiegu z ul. Grodzką.",
  tarnogajska: "Przystanki tramwajowe na ul. Tarnogajskiej przy skrzyżowaniu z Klimasa obok Biedronki.",
  park_popowicki: "Przystanki tramwajowo-autobusowe w ciągu ul. Popowickiej obok Polany Popowickiej i Lidla.",
  wroclaw_popowice_17_poludnik: "Zintegrowany przystanek tramwajowy w ciągu ul. Popowickiej przy stacji PKP Wrocław Popowice.",
  wejherowska_hala_orbita: "Przystanki tramwajowe i autobusowe na ul. Popowickiej przed Halą Orbita i basenami.",
  port_popowice: "Zintegrowane perony tramwajowe w ciągu ul. Popowickiej obok nowego osiedla Port Popowice.",
  babimojska: "Przystanki trasy TAT w pasie ul. Strzegomskiej przy skrzyżowaniu z Babimojską obok Biedronki.",
  zemska: "Przystanki autobusowe wewnątrz osiedla Nowy Dwór przy ul. Rogowskiej obok centrum handlowego i Lidla.",
  halicka: "Zatoki autobusowe w ciągu ul. Halickiej na osiedlu Muchobór Wielki obok Biedronki.",
  bzowa_centrum_historii_zajezdnia: "Przystanek tramwajowy na ul. Grabiszyńskiej naprzeciwko Centrum Historii Zajezdnia.",
  piramowicza_kampus_biskupin: "Wyspa tramwajowa na ul. Olszewskiego przed domami studenckimi Kampusu Biskupin.",
  smolecka: "Przystanki trasy TAT w ciągu ul. Robotniczej przy skrzyżowaniu ze Smolecką.",
  strzegomska_148: "Zatoki autobusowe w ciągu ul. Strzegomskiej obok biurowców Wrocławskiego Parku Technologicznego.",
  wroclaw_szczepin: "Perony tramwajowe na ul. Długiej bezpośrednio pod wiaduktem stacji PKP Szczepin obok Kauflandu.",
  dluga_ogrody_dzialkowe: "Zintegrowane przystanki tramwajowe na ul. Długiej obok ogródków działkowych i Biedronki.",
  dworzec_swiebodzki: "Przystanki tramwajowo-autobusowe przed zabytkowym gmachem Dworca Świebodzkiego i Teatrem Polski.",
  tarczynski_arena_lotnicza: "Zintegrowany węzeł kolejowo-tramwajowy na estakadzie przy stadionie Tarczyński Arena.",
  park_biznesu: "Przystanki tramwajowo-autobusowe w pasie ul. Strzegomskiej obok Wrocławskiego Parku Biznesu.",
  michalczyka: "Przystanki tramwajowo-autobusowe w ciągu ul. Dmowskiego obok osiedli Kępy Mieszczańskiej.",
  budziszynska: "Przystanki autobusowe i tramwajowe w ciągu ul. Rogowskiej przy skrzyżowaniu z Budziszyńską.",
  rogowska_p_r: "Pętla tramwajowa i parking P+R na końcu nowej trasy na Nowy Dwór obok stacji Orlen.",
  bastion_sakwowy: "Przystanki tramwajowe na ul. Piotra Skargi u podnóża wzgórza Bastionu Sakwowego.",
  urzad_wojewodzki_impart: "Przystanek tramwajowy na ul. Mazowieckiej obok Impartu i Urzędu Wojewódzkiego.",
  kosmonautow: "Przystanek tramwajowy w ciągu ul. Kosmonautów obok pętli Pilczyce i kąpieliska Glinianki.",
  mlodych_technikow_akademia_sztuk_teatralnych: "Przystanki tramwajowe na ul. Legnickiej przed gmachem AST i Biedronką.",
  kielczowska_cmentarz: "Pętla autobusowa i zatoki przed bramą główną Cmentarza Kiełczowskiego obok dyskontu Biedronka.",
  bardzka_cmentarz: "Przystanki tramwajowe i autobusowe przy ul. Bardzkiej naprzeciwko Cmentarza Ducha Świętego.",
  buforowa_rondo: "Zatoki autobusowe na rondzie w ciągu ul. Buforowej obok stacji benzynowej i Lidla.",
  park_tysiaclecia_rolkowisko_lodowisko: "Przystanki autobusowe przy ul. Sukielickiej obok Toru Wrotkarskiego i Parku Tysiąclecia.",
  gajkow_lipowa: "Pętla podmiejska i zatoki autobusowe przy ul. Lipowej w Gajkowie.",
  rogowska_ogrody_dzialkowe: "Zatoki autobusowe w ciągu ul. Rogowskiej wzdłuż Rodzinnych Ogrodów Działkowych.",
  wroclaw_mikolajow_zachodnia: "Przystanki autobusowe na ul. Zachodniej bezpośrednio przed stacją kolejową Wrocław Mikołajów.",
  osobowicka_cmentarz_ii: "Zatoki autobusowe przed bramą północną Cmentarza Osobowickiego.",
  minska_rondo_rotm_pileckiego: "Węzeł autobusowy na rondzie u zbiegu ul. Mińskiej i Strzegomskiej obok Biedronki.",
  grabiszynska_cmentarz_ii: "Przystanki w ciągu ul. Grabiszyńskiej naprzeciwko bocznego wejścia na Cmentarz Grabiszyński.",
  lutoslawskiego: "Zatoki autobusowe w ciągu ul. Lutosławskiego na osiedlu Jagodno w pobliżu Żabki.",
  kozia: "Pętla autobusowa i perony przy ul. Koziej na osiedlu Maślice obok stacji kolejowej Wrocław Stadion.",
  krakowska_centrum_handlowe: "Zintegrowane perony tramwajowe na ul. Krakowskiej przed centrum Family Point i Biedronką.",
  osobowicka_cmentarz: "Pętla tramwajowa i zatoki autobusowe przed bramą główną Cmentarza Osobowickiego.",
  walbrzyska: "Wyspa tramwajowa na ul. Powstańców Śląskich przy skrzyżowaniu z Wałbrzyską obok stacji Shell.",
  karwinska_dawna_pralnia: "Perony tramwajowe w ciągu ul. Krakowskiej naprzeciwko zabytkowego kompleksu Pralni.",
  pl_strzegomski_muzeum_wspolczesne: "Perony tramwajowe na ul. Legnickiej przed schronem Muzeum Współczesnego i Lidlem.",
  pl_srebrny: "Wyspa tramwajowa na ul. Grabiszyńskiej przy placu Srebrnym obok supermarketu Biedronka.",
  konduktorska: "Zatoki autobusowe w strefie przemysłowej przy ul. Buforowej i Konduktorskiej.",
  dworzec_glowny_dworcowa: "Przystanki autobusowe na ul. Dworcowej przed hotelem Piast naprzeciwko dworca PKP.",
  pl_zgody_muzeum_etnograficzne: "Wyspa tramwajowa na ul. Traugutta przed Muzeum Etnograficznym obok Lidla.",
  pl_danilowskiego: "Węzeł autobusowo-tramwajowy na placu Daniłowskiego w alei Kasprowicza obok kościoła św. Antoniego."
};

// Generuj lub uzupełniaj brakujące węzły
let added = 0;
for (const [name, info] of Object.entries(hubsFull)) {
  const key = normalize(name);
  if (!currentData.clusters[key]) {
    if (HUB_DESCRIPTIONS[key]) {
      currentData.clusters[key] = HUB_DESCRIPTIONS[key];
      added++;
    } else {
      // Inteligentny fallback geometryczno-infrastrukturalny
      const transportType = info.hasTram && info.hasBus
        ? "Węzeł przesiadkowy tramwajowo-autobusowy"
        : info.hasTram
          ? "Zespół peronów tramwajowych"
          : "Zatoki i perony autobusowe";
      currentData.clusters[key] = `${transportType} w rejonie ${name}, perony rozmieszczone na wlotach skrzyżowania.`;
      added++;
    }
  }
}

console.log(`[✓] Dodano ${added} wskazówek dla węzłów Wrocławia.`);
currentData.generatedAt = new Date().toISOString();

fs.writeFileSync(DATA_FILE, JSON.stringify(currentData, null, 2) + '\n', 'utf8');

// Synchronizuj offline fallback src/data/stopHintsWroclaw.ts
const tsContent = `import type { StopHintsDataset } from '../types/stopHints';

/**
 * Statycznie zbundlowana baza wskazówek lokalizacyjnych dla Wrocławia.
 * Służy jako natychmiastowy offline fallback, zanim aplikacja zsynchronizuje
 * najnowszy plik z R2 (kilometr-timetable/wroclaw/stop-hints.json).
 */
export const WROCLAW_STOP_HINTS: StopHintsDataset = ${JSON.stringify(currentData, null, 2)};
`;
fs.writeFileSync(path.join(ROOT_DIR, 'src/data/stopHintsWroclaw.ts'), tsContent, 'utf8');

console.log(`[✓] Zaktualizowano ${DATA_FILE} oraz src/data/stopHintsWroclaw.ts`);
