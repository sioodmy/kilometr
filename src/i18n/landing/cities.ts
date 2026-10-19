import type { CityId } from '../../cities';

export const cityNames = {
  bialystok: 'Białystok',
  gzm: 'GZM',
  kielce: 'Kielce',
  krakow: 'Kraków',
  lublin: 'Lublin',
  lodz: 'Łódź',
  olsztyn: 'Olsztyn',
  opole: 'Opole',
  poznan: 'Poznań',
  radom: 'Radom',
  rzeszow: 'Rzeszów',
  szczecin: 'Szczecin',
  trojmiasto: 'Trójmiasto',
  warszawa: 'Warszawa',
  wroclaw: 'Wrocław',
} satisfies Record<CityId, string>;
