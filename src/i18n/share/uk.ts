import type { ShareStrings } from './pl';

export const uk: ShareStrings = {
  title: 'Поділитися поїздкою',
  subtitle: 'Повідом, чим їдеш і коли прибудеш.',
  brand: 'Kilometr',
  arrival: 'Прибуття',
  departure: 'Відправлення',
  from: 'Звідки',
  to: 'Куди',
  duration: (n) => (n >= 60 ? `${Math.floor(n / 60)} год${n % 60 > 0 ? ` ${n % 60} хв` : ''}` : `${n} хв`),
  transfers: (n) => {
    if (n === 0) return 'Без пересадок';
    const last = n % 10;
    const teen = n % 100;
    return last === 1 && teen !== 11
      ? `${n} пересадка`
      : last >= 2 && last <= 4 && (teen < 12 || teen > 14)
        ? `${n} пересадки`
        : `${n} пересадок`;
  },
  walk: 'Пішки',
  walkDistance: (n) => `${n} м пішки`,
  modes: {
    walk: 'Пішки',
    tram: 'Трамвай',
    bus: 'Автобус',
    train: 'Поїзд',
    cable: 'Канатна дорога',
    trolleybus: 'Тролейбус',
    subway: 'Метро',
  },
  direction: (name) => `Напрямок: ${name}`,
  cardLabel: (from, to, at) => `Поїздка з ${from} до ${to}, прибуття о ${at}`,
  imageAndLink: 'Поділитися карткою та посиланням',
  linkOnly: 'Поділитися посиланням',
  download: 'Завантажити картку',
  copy: 'Копіювати посилання',
  copied: 'Посилання скопійовано',
  preparing: 'Готуємо картку…',
  error: 'Не вдалося поділитися. Спробуй ще раз або скопіюй посилання.',
  saveError: 'Не вдалося зберегти картку. Спробуй ще раз.',
  close: 'Закрити',
  message: (from, to, departure, arrival, lines) =>
    `Їду з ${from} до ${to}${lines ? ` (${lines})` : ''}. Відправлення ${departure}, прибуття о ${arrival}.`,
  snapshot: 'План поїздки на момент поширення. Затримки не оновлюються.',
  estimatedPosition: 'Приблизне положення за розкладом',
  positionNote: 'Значок рухається за розкладом, без GPS-даних і поточних затримок.',
  vehicleAt: (mode, stop) => `${mode}: ${stop}. Приблизне положення за розкладом.`,
  vehicleBetween: (mode, from, to) =>
    `${mode}: між ${from} та ${to}. Приблизне положення за розкладом.`,
  hideStops: 'Згорнути зупинки',
  privacy: 'Посилання містить маршрут і час. Його може відкрити кожен, кому ти його надішлеш.',
  pageTitle: 'Поширена поїздка',
  openApp: 'Відкрити в застосунку',
  appHint: 'У застосунку є карта та положення транспорту, коли доступні дані GPS.',
  nativeHint:
    'Посилання відкриває маршрут у застосунку. Без застосунку працює перегляд у браузері.',
  follow: 'Закріпити у сповіщеннях',
  following: 'Завершити спостереження',
  followHint:
    'Прибуття та перебіг поїздки на екрані блокування. Доступ до вашого місцеположення не потрібен.',
  vehicleLive: 'Положення транспорту за GPS',
  noVehicle:
    'Немає поточного положення GPS. Карта показує маршрут, а час узято з поширеного плану.',
  vehicleOnly: 'Ви стежите за транспортом. Посилання не поширює місцеположення відправника.',
  finished: 'Поїздку завершено',
  planned: 'План поїздки',
  map: 'Карта поїздки',
  fitMap: 'Показати весь маршрут',
  mapUnavailable: 'Геометрія маршруту недоступна. Спробуйте завантажити її знову.',
  geometryLoading: 'Завантаження геометрії маршруту…',
  approximateGeometry: 'Приблизний маршрут через зупинки.',
  mapError: 'Не вдалося завантажити карту. Перебіг поїздки наведено нижче.',
  retryMap: 'Завантажити карту знову',
  switchCity: (city) => `Відкрити маршрут: ${city}`,
  switchCityHint: 'Цей маршрут з іншого міста. Перемикання завершить поточне відстеження.',
  replaceTitle: 'Стежити за цим маршрутом?',
  replaceBody: 'Поточне відстеження буде завершено. Сповіщення показуватиме поширену поїздку.',
  trackError: 'Не вдалося закріпити маршрут. Спробуйте ще раз.',
  notificationTitle: (place, time) => `${place}, прибуття ${time}`,
  notificationWalkingTitle: (place, time) => `Поширено • до ${place} о ${time}`,
  notificationDepartTitle: (service, time) => `Поширено • ${service} відпр. ${time}`,
  notificationRideTitle: (service, time) => `Поширено • ${service} приб. ${time}`,
  notificationTransferTitle: (service, time) => `Поширено • пересадка ${service} о ${time}`,
  notificationBoardStop: (stop) => `Посадка: ${stop}`,
  notificationToStop: (stop) => `У бік: ${stop}`,
  notificationArrived: 'Поширена поїздка прибула до цілі',
  notificationArrivedBody: (place, time) => `${place} • за планом ${time}`,
  planYourOwn: 'Відкрити в планувальнику',
  inProgress: 'У дорозі',
  upcoming: 'До відправлення',
  arrTime: (time) => `приб. ${time}`,
  depTime: (time) => `відпр. ${time}`,
  dwellMin: (min) => `зупинка ${min} хв`,
  platformLabel: (platform, track) =>
    platform && track
      ? `Платформа ${platform}, Колія ${track}`
      : platform
        ? `Платформа ${platform}`
        : track
          ? `Колія ${track}`
          : '',
  liveDelay: (min) =>
    min > 0 ? `+${min} хв затримки` : min < 0 ? `на ${Math.abs(min)} хв раніше` : 'Вчасно',
  itinerary: 'Деталі поїздки',
  loading: 'Завантажуємо зупинки з розкладу…',
  stopsUnavailable: 'Деталі зупинок недоступні. Час і пересадки з поширеної поїздки наведені вище.',
  retry: 'Завантажити зупинки знову',
  showStops: (n) => `Показати зупинки (${n})`,
  timetable: 'Статичний розклад',
  invalidTitle: 'Не вдалося відкрити поїздку',
  invalidBody: 'Посилання неповне або пошкоджене. Попроси надіслати поїздку ще раз.',
  home: 'Сайт Kilometr',
  dayLater: (n) => `+${n} д`,
};
