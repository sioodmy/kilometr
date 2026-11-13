import { CITIES } from '../../src/cities.ts';

/** Lista id miast do macierzy workflow (JSON, jedna linia). */
console.log(JSON.stringify(CITIES.map((city) => city.id)));
