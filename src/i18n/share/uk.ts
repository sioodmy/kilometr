import type { ShareStrings } from './pl';

export const uk: ShareStrings = {
  title: 'Поділитися поїздкою', subtitle: 'Повідом, чим їдеш і коли прибудеш.',
  brand: 'Kilometr', arrival: 'Прибуття', departure: 'Відправлення', from: 'Звідки', to: 'Куди',
  duration: (n) => `${n} хв`,
  transfers: (n) => {
    if (n === 0) return 'Без пересадок';
    const last = n % 10;
    const teen = n % 100;
    return last === 1 && teen !== 11 ? `${n} пересадка` : last >= 2 && last <= 4 && (teen < 12 || teen > 14) ? `${n} пересадки` : `${n} пересадок`;
  },
  walk: 'Пішки', walkDistance: (n) => `${n} м пішки`,
  modes: { walk: 'Пішки', tram: 'Трамвай', bus: 'Автобус', train: 'Поїзд', cable: 'Канатна дорога', trolleybus: 'Тролейбус', subway: 'Метро' },
  direction: (name) => `Напрямок: ${name}`,
  cardLabel: (from, to, at) => `Поїздка з ${from} до ${to}, прибуття о ${at}`,
  imageAndLink: 'Поділитися карткою та посиланням', linkOnly: 'Поділитися посиланням', sms: 'Надіслати SMS', copy: 'Копіювати посилання', copied: 'Посилання скопійовано',
  preparing: 'Готуємо картку…', error: 'Не вдалося поділитися. Спробуй ще раз або скопіюй посилання.',
  smsError: 'Не вдалося відкрити SMS. Скопіюй посилання та встав його в повідомлення.',
  close: 'Закрити',
  message: (from, to, departure, arrival, lines) =>
    `Їду з ${from} до ${to}${lines ? ` (${lines})` : ''}. Відправлення ${departure}, прибуття о ${arrival}.`,
  snapshot: 'План поїздки на момент поширення. Місцезнаходження та затримки не оновлюються.',
  privacy: 'Посилання містить маршрут і час. Його може відкрити кожен, кому ти його надішлеш.',
  pageTitle: 'Поширена поїздка', itinerary: 'Деталі поїздки', loading: 'Завантажуємо зупинки з розкладу…',
  stopsUnavailable: 'Деталі зупинок недоступні. Час і пересадки з поширеної поїздки наведені вище.',
  retry: 'Завантажити зупинки знову', showStops: (n) => `Показати зупинки (${n})`, timetable: 'Статичний розклад',
  invalidTitle: 'Не вдалося відкрити поїздку',
  invalidBody: 'Посилання неповне або пошкоджене. Попроси надіслати поїздку ще раз.',
  home: 'Сайт Kilometr', dayLater: (n) => `+${n} д`,
};
