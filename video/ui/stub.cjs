// Zaślepka modułów natywnych dla ekranów aplikacji w przeglądarce: każda
// właściwość, wywołanie i `new` zwraca znowu zaślepkę, więc import i
// inicjalizacja serwisów nie wybuchają. Komponent z zaślepki nic nie rysuje
// (React dostaje funkcję zamiast elementu i ją pomija).
const stub = new Proxy(function stub() {}, {
  get(_, key) {
    if (key === '__esModule') return false;
    if (key === 'then' || key === 'prototype' || typeof key === 'symbol') {
      return key === Symbol.toPrimitive ? () => '' : undefined;
    }
    if (key === 'toString' || key === 'valueOf') return () => '';
    if (key === 'length') return 0;
    return stub;
  },
  apply: () => stub,
  construct: () => stub,
});

module.exports = stub;
