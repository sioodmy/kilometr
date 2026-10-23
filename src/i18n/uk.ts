// Українські переклади. Має відповідати `Strings` (typeof pl) - відсутній
// ключ або неправильна сигнатура функції це помилка компіляції.
import type { Strings } from './pl';
import { uk as landing } from './landing/uk';
import { uk as share } from './share/uk';

function isFew(n: number): boolean {
  const last = n % 10;
  const teen = n % 100;
  return last >= 2 && last <= 4 && (teen < 12 || teen > 14);
}

/** Українська множина: 1, 21, 31... (крім 11) беруть форму однини. */
function isOne(n: number): boolean {
  return n % 10 === 1 && n % 100 !== 11;
}

function prepInCity(cityLoc: string): string {
  // В українській мові прийменник «в» переходить в «у» перед словами на «в» чи «ф».
  const startsWithV = /^[вф]/i.test(cityLoc);
  return startsWithV ? `у ${cityLoc}` : `в ${cityLoc}`;
}

export const uk: Strings = {
  landing,
  share,
  lineTimetable: {
    title: 'Розклад маршруту',
    line: (line: string) => `Маршрут ${line}`,
    open: (line: string) => `Відкрити розклад маршруту ${line}`,
    searchHint: 'Зупинки та час відправлення',
    direction: 'Напрямок',
    variant: (n: number) => `Варіант ${n}`,
    stops: 'Зупинки',
    stopsHint: 'Торкніться зупинки, щоб переглянути відправлення.',
    departures: 'Відправлення',
    stopCode: (code: string) => `Код зупинки ${code}`,
    selectStop: (name: string) => `Показати відправлення: ${name}`,
    loading: 'Завантаження розкладу…',
    error: 'Не вдалося завантажити розклад. Спробуйте ще раз.',
    empty: 'У збереженому розкладі немає рейсів на цей день. Виберіть інший день або оновіть розклад у Налаштуваннях.',
    missing: 'Цього маршруту немає у збереженому розкладі. Поверніться до пошуку або оновіть дані в Налаштуваннях.',
    terminal: 'Кінцева зупинка',
    terminalHint: 'Виберіть попередню зупинку, щоб переглянути відправлення.',
    scheduled: 'Час зі збереженого розкладу',
    nextDay: 'Наступний день',
    previousDay: 'Попередній день',
    back: 'Назад',
    dayOffset: (days: number) => `+${days} ${isOne(days) ? 'день' : isFew(days) ? 'дні' : 'днів'}`,
    nextDayTime: (time: string, days: number) => `${time} (+${days} ${isOne(days) ? 'день' : isFew(days) ? 'дні' : 'днів'})`,
  },
  transferGuard: {
    title: 'Контроль пересадок',
    waiting: 'Контроль увімкнено. Очікуємо підтвердження поїздки за GPS.',
    buffer: (line: string, n: number) => `Пересадка на ${line} · ${n} хв запасу`,
    riskTitle: (line: string) => `Ви можете не встигнути на ${line}`,
    riskBody: 'Шукаємо іншу пересадку.',
    stayOn: (line: string) => `Залишайтеся в ${line}`,
    changedBody: (line: string, stop: string) => `Пересядьте на ${line} на зупинці ${stop}.`,
    noAlternative: 'Доступної альтернативи не знайдено. Поточна пересадка може не вдатися. Перевіримо ще раз.',
    unavailable: 'Не можемо оцінити пересадку',
    unavailableBody: 'Очікуємо точне місцеположення на маршруті. Поточний план залишається видимим.',
    routingError: 'Не вдалося підготувати контроль пересадок. Спробуйте ще раз.',
    rerouting: 'Шукаємо нову пересадку',
    next: (line: string, stop: string) => `${line} · ${stop}`,
    channel: 'Зміни пересадок',
    start: 'Їхати з контролем пересадок',
    startBody: 'Попередимо, якщо ви можете не встигнути. Ви вирішуєте, чи змінювати маршрут.',
    locationRequired: 'Для контролю пересадок потрібне ваше точне місцеположення під час поїздки.',
    active: 'Контроль увімкнено',
    preparing: 'Готуємо контроль пересадок…',
    safe: 'У вас є час на пересадку',
    attention: 'Перевірте пересадку',
    alternativeTitle: 'Можна поїхати іншим маршрутом',
    alternativeBody: 'Перегляньте інший маршрут і вирішіть, чи обрати його.',
    originalPlan: 'Поточний план',
    suggestedPlan: 'Інший маршрут',
    unchanged: 'Маршрут зміниться лише після вашого підтвердження.',
    sameStop: 'Пересадка на тій самій зупинці',
    stayUntil: (line: string, stop: string) => `Їдьте лінією ${line} до: ${stop}`,
    fromHere: 'Вирушити з поточного місця',
    departure: 'Відправлення',
    arrival: 'У пункті призначення',
    delay: (n: number) => `Затримка +${n} хв`,
    shortBy: (n: number) => `На пересадку бракує ${n} хв`,
    spare: (n: number) => `${n} хв запасу`,
    schedule: 'За розкладом',
    live: 'Дані наживо',
    choose: 'Обрати цей маршрут',
    keepPlan: 'Залишити свій план',
    showOptions: 'Перевірити пересадку',
    later: 'Згорнути',
    expired: 'Ця пропозиція вже неактуальна. Перевіряємо інші маршрути.',
    acceptError: 'Не вдалося змінити маршрут. Ваш поточний план залишається активним.',
    stop: 'Завершити поїздку',
    foreground: 'Контроль працює, коли застосунок відкрито.',
    background: 'Контроль працює також із заблокованим екраном.',
    complete: 'На цьому маршруті більше немає пересадок.',
    demo: 'Тестовий сценарій',
  },
  common: {
    retry: 'Спробувати знову',
    cancel: 'Скасувати',
    close: 'Закрити',
    no: 'Ні',
    yesRemove: 'Так, видалити',
    now: 'Зараз',
    today: 'Сьогодні',
    tomorrow: 'Завтра',
    todayLong: 'Сьогодні',
    tomorrowLong: 'Завтра',
    todayLower: 'сьогодні',
    tomorrowLower: 'завтра',
    durMin: (n: number) => `${n} хв`,
    departIn: (n: number) => `за ${n} хв`,
    departNow: 'ось-ось',
    departAgo: (n: number) =>
      isOne(n) ? `${n} хвилину тому` : isFew(n) ? `${n} хвилини тому` : `${n} хвилин тому`,
    departJustAgo: 'щойно',
    lessThan10m: '< 10 м',
    kmh: (v: string) => `${v} км/год`,
    add15: '+15 хв',
    add30: '+30 хв',
    add60: '+1 год.',
  },
  home: {
    searchToA11y: (title: string) => `Знайти сполучення до: ${title}`,
    editPlaceHint: 'Натисни й утримуй, щоб редагувати місце.',
    title: 'Куди їдемо?',
    newsA11y: 'Новини',
    newsAlertA11y: 'Новини: нові ускладнення',
    searchLabel: 'Куди їдеш?',
    searchA11y: 'Шукай адресу, зупинку або місце',
    startCustomA11y: (t: string) => `Початок маршруту: ${t}. Натисни, щоб змінити.`,
    startGpsA11y: (t: string) => `Локація: ${t}. Натисни, щоб змінити початок.`,
    startFrom: (t: string) => `з: ${t}`,
    resetStartA11y: 'Повернути поточну GPS-локацію',
    savedTitle: 'Збережені місця',
    editSavedA11y: 'Редагувати збережені місця',
    editCard: 'Редагувати',
    editCardSub: 'збережені місця',
    historyTitle: 'Останні місця',
    historyEmptyTitle: 'Немає останніх місць',
    historyEmptyBody: 'Знайди сполучення, і воно з’явиться тут як швидка ціль.',
    historyEmptyAction: 'Шукати сполучення',
    openConnA11y: (title: string, label: string) => `Відкрити сполучення до ${title}, ${label}`,
    gpsTitle: 'Моя локація (GPS)',
    locationFallback: 'Твоя локація',
    gpsAddressHome: 'Поточна позиція пристрою',
    importingTitle: (gen: string) => `Завантаження розкладу ${gen}…`,
    importErrorTitle: 'Помилка завантаження розкладу',
    importErrorRetry: 'Натисни, щоб спробувати знову.',
    saveFailTitle: 'Немає з’єднання з базою',
    saveFailBody: 'Не вдалося зберегти місце. Спробуй знову.',
    searchPlaceholderTo: 'Куди їдеш?',
    searchPlaceholderFrom: 'Звідки вирушаєш?',
    unsupportedTitle: 'Місто не підтримується',
    unsupportedTitleOther: 'Інше місто в застосунку',
    unsupportedBody: (city: string, supported: string) =>
      `Твоя GPS-локація вказує на ${city}. Наразі обслуговуємо лише: ${supported}.`,
    unsupportedBodyOther: (city: string, active: string) =>
      `Ти ${prepInCity(city)}, а застосунок налаштовано на ${active}. Зміни місто в налаштуваннях.`,
    unsupportedBodyUnknown: (supported: string) =>
      `Твоя GPS-локація поза зоною обслуговування. Наразі обслуговуємо лише: ${supported}.`,
    unsupportedHint: 'Вибери початок вручну, щоб знайти сполучення.',
    unsupportedAction: 'Вибрати початок',
    pickStart: 'Вибери початок',
    gpsBlockedTitle: 'Старт із GPS недоступний',
    gpsBlockedBody: (city: string, supported: string) =>
      `Ти поза зоною ${supported} (${city}), тож маршрути з GPS не працюватимуть. Вибери початок вручну.`,
    gpsBlockedBodyUnknown: (supported: string) =>
      `Ти поза зоною ${supported}, тож маршрути з GPS не працюватимуть. Вибери початок вручну.`,
  },
  city: {
    section: 'Місто',
    settingsTitle: 'Місто',
    settingsHint:
      'Розклад, мапа офлайн і новини йдуть за містом. Дані іншого міста залишаються на телефоні.',
    name: (id: string): string =>
      id === 'krakow'
        ? 'Краків'
        : id === 'gzm'
          ? 'GZM'
          : id === 'warszawa'
            ? 'Варшава'
            : id === 'poznan'
              ? 'Познань'
              : id === 'trojmiasto'
                ? 'Труймясто'
                : id === 'lodz'
                  ? 'Лодзь'
                  : id === 'szczecin'
                    ? 'Щецин'
                    : id === 'kielce'
                      ? 'Кельце'
                      : id === 'olsztyn'
                        ? 'Ольштин'
                        : id === 'bialystok'
                          ? 'Білосток'
                          : id === 'opole'
                            ? 'Ополе'
                            : id === 'rzeszow'
                              ? 'Ряшів'
                              : id === 'lublin'
                                ? 'Люблін'
                              : id === 'radom'
                                ? 'Радом'
                              : 'Вроцлав',
    gen: (id: string): string =>
      id === 'krakow'
        ? 'Кракова'
        : id === 'gzm'
          ? 'GZM'
          : id === 'warszawa'
            ? 'Варшави'
            : id === 'poznan'
              ? 'Познані'
              : id === 'trojmiasto'
                ? 'Труймяста'
                : id === 'lodz'
                  ? 'Лодзі'
                  : id === 'szczecin'
                    ? 'Щецина'
                    : id === 'kielce'
                      ? 'Кельце'
                      : id === 'olsztyn'
                        ? 'Ольштина'
                        : id === 'bialystok'
                          ? 'Білостока'
                          : id === 'opole'
                            ? 'Ополя'
                            : id === 'rzeszow'
                              ? 'Ряшева'
                              : id === 'lublin'
                                ? 'Любліна'
                              : id === 'radom'
                                ? 'Радома'
                              : 'Вроцлава',
    loc: (id: string): string =>
      id === 'krakow'
        ? 'Кракові'
        : id === 'gzm'
          ? 'GZM'
          : id === 'warszawa'
            ? 'Варшаві'
            : id === 'poznan'
              ? 'Познані'
              : id === 'trojmiasto'
                ? 'Труймясті'
                : id === 'lodz'
                  ? 'Лодзі'
                  : id === 'szczecin'
                    ? 'Щецині'
                    : id === 'kielce'
                      ? 'Кельце'
                      : id === 'olsztyn'
                        ? 'Ольштині'
                        : id === 'bialystok'
                          ? 'Білостоці'
                          : id === 'opole'
                            ? 'Ополі'
                            : id === 'rzeszow'
                              ? 'Ряшеві'
                              : id === 'lublin'
                                ? 'Любліні'
                              : id === 'radom'
                                ? 'Радомі'
                              : 'Вроцлаві',
    feeds: (id: string): string =>
      id === 'krakow'
        ? 'ZTP і Koleje Małopolskie'
        : id === 'gzm'
          ? 'ZTM, Koleje Śląskie, POLREGIO і PKP Intercity'
          : id === 'warszawa'
            ? 'WTP, SKA, Koleje Mazowieckie і WKD'
            : id === 'poznan'
              ? 'ZTM і Koleje Wielkopolskie'
              : id === 'trojmiasto'
                ? 'ZTM Gdańsk, ZKM Gdynia і SKM'
: id === 'lodz'
                  ? 'MPK і Лодзька агломераційна залізниця'
                  : id === 'szczecin'
                    ? 'ZDiTM Szczecin'
                    : id === 'kielce'
                      ? 'ZTM Кельце'
                      : id === 'olsztyn'
                        ? 'ZDZiT Ольштин'
                        : id === 'bialystok'
                          ? 'BKM Białystok'
                          : id === 'opole'
                            ? 'MZK Ополе'
                            : id === 'rzeszow'
                              ? 'ZTM Ряшів'
                              : id === 'lublin'
                                ? 'ZDiTM Lublin'
                              : id === 'radom'
                                ? 'MZDiK Radom'
                              : 'MPK і Koleje Dolnośląskie',
    newsSources: (id: string): string =>
      id === 'krakow'
        ? 'ZTP Краків'
        : id === 'gzm'
          ? 'ZTM GZM'
          : id === 'warszawa'
            ? 'WTP Варшава'
            : id === 'poznan'
              ? 'ZTM Познань'
              : id === 'trojmiasto'
                ? 'ZTM Ґданськ'
: id === 'lodz'
                  ? 'MPK Лодзь'
                  : id === 'szczecin'
                    ? 'ZDiTM Щецин'
                    : id === 'kielce'
                      ? 'ZTM Кельце'
                      : id === 'olsztyn'
                        ? 'ZDZiT Ольштин'
                        : id === 'bialystok'
                          ? 'BKM Білосток'
                          : id === 'opole'
                            ? 'MZK Ополе'
                            : id === 'rzeszow'
                              ? 'ZTM Ряшів'
                              : id === 'lublin'
                                ? 'ZDiTM Люблін'
                              : id === 'radom'
                                ? 'MZDiK Радом'
                              : 'MPK Вроцлав • wroclaw.pl',
    operator: (id: string): string =>
      id === 'krakow'
        ? 'ZTP Краків'
        : id === 'gzm'
          ? 'ZTM GZM'
          : id === 'warszawa'
            ? 'WTP Варшава'
            : id === 'poznan'
              ? 'ZTM Познань'
              : id === 'trojmiasto'
                ? 'ZTM Ґданськ'
: id === 'lodz'
                  ? 'MPK Лодзь'
                  : id === 'szczecin'
                    ? 'ZDiTM Щецин'
                    : id === 'kielce'
                      ? 'ZTM Кельце'
                      : id === 'olsztyn'
                        ? 'ZDZiT Ольштин'
                        : id === 'bialystok'
                          ? 'BKM Білосток'
                          : id === 'opole'
                            ? 'MZK Ополе'
                            : id === 'rzeszow'
                              ? 'ZTM Ряшів'
                              : id === 'lublin'
                                ? 'ZDiTM Люблін'
                              : id === 'radom'
                                ? 'MZDiK Радом'
                              : 'MPK Вроцлав',
    operatorShort: (id: string): string =>
      id === 'krakow'
        ? 'ZTP'
        : id === 'gzm'
          ? 'ZTM'
          : id === 'warszawa'
            ? 'WTP'
            : id === 'poznan'
              ? 'ZTM'
              : id === 'trojmiasto'
                ? 'ZTM / ZKM'
                : id === 'szczecin'
                  ? 'ZDiTM'
                  : id === 'kielce'
                    ? 'ZTM'
                    : id === 'olsztyn'
                      ? 'ZDZiT'
                      : id === 'bialystok'
                        ? 'BKM'
                        : id === 'opole'
                          ? 'MZK'
                          : id === 'rzeszow'
                            ? 'ZTM'
                              : id === 'lublin'
                                ? 'ZDiTM'
                              : id === 'radom'
                                ? 'MZDiK'
                            : 'MPK',
    portal: (id: string): string =>
      id === 'krakow'
        ? 'ztp.krakow.pl'
        : id === 'gzm'
          ? 'metropoliaztm.pl'
          : id === 'warszawa'
            ? 'wtp.waw.pl'
            : id === 'poznan'
              ? 'ztm.poznan.pl'
              : id === 'trojmiasto'
                ? 'ztm.gda.pl'
: id === 'lodz'
                  ? 'mpk.lodz.pl'
                  : id === 'szczecin'
                    ? 'zditm.szczecin.pl'
                    : id === 'kielce'
                      ? 'ztm.kielce.pl'
                      : id === 'olsztyn'
                        ? 'zdzit.olsztyn.eu'
                        : id === 'bialystok'
                          ? 'komunikacja.bialystok.pl'
                          : id === 'opole'
                            ? 'mzkopole.pl'
                            : id === 'rzeszow'
                              ? 'ztm.erzeszow.pl'
                              : id === 'lublin'
                                ? 'zdtm.lublin.eu'
                              : id === 'radom'
                                ? 'mzdik.pl'
                                : 'wroclaw.pl',
    supportedList: 'Вроцлав, Краків, GZM, Варшава, Познань, Труймясто, Лодзь, Щецин, Кельце, Ольштин, Білосток, Ополе, Ряшів, Lublin',
    changed: (name: string) => `Перемкнуто на: ${name}.`,
    switching: 'Перемикаю місто…',
    blockedByDownload: 'Триває завантаження розкладу. Місто можна змінити після цього.',
    needDownload:
      'Для цього міста ще немає розкладу на телефоні. Завантаж його в розділі «Розклад і карти».',
    changeAction: 'Змінити',
    selectTitle: 'Оберіть місто',
    selectSub: 'Оберіть агломерацію для планування поїздок.',
    searchPlaceholder: 'Місто або перевізник',
    noSearchResults: (q: string) => `Міст за запитом «${q}» не знайдено`,
    searchEmptyHint: 'Перевірте написання або спробуйте знайти іншу агломерацію.',
    searchClearA11y: 'Очистити пошук',
    closeSheetA11y: 'Закрити вибір міста',
    cityActiveBadge: 'Активне',
  },
  personalization: {
    colors: 'Кольори застосунку',
    system: 'Зі шпалер',
    systemDescription: 'Стандартні кольори Material You',
    wallpaperUnavailable: 'Кольори шпалер недоступні. Стандартна палітра.',
    teal: 'Бірюзовий',
    blue: 'Синій',
    green: 'Зелений',
    violet: 'Фіолетовий',
    rose: 'Рожевий',
    orange: 'Помаранчевий',
    saving: 'Зберігаємо колір…',
    saveError: 'Не вдалося зберегти колір. Спробуйте вибрати його ще раз.',
  },
  settings: {
    planningTitle: 'Планування подорожі',
    offlineTitle: 'Розклад і карти',
    notificationsSummary: 'Відстеження подорожі та сповіщення',
    backupSummary: 'Збережені місця, історія та налаштування',
    planningSummary: (style: string, pace: string) => `${style} · ${pace}`,
    appSummary: (language: string, color: string) => `${language} · ${color}`,
    resetRoutes: 'Відновити налаштування маршрутів',
    resetRoutesBody: 'Відновить стандартні налаштування планування подорожі.',
    decrease: (label: string) => `Зменшити: ${label}`,
    increase: (label: string) => `Збільшити: ${label}`,
    langPolish: 'Polski',
    langEnglish: 'English',
    langGerman: 'Deutsch',
    langUkrainian: 'Українська',
    title: 'Налаштування',
    resetA11y: 'Відновити типові',
    sectionSupport: 'Підтримка',
    supportTitle: 'Підтримай проєкт',
    supportHint: 'Kilometr безкоштовний. Кава на Ko-fi допомагає розвивати додаток далі.',
    supportButton: 'Відкрити Ko-fi',
    supportA11y: 'Відкрити сторінку Ko-fi в браузері',
    sectionOffline: 'Офлайн',
    sectionApp: 'Застосунок',
    sectionRoute: 'Маршрут',
    sectionTransport: 'Транспорт',
    sectionData: 'Ваші дані',
    advancedShow: 'Розширені',
    advancedHide: 'Сховати розширені',
    notificationsSection: 'Сповіщення',
    notificationsFoot: 'Сповіщення працюють у dev-збірці. Expo Go їх не підтримує.',
    offlineMapTitle: (name: string) => `Мапа офлайн (${name})`,
    offlineMapHint: (name: string, mb: number) =>
      `Завантаж тайли мапи ${name} (близько ${mb} МБ), щоб маршрути працювали без інтернету.`,
    offlineMapReady: (name: string) =>
      `Мапа ${name} вже на телефоні. Маршрути працюють без інтернету.`,
    offlineMapDownload: 'Завантажити мапу',
    offlineMapDownloadA11y: (name: string) => `Завантажити мапу ${name} для офлайну`,
    offlineMapDownloading: (pct: number) => `Завантаження… ${pct}%`,
    offlineMapStepTiles: (name: string) => `тайли для ${name}`,
    offlineMapStepDone: 'готово',
    offlineMapDelete: 'Видалити',
    offlineMapDeleteA11y: 'Видалити мапу офлайн',
    offlineMapDeleteTitle: 'Видалити мапу офлайн?',
    offlineMapDeleteBody: (mb: number) =>
      `Звільниться близько ${mb} МБ. Мапа далі працюватиме онлайн. Повторне завантаження буде доступне лише за місяць.`,
    offlineMapFailTitle: 'Не вдалося завантажити мапу',
    offlineMapFailBody: "Перевір з'єднання і спробуй ще раз. Решта застосунку працює як звичайно.",
    offlineMapCooldownTitle: 'Мапу вже завантажували',
    offlineMapCooldownBody: (days: number) =>
      days <= 1
        ? 'Повторне завантаження мапи буде доступне завтра. Одного разу вистачає надовго.'
        : `Повторне завантаження мапи буде доступне через ${days} дні. Одного разу вистачає надовго.`,
    backupTitle: 'Ваші дані',
    backupHint:
      'Збережені місця, останні поїздки та налаштування в одному файлі. Експортуйте перед зміною телефона, або просто для надійності.',
    backupExcludeHint: 'Розклад, кеш і дані відстеження курсу залишаються на пристрої.',
    backupExport: 'Експорт у файл',
    backupImport: 'Імпорт із файлу',
    backupExportA11y: 'Експортувати дані у файл',
    backupImportA11y: 'Імпортувати дані з файлу',
    backupEmpty: 'Поки що немає чого зберігати.',
    backupCurrent: (places: number, routes: number, trips: number) =>
      `${places} ${isOne(places) ? 'місце' : isFew(places) ? `${places} місця` : `${places} місць`} • ` +
      `${routes} ${isOne(routes) ? 'збережена траса' : isFew(routes) ? `${routes} збережені траси` : `${routes} збережених трас`} • ` +
      `${trips} ${isOne(trips) ? 'поїздка' : isFew(trips) ? `${trips} поїздки` : `${trips} поїздок`}`,
    backupExportDoneTitle: 'Готово',
    backupExportDoneBody: (path: string) => `Файл збережено в ${path}`,
    backupExportFailTitle: 'Не вдалося зберегти файл',
    backupExportFailBody: (reason: string) =>
      `${reason}. Перевірте вільне місце та спробуйте ще раз.`,
    backupExportFailFallback: 'Спробуйте ще раз за хвилину.',
    backupImportConfirmTitle: 'Імпортувати ці дані?',
    backupImportConfirmBody: (summary: string) =>
      `${summary}\n\nЗбережені місця та поїздки буде об’єднано з наявними, нічого не зникне. Налаштування буде перезаписано.`,
    backupImportAction: 'Імпортувати',
    backupImportCancel: 'Скасувати',
    backupImportDoneTitle: 'Дані імпортовано',
    backupImportDoneBody: (summary: string) => `Об’єднано: ${summary}`,
    backupImportNothing: 'Ця копія не містить ваших даних.',
    backupFailNoFile: 'Файл не знайдено.',
    backupFailUnreadable: 'Не вдалося прочитати файл.',
    backupFailNotBackup: 'Це не копія Kilometr.',
    backupFailSchemaTooNew: 'Ця копія з новішої версії застосунку.',
    dataTitle: (operator: string) => `Розклад ${operator}`,
    dataHint: (feeds: string) =>
      `Розклади ${feeds} із сервера Kilometr. Одне завантаження, далі офлайн.`,
    dataEmpty: 'Немає офлайн-даних.',
    dataDownloading: (p: number) => `Завантаження… ${p}%`,
    dataStep: (step: string, p: number) => `${step} ${p}%`,
    dataReady: (stops: number, trips: number) =>
      `Повний розклад: ${stops} зупинок, ${trips} рейсів`,
    dataError: (msg: string) => `Помилка: ${msg}`,
    downloadA11y: 'Завантажити розклад',
    downloadCheckA11y: 'Перевірити, чи є новіший розклад',
    downloadReady: 'Перевірити оновлення',
    downloadEmpty: 'Завантажити повний розклад',
    downloadFailTitle: 'Не вдалося завантажити розклад',
    downloadFailBody: (reason: string) =>
      `${reason}. Застосунок бере готову базу із сервера Kilometr або класично з відкритих даних міста.`,
    downloadFailFallback: 'Спробуй за мить.',
    downloadDone: 'Розклад оновлено.',
    downloadUpToDate: 'Розклад уже актуальний.',
    downloadKeptLocal: 'Не вдалося завантажити нову версію. Залишаємо ту, що вже є на телефоні.',
    downloadCooldown: (hours: number) =>
      hours <= 1
        ? 'Розклад нещодавно завантажували. Наступне повне завантаження буде доступне приблизно за годину.'
        : `Розклад нещодавно завантажували. Наступне повне завантаження буде доступне через ${hours} год.`,
    diagTitle: 'Діагностика даних',
    diagHint:
      'Перевіряє базу розкладу на телефоні. Скопіюй результат, коли повідомляєш про проблему.',
    diagRun: 'Перевірити дані',
    diagRerun: 'Перевірити ще раз',
    diagRunning: 'Перевіряю…',
    diagRunA11y: 'Запустити діагностику даних',
    diagOk: 'OK',
    diagWarn: 'Попередження',
    diagError: 'Помилка',
    diagDb: 'База SQLite',
    diagDbDamaged: 'Базу пошкоджено',
    diagDbSize: (mb: string) => `Розмір бази: ${mb} МБ`,
    diagDbOrphan: (name: string) => `Залишковий тимчасовий файл: ${name}`,
    diagDbWal: (mb: string) => `WAL: ${mb} МБ`,
    diagDbNoAccess: 'Немає доступу до файлу бази',
    diagCounts: 'Лічильники розкладу',
    diagCountsLine: (stops: number, routes: number, trips: number, times: number) =>
      `${stops} зупинок • ${routes} маршрутів • ${trips} рейсів • ${times} відправлень`,
    diagCountsEmpty: 'База порожня. Завантаж розклад нижче.',
    diagCountsNoRoutes: 'Немає маршрутів у базі',
    diagTrains: 'Регіональні поїзди',
    diagTrainsLine: (n: number) =>
      isOne(n)
        ? '1 залізничний маршрут'
        : isFew(n)
          ? `${n} залізничні маршрути`
          : `${n} залізничних маршрутів`,
    diagTrainsNone: 'Немає залізничних маршрутів. Завантаж новіший розклад.',
    diagTrainsNotSupported: 'Не застосовується для цього міста (громадський транспорт без залізниці)',
    diagCalendar: 'Календар GTFS',
    diagCalendarLine: (from: string, to: string) => `Розклад дійсний ${from} – ${to}`,
    diagCalendarEmpty: 'Немає календаря в базі',
    diagCalendarOutside: 'Сьогоднішня дата поза розкладом',
    diagCalendarExpiring: (days: number) =>
      days <= 1
        ? 'Розклад спливає завтра'
        : isFew(days)
          ? `Розклад спливе за ${days} дні`
          : `Розклад спливе за ${days} днів`,
    diagCalendarServices: (n: number) => `Активних сервісів сьогодні: ${n}`,
    diagSearch: 'Пошук',
    diagSearchOk: (weighted: number, pois: number) =>
      `Рейтинг готовий (${weighted} зупинок) • POI: ${pois}`,
    diagSearchWeights: 'Рейтинг підказок не пораховано',
    diagSearchPois: 'Немає точок POI. Адреси потребують інтернету.',
    diagCopy: 'Скопіювати звіт',
    diagCopyA11y: 'Скопіювати звіт діагностики в буфер обміну',
    diagCopied: 'Звіт скопійовано в буфер обміну',
    diagCopyFail: 'Не вдалося скопіювати звіт',
    diagFix: 'Завантажити розклад ще раз',
    diagFixA11y: 'Примусово завантажити розклад знову',
    diagReportCity: 'Місто',
    diagReportTimetable: 'Розклад',
    diagReportImported: 'Завантажено',
    diagReportDb: 'База',
    diagReportUnknown: 'невідомо',
    routeStyleTitle: 'Стиль маршруту',
    routeStyleHint:
      'Визначає, що перемагає, коли маршрути відрізняються на кілька хвилин: раніше прибуття, коротша прогулянка чи менше пересадок. Ліміти нижче діють для кожного стилю.',
    styleFastest: 'Найшвидше',
    styleFastestDesc: 'Найраніше прибуття',
    styleBalanced: 'Збалансовано',
    styleBalancedDesc: 'Хвилина за меншу ходьбу',
    styleLessWalking: 'Менше пішки',
    styleLessWalkingDesc: 'Короткі підходи й пересадки',
    styleFewerTransfers: 'Менше пересадок',
    styleFewerTransfersDesc: 'Напряму, навіть довше',
    transfersTitle: 'Макс. пересадок',
    transfersHint:
      'Найбільша кількість пересадок в одному маршруті. Штраф за кожну пересадку задає стиль маршруту, тож 300 м пішки до зупинки з прямим рейсом зазвичай виграють у пересадок з найближчої зупинки.',
    transfersHintShort: 'Верхня межа в одному маршруті.',
    directValue: 'Прямі',
    allowTransferTitle: 'Дозволяти пересадки на:',
    allowTransferHint: 'Вимкнений транспорт не з’являтиметься в результатах.',
    modeTram: 'Трамвай',
    modeBus: 'Автобус',
    modeTrolleybus: 'Тролейбус',
    modeSubway: 'Метро',
    modeTrain: 'Потяг',
    modeCable: 'Канатна дорога',
    transferTimeTitle: 'Мін. час на пересадку',
    transferTimeHint:
      'Скільки часу резервуємо між виходом і наступним відправленням. Більше значення відкидає ризиковані хвилинні пересадки.',
    transferTimeHintShort: 'Запас між виходом і наступним відправленням.',
    trainTitle: 'Регіональні потяги',
    trainHint:
      'Пересадки на регіональні потяги. Лише в режимі «Всі», швидкий фільтр трамвай/автобус їх не чіпає.',
    trainHintShort: 'Пересадки на потяги. Лише в режимі «Всі».',
    trainBufferTitle: 'Запас на потяг',
    trainBufferHint:
      'Мінімальний час, щоб дійти до перону після пересадки. Вокзали не звичайні зупинки: шлях від зупинки до перону зазвичай йде через хол.',
    trainBufferHintShort: 'Час дійти до перону після пересадки.',
    trainNoData:
      'У завантаженому розкладі немає потягів. Перевір оновлення вище, щоб увімкнути пересадки на потяги.',
    cableTitle: 'Polinka',
    cableHint:
      "Канатна дорога Полтехніки Вроцлава через Одру, між набережною Висп'янського та вулицею На Гроблі. Курює у будні 7:00–21:00 з перервою 13:30–14:00, кожні 5 хвилин. У вихідні не курює. Лише в режимі «Транспорт».",
    cableHintShort: 'Канатна дорога через Одру. Лише в режимі «Всі».',
    walkTitle: 'Макс. пішки',
    walkHint:
      'Як далеко можеш підійти до початкової зупинки та від кінцевої до цілі. Дальша зупинка з прямим трамваєм часто б’є найближчий стовп.',
    walkHintShort: 'Підхід на старт і від кінця до цілі.',
    speedTitle: 'Темп ходьби',
    speedHint: 'Твій вибір впливає на час піших переходів, пересадок і оцінку прибуття.',
    paceSlow: 'Повільно',
    paceNormal: 'Звичайно',
    paceFast: 'Швидко',
    paceSlowDesc: 'Спокійна прогулянка',
    paceNormalDesc: 'Звичайна міська хода',
    paceFastDesc: 'Бадьорий крок',
    anchorTitle: 'Радіус прив’язки',
    anchorHint:
      'Коли ти в цьому радіусі від збереженого місця (напр. Дім), навігація автоматично прив’яже старт до його зупинки, згладжуючи похибки GPS.',
    anchorHintShort: 'Автоприв’язка старту біля збереженого місця.',
    foot: 'Налаштування зберігаються автоматично і стосуються наступних пошуків.',
    walkTime: (n: number) =>
      isOne(n) ? '1 хвилина пішки' : isFew(n) ? `${n} хвилини пішки` : `${n} хвилин пішки`,
    langTitle: 'Мова',
    langSystem: 'Системна',
  },
  onboarding: {
    stepCount: (n: number, total: number) => `${n} / ${total}`,
    intro: 'Обери місто й завантаж розклад. Планувати поїздки можна й без інтернету.',
    openSettings: 'Відкрити налаштування',
    permissionDenied: 'Можна продовжити без цього дозволу та змінити його пізніше в налаштуваннях телефона.',
    steps: ['Вітаємо', 'Доступи', 'Місто', 'Розклад', 'Місця'],
    granted: 'Увімкнено',
    denied: 'Вимкнено',
    toEnable: 'До ввімкнення',
    slotHome: 'Дім',
    slotHomeHint: (id: string) =>
      id === 'krakow'
        ? 'напр. Krowoderska 12'
        : id === 'warszawa'
          ? 'напр. Marszałkowska 12'
          : id === 'poznan'
            ? 'напр. Głogowska 12'
            : id === 'trojmiasto'
              ? 'напр. Długa 12'
: id === 'lodz'
                ? 'напр. Piotrkowska 12'
                : id === 'szczecin'
                  ? 'напр. Wojska Polskiego 12'
                  : id === 'kielce'
                    ? 'напр. Sienkiewicza 12'
                    : id === 'olsztyn'
                      ? 'напр. Partyzantów 12'
                      : id === 'bialystok'
                        ? 'напр. Lipowa 12'
                        : id === 'opole'
                          ? 'напр. Ozimska 12'
                          : id === 'rzeszow'
                            ? 'напр. 3 Maja 12'
                              : id === 'lublin'
                                ? 'напр. Krakowskie Przedmieście 12'
                              : id === 'radom'
                                ? 'напр. Żeromskiego 12'
                            : 'напр. Swojczycka 41',
    slotWork: 'Робота',
    slotWorkHint: (id: string) =>
      id === 'krakow'
        ? 'напр. Galeria Krakowska'
        : id === 'warszawa'
          ? 'напр. Złote Tarasy'
          : id === 'poznan'
            ? 'напр. Stary Browar'
            : id === 'trojmiasto'
              ? 'напр. Galeria Bałtycka'
: id === 'lodz'
                ? 'напр. Manufaktura'
                : id === 'szczecin'
                  ? 'напр. Galeria Kaskada'
                  : id === 'kielce'
                    ? 'np. Galeria Echo'
                    : id === 'olsztyn'
                      ? 'напр. Galeria Warmińska'
                      : id === 'bialystok'
                        ? 'напр. Galeria Jurowiecka'
                        : id === 'opole'
                          ? 'напр. Solaris Center'
                          : id === 'rzeszow'
                            ? 'напр. Galeria Rzeszów'
                              : id === 'lublin'
                                ? 'напр. Felicity'
                              : id === 'radom'
                                ? 'напр. Galeria Słoneczna'
                            : 'напр. Sky Tower',
    slotUni: 'Універ',
    slotUniHint: (id: string) =>
      id === 'krakow'
        ? 'напр. AGH'
        : id === 'warszawa'
          ? 'напр. Університет'
          : id === 'poznan'
            ? 'напр. UAM'
            : id === 'trojmiasto'
              ? 'напр. UG'
: id === 'lodz'
                ? 'напр. UŁ'
                : id === 'szczecin'
                  ? 'напр. US'
                  : id === 'kielce'
                    ? 'напр. UJK'
                    : id === 'olsztyn'
                      ? 'напр. UWM'
                      : id === 'bialystok'
                        ? 'напр. UwB'
                        : id === 'opole'
                          ? 'напр. UO'
                          : id === 'rzeszow'
                            ? 'напр. PRz'
                              : id === 'lublin'
                                ? 'напр. UMCS'
                              : id === 'radom'
                                ? 'напр. UTH'
                            : 'напр. Politechnika',
    backA11y: 'Назад',
    stepOf: (n: number, len: number, name: string) => `Крок ${n} з ${len} • ${name}`,
    brand: 'Kilometr',
    tagline: 'Цього разу доїдеш.',
    fast: 'Планування офлайн',
    noAds: 'Без реклами',
    noPay: 'Без мікроплатежів',
    permTitle: 'Доступи',
    permSub: 'Локація та сповіщення. Обидва необов’язкові.',
    locTitle: 'Локація',
    locBody:
      'Показує зупинки поруч і перебіг активної поїздки. Для визначення адреси координати надсилаються до OpenStreetMap Nominatim. Під час поїздки GPS може працювати з вимкненим екраном.',
    locOn: 'Локацію ввімкнено.',
    locAllow: 'Дозволити локацію',
    notifTitle: 'Сповіщення',
    notifBody: 'Показують закріплену поїздку й нагадують про вибране відправлення або вихід.',
    notifOn: 'Сповіщення ввімкнено.',
    notifExpoGo: 'Перегляд в Expo Go: сповіщення (закріплене сполучення) працюють у dev-збірці.',
    notifAllow: 'Увімкнути сповіщення',
    cityTitle: 'У якому місті їздиш?',
    cityBody:
      'Розклад, мапа й новини підлаштуються під вибір. Місто можна змінити пізніше в налаштуваннях.',
    citySuggested: (name: string) => `За GPS ти ${prepInCity(name)}.`,
    cityNoGps: 'Без доступу до GPS вибери місто зі списку.',
    cityLocating: 'Шукаю твою позицію GPS…',
    cityNoMatch: 'GPS не вказує на підтримуване місто. Вибери зі списку.',
    cityPickA11y: (name: string) => `Вибрати місто: ${name}`,
    citySuggestedA11y: (name: string) => `Запропоноване місто за GPS: ${name}`,
    dlTitle: (gen: string) => `Завантажити розклад ${gen}`,
    dlBody: (feeds: string) =>
      `Готова база: ${feeds} із сервера Kilometr. Одне завантаження, далі офлайн.`,
    dlEmpty: 'Немає офлайн-даних.',
    dlSize: 'Одне завантаження • кілька хвилин • далі офлайн',
    dlProgress: (p: number) => `Завантаження… ${p}%`,
    dlStep: (step: string, p: number) => `${step} ${p}%`,
    dlKeepOpen: 'Не закривай застосунок під час завантаження.',
    dlDone: 'Розклад готовий.',
    dlDoneSub: (stops: number, trips: number) => `${stops} зупинок • ${trips} рейсів.`,
    dlFail: 'Щось пішло не так',
    dlFailBody: (msg: string) => `${msg}. Перевір інтернет і спробуй знову.`,
    saveFail: 'Не вдалося зберегти місце',
    saveFailBody: 'Спробуйте ще раз.',
    placesTitle: 'Де буваєш найчастіше?',
    placesBody: 'Збережені місця прискорюють пошук. Цей крок можна пропустити.',
    added: 'Додано',
    removeSlotA11y: (name: string) => `Видалити ${name}`,
    closeAction: 'Закрити',
    addAction: '+ Додати',
    addressFor: (name: string) => `Адреса для: ${name}…`,
    noResults: (q: string) =>
      `Немає результатів для „${q}“. Зупинки шукаємо офлайн, адреси потребують інтернету.`,
    start: 'Налаштувати Kilometr',
    next: 'Далі',
    later: 'Пізніше',
    footerRetry: 'Спробувати знову',
    footerDownloading: 'Завантаження…',
    footerDownload: 'Завантажити розклад',
    needTimetable: 'Без розкладу не знайти сполучень.',
    doneCount: (n: number) => `Готово (${n})`,
    donePlain: 'Готово',
    skip: 'Пропустити',
    skipTimetable: 'Пропустити, розклад завантажу пізніше',
  },
  news: {
    chip: 'Ускладнення',
    fetchFail: 'Не вдалося завантажити новини. Перевір інтернет і спробуй знову.',
    title: 'Новини',
    sourceLoading: (feeds: string) => feeds,
    sourceEmpty: (combined: string) => combined,
    count: (n: number, urgent: number) => {
      const items = isOne(n) ? `${n} новина` : isFew(n) ? `${n} новини` : `${n} новин`;
      if (urgent <= 0) return items;
      const u =
        isOne(urgent)
          ? `${urgent} термінова`
          : isFew(urgent)
            ? `${urgent} термінові`
            : `${urgent} термінових`;
      return `${items} • ${u}`;
    },
    refreshA11y: 'Оновити новини',
    loading: 'Завантаження повідомлень…',
    noConnection: 'Немає з’єднання',
    emptyTitle: 'Немає повідомлень',
    emptyBody: (name: string) => {
      const verb =
        name === 'Варшава' || name === 'Лодзь'
          ? 'опублікувала'
          : name === 'Труймясто'
            ? 'опублікувало'
            : name === 'Кельце'
              ? 'опублікували'
              : 'опублікував';
      return `${name} зараз не ${verb} жодних ускладнень. Потягни вниз, щоб перевірити знову.`;
    },
    sectionChanges: 'Зміни на лініях',
    sectionCity: 'Новини',
    sourceMpk: (operator: string) => operator,
    sourceCity: (portal: string) => portal,
    linesLabel: (lines: string) => `Лінії ${lines}`,
    openBrowser: 'Відкрити в браузері',
    articleFail: 'Не вдалося завантажити цю сторінку.',
    articleEmpty: 'На цій сторінці немає тексту, який застосунок може показати.',
    filterAll: 'Усі',
    filterMyLines: 'Мої лінії',
    filterMyLinesA11y: 'Показати лише повідомлення про лінії з твоїх останніх маршрутів',
    filterEmptyTitle: 'Нічого на твоїх лініях',
    filterEmptyBody: 'Немає повідомлень про лінії з маршрутів, які ти перевіряв останні два тижні.',
    filterNoHistoryTitle: 'Ще немає ліній',
    filterNoHistoryBody:
      'Знайди сполучення в застосунку, тоді тут з’являться повідомлення про ці лінії.',
  },
  newsSvc: {
    justNow: 'щойно',
    minsAgo: (m: number) =>
      isOne(m) ? `${m} хвилину тому` : isFew(m) ? `${m} хвилини тому` : `${m} хвилин тому`,
    hoursAgo: (h: number) =>
      isOne(h) ? `${h} годину тому` : isFew(h) ? `${h} години тому` : `${h} годин тому`,
    yesterday: 'вчора',
    daysAgo: (d: number) =>
      isOne(d) ? `${d} день тому` : isFew(d) ? `${d} дні тому` : `${d} днів тому`,
    untitled: '(без назви)',
  },
  map: {
    title: 'Мапа маршруту',
    stagesTitle: 'Етапи подорожі',
    showWholeRoute: 'Увесь маршрут',
    loadFail: 'Не вдалося завантажити сполучення',
    loadFailBody: "Мапа показує конкретне сполучення, тож воно має бути в пам'яті або в кеші.",
    backToDetails: 'Назад до деталей',
    assembling: 'Збираю сполучення…',
    offlineTitle: 'Мапа недоступна. Перевір підключення до мережі.',
    offlineSub: 'Плитки не завантажуються',
    backA11y: 'Назад',
    transfersSuffix: (n: number) =>
      isOne(n) ? ' • 1 пересадка.' : isFew(n) ? ` • ${n} пересадки.` : ` • ${n} пересадок.`,
    delaySuffix: (d: number) => ` • ${d > 0 ? '+' : ''}${d} хв`,
    walkPrefix: 'Пішки ',
    walkStageA11y: (dist: string) => `Піший етап ${dist}`,
    lineStageA11y: (line: string, dir: string) => `Лінія ${line} напрямок ${dir}`,
    lineLabel: (line: string) => `Лінія ${line}`,
    legStops: (n: number) => (isOne(n) ? '1 зуп.' : isFew(n) ? `${n} зуп.` : `${n} зуп.`),
    board: 'Сідай',
    alight: 'Виходь',
    mapLoadFail: 'Не вдалося завантажити мапу',
    maneuver: {
      depart: 'Йди до зупинки',
      straight: 'Рухайся прямо',
      slightLeft: 'Трохи ліворуч',
      left: 'Поверни ліворуч',
      sharpLeft: 'Різко ліворуч',
      slightRight: 'Трохи праворуч',
      right: 'Поверни праворуч',
      sharpRight: 'Різко праворуч',
      uturn: 'Розвернися',
      board: 'Сідай',
      alight: 'Виходь',
      arrive: 'Ти на місці',
      then: 'потім',
      in: 'за',
      onStop: 'на зупинці',
      detailA11y: (what: string, dist: string) => `${what}, ${dist}`,
    },
  },
  routes: {
    gpsAddress: 'Використати поточну позицію',
    destFallback: 'Ціль',
    trackUnsupportedTitle: 'Відстеження недоступне',
    trackUnsupportedBody: 'Сповіщення потребують dev-збірки. Expo Go їх не підтримує.',
    noConnectionsTitle: 'Немає сполучень',
    noConnectionsBody: 'Зачекайте, поки на цьому маршруті з’явиться рейс.',
    stopTrackingTripA11y: 'Зупинити відстеження подорожі',
    trackTrip: 'Відстежувати рейс',
    stopTrackTrip: 'Зупинити',
    trackTripA11y: 'Відстежувати цей рейс',
    pinUnsupportedTitle: 'Закріплення недоступне',
    pinUnsupportedBody:
      'Закріплені сповіщення потребують dev-збірки. Expo Go не підтримує сповіщень.',
    notifOffTitle: 'Сповіщення вимкнено',
    notifOffBody: 'Дозволь сповіщення в системних налаштуваннях, щоб закріпити сполучення.',
    gpsFailTitle: 'Помилка локації',
    gpsFailBody: 'Не вдалося отримати поточну GPS-позицію. Переконайся, що локацію ввімкнено.',
    now: 'Зараз',
    title: (operator: string) => `Сполучення ${operator}`,
    sortFastestA11y: 'Сортування: прибуття. Натисни, щоб перемкнути на відправлення.',
    sortEarliestA11y: 'Сортування: відправлення. Натисни, щоб перемкнути на прибуття.',
    sortFastest: 'прибуття',
    sortEarliest: 'відправлення',
    unpinA11y: 'Відкріпити сполучення',
    pinA11y: 'Закріпити найближче сполучення',
    changeFromA11y: (t: string) => `Змінити старт, зараз ${t}`,
    changeFromAnchorA11y: (t: string, stop: string) =>
      `Змінити старт, зараз ${t}, відправлення з зупинки ${stop}`,
    dismissAnchorA11y: 'Прибрати прив’язку зупинки і шукати з GPS',
    swapA11y: 'Обернути маршрут: поміняти старт і ціль',
    changeToA11y: (t: string) => `Змінити ціль, зараз ${t}`,
    searching: 'Шукаю сполучення…',
    calcFail: 'Не вдалося порахувати сполучення',
    noTimetable: 'Немає розкладу',
    calcFailBody:
      'Планувальник рахує маршрути на телефоні. Спробуй знову. Якщо повторюється завжди, онови розклад у налаштуваннях.',
    noTimetableBody:
      'Застосунок рахує маршрути на телефоні з повного розкладу. Без нього немає сполучень. Завантаж раз, далі працює офлайн.',
    downloadA11y: 'Завантажити розклад',
    downloading: (p: number) => `Завантаження… ${p}%`,
    downloadingStep: (step: string, p: number) => `${step} ${p}%`,
    downloadingPlain: 'Завантаження…',
    downloadAction: 'Завантажити розклад',
    countNearest: 'найближчі відправлення',
    countDepart: (label: string) => `відправлення ${label}`,
    countDirect: ' • лише прямі',
    countTram: ' • трамваї',
    countBus: ' • автобуси',
    countEarlier: ' • завантажую раніші…',
    offlineTapA11y: 'Останні дані з кешу. Натисни, щоб оновити.',
    offlineChip: 'офлайн',
    noLiveChip: 'немає live-даних',
    moreFail: 'Не вдалося підвантажити дальші сполучення.',
    moreRetryA11y: 'Спробувати підвантажити дальші сполучення',
    noMore: 'Це всі відправлення цього маршруту.',
    noMoreArrival: 'У цьому проміжку немає раніших сполучень. Вибери раніший час прибуття.',
    emptyArrival: 'Немає сполучень до вибраного часу. Спробуй пізніший час прибуття або іншу ціль.',
    emptyFiltered: 'Немає сполучень за вибраними фільтрами',
    emptyNone: 'Сполучень не знайдено',
    emptyModeDirect: (veh: string) =>
      `На цьому маршруті зараз немає рейсу ${veh} без пересадок. Послаб фільтри або перевір інший час.`,
    emptyDirect:
      'На цьому маршруті зараз немає прямого рейсу. Вимкни фільтр „Лише прямі“, щоб бачити сполучення з пересадками, або перевір інший час.',
    emptyMode: (veh: string) =>
      `На цьому маршруті зараз немає рейсу ${veh}. Перемкни на „Всі“, щоб бачити решту.`,
    emptyPlain: 'Спробуй іншу ціль або перевір інший час відправлення.',
    vehicleTramGen: 'трамваєм',
    vehicleBusGen: 'автобусом',
    vehicleTrolleyGen: 'тролейбусом',
    vehicleTrainGen: 'потягом',
    vehicleSubwayGen: 'метром',
    vehicleCableGen: 'канатною дорогою',
    showWithChangesA11y: 'Показати сполучення з пересадками',
    showWithChanges: 'Показати з пересадками',
    showAllVehiclesA11y: 'Показати весь транспорт',
    showAllVehicles: 'Показати весь транспорт',
  },
  routeDetails: {
    departure: 'Вихід',
    arrival: 'Прибуття',
    origin: 'Звідки',
    destination: 'Куди',
    late: (n: number) => `Запізнення на ${n} хв`,
    early: (n: number) => `На ${n} хв раніше`,
    title: 'Деталі сполучення',
    loadFail: 'Не вдалося завантажити сполучення.',
    backToList: 'Назад до списку',
    offlineNote: 'Збережено офлайн. Час за розкладом, без даних у реальному часі.',
    noLiveNote: 'Час за розкладом. Немає даних у реальному часі.',
    onTime: 'Вчасно',
    scheduleCache: 'Розклад з кешу',
    schedule: 'Розклад',
    noTrip: 'Немає геометрії маршруту',
    noTripBody:
      'Це сполучення не має збережених зупинок, тож намалювати маршрут і показати найближчу зупинку не вийде. Повернись і вибери інше сполучення.',
    lineAlertsTitle: 'Зміни на твоїх лініях',
    lineAlertsAll: 'Усі новини',
    lineAlertsEmpty: 'Немає повідомлень про лінії цього маршруту.',
    lineAlertsCount: (n: number) =>
      isOne(n) ? '1 повідомлення' : isFew(n) ? `${n} повідомлення` : `${n} повідомлень`,
  },
  search: {
    suggestedPlaces: 'Рекомендовані місця',
    emptyTitle: 'Куди їдемо?',
    emptyHint: 'Введи зупинку, адресу або місце. Твій вибір з’явиться тут.',
    errorTitle: 'Не вдалося виконати пошук',
    errorHint: 'Зміни запит і спробуй ще раз. Перевір, чи завантажено розклад міста.',
    defaultPlaceholder: (city: string) => `Шукай ${prepInCity(city)}…`,
    originA11y: (t: string) => `Початок: ${t}. Натисни, щоб змінити.`,
    fromPrefix: 'З:',
    change: 'Змінити',
    closeA11y: 'Закрити пошук',
    clearA11y: 'Очистити запит',
    resultsFor: (q: string, n: number) => `Результати для „${q}” (${n})`,
    recentTrips: 'Останні поїздки',
    savedA11y: (t: string) => `Збережене місце: ${t}`,
    searching: (city: string) => `Шукаю ${prepInCity(city)}…`,
    noResults: 'Немає результатів',
    noResultsHint: (id: string) =>
      `Спробуй: ${id === 'krakow' ? '„rynek”, „grodzka”, „wawel”, „balice”' : id === 'gzm' ? '„katowice”, „gliwice”, „rynek”, „tychy”' : id === 'warszawa' ? '„metro”, „młociny”, „centralny”, „śródmieście”' : id === 'poznan' ? '„rynek”, „garbary”, „rondo”, „malta”' : id === 'trojmiasto' ? '„oliwa”, „wrzeszcz”, „orłowo”, „przymorze”' : id === 'lodz' ? '„piotrkowska”, „manufaktura”, „fabryczna”, „kaliska”' : id === 'szczecin' ? '„brama portowa”, „dąbie”, „police”, „pogodno”' : id === 'kielce' ? '„sienkiewicza”, „rynek”, „kadzielnia”, „herby”' : id === 'olsztyn' ? '„stare miasto”, „dworzec”, „jaroty”, „barczewo”' : id === 'bialystok' ? '„rynek kościuszki”, „lipowa”, „branicki”, „opera”' : id === 'opole' ? '„rynek”, „ozimska”, „solaris”, „dworzec”' : id === 'rzeszow' ? '„rynek”, „dworzec”, „rejtana”, „3 maja”' : id === 'lublin' ? '„krakowskie”, „zamek”, „felicity”, „świdnik”' : id === 'radom' ? '„żeromskiego”, „południe”, „gołębiów”, „idalin”' : '„arkady”, „biskupin”, „zoo”, „swojczycka”'}. Працює й без польських літер і з помилками.`,
    noResultsFor: (q: string) => `Нічого не підходить до „${q}”`,
    yourPlaces: 'Твої місця',
    gpsOutsideNotice: 'GPS поза містом, вибери точку вручну.',
  },
  places: {
    editAction: 'Редагувати',
    editA11y: (name: string) => `Редагувати місце: ${name}`,
    removeA11y: (name: string) => `Видалити місце: ${name}`,
    clearAnchorA11y: 'Видалити призначену зупинку',
    manageTitle: 'Збережені місця',
    manageSub: 'Керуй своїми швидкими цілями',
    emptyTitle: 'Немає збережених місць',
    emptyBody: 'Додай дім, роботу чи улюблені точки, щоб перевіряти сполучення одним дотиком.',
    addNew: 'Додати нове місце',
    removeTitle: (name: string) => `Видалити „${name}”?`,
    removeGeneric: 'Видалити це місце?',
    removeConfirm: 'Видалити',
    iconCategories: {
      all: 'Усі',
      frequent: 'Часті',
      transit: 'Подорожі',
      food: 'Їжа',
      health: 'Здоров’я',
      culture: 'Культура',
      sport: 'Спорт',
      services: 'Послуги',
    },
    iconName: {
      home: 'Дім',
      work: 'Робота',
      school: 'Школа',
      university: 'Університет',
      gym: 'Спортзал',
      coffee: 'Кав’ярня',
      shopping: 'Магазин',
      star: 'Улюблене',
      heart: 'Важливе',
      friends: 'Друзі',
      train: 'Вокзал',
      tram: 'Трамвай',
      bus: 'Автобус',
      plane: 'Аеропорт',
      bike: 'Велосипед',
      car: 'Авто',
      fuel: 'Заправка',
      ship: 'Пором / Порт',
      compass: 'Компас',
      restaurant: 'Ресторан',
      pizza: 'Піцерія',
      sandwich: 'Бістро',
      beer: 'Паб / Пиво',
      wine: 'Бар / Вино',
      market: 'Ринок',
      cart: 'Супермаркет',
      pharmacy: 'Аптека',
      hospital: 'Лікарня',
      doctor: 'Клініка',
      scissors: 'Перукарня',
      sparkles: 'Краса / Спа',
      cinema: 'Кіно',
      theater: 'Театр',
      culture: 'Музей',
      library: 'Бібліотека',
      music: 'Музика',
      ticket: 'Подія',
      gamepad: 'Розваги',
      park: 'Парк',
      mountain: 'Гори',
      tent: 'Кемпінг',
      trophy: 'Стадіон',
      swimming: 'Басейн / Пляж',
      church: 'Церква',
      baby: 'Садок',
      pet: 'Улюбленець',
      hotel: 'Готель',
      bank: 'Банк / Банкомат',
      post: 'Пошта / Посилка',
      laptop: 'Коворкінг',
      mapPin: 'Інше',
      plus: 'Інше',
    },
    chooseIcon: 'Вибрати іконку',
    iconFor: (name: string) => `Іконка для: ${name}`,
    iconForFallback: 'цього місця',
    searchIcon: 'Шукай іконки (напр. потяг, кава, лікар)…',
    anchorTitle: 'Зупинка прив’язки',
    anchorFor: (name: string) => `Вибери зупинку відправлення для: ${name}`,
    searchStop: 'Шукай зупинку…',
    nearStops: 'Найближчі зупинки навколо вибраної адреси:',
    typeStopAbove: 'Введи назву зупинки вище, щоб шукати.',
    metersAway: (m: number) => `${m} м від вибраного місця`,
    choose: 'Вибрати',
    editPlace: 'Редагувати місце',
    newPlace: 'Нове збережене місце',
    chooseTarget: 'Вибери адресу або зупинку призначення',
    editHint: 'Зміни назву, іконку або адресу',
    newHint: 'Вибери ціль і додай до швидких маршрутів',
    nameLabel: 'Назва місця',
    nameHint: 'напр. Дім, Універ, Робота, Спортзал',
    moreIcons: (n: number) => `Більше іконок (${n}) ›`,
    moreIconsShort: '+ Більше...',
    addressLabel: 'Адреса або зупинка призначення',
    changeBtn: 'Змінити',
    queryHint: 'Введи вулицю, зупинку або об’єкт…',
    anchorOptional: 'Бажана зупинка (необов’язково)',
    anchorHint: 'Відправлення з цієї зупинки, коли ти поруч',
    assignAnchor: '+ Прив’язати зупинку відправлення',
    saveChanges: 'Зберегти зміни',
    savePlace: 'Зберегти місце',
  },
  timeSheet: {
    title: 'Час подорожі',
    modeDeparture: 'Відправлення о',
    modeArrival: 'Прибуття до',
    selectedArrival: (day: string, hh: string, mm: string) => `Прибуття до: ${day}, ${hh}:${mm}`,
    confirmAction: 'Показати сполучення',
    selectedDeparture: (day: string, hh: string, mm: string) => `${day}, ${hh}:${mm}`,
    minutePreset: (mm: string) => `Установити хвилину: ${mm}`,
    dayToday: 'Сьогодні',
    dayTomorrow: 'Завтра',
    hourLabel: 'година',
    minuteLabel: 'хвилина',
    confirmNow: 'Шукати від зараз',
    confirmDepart: (day: string, hh: string, mm: string) => `Застосувати: ${day}, ${hh}:${mm}`,
  },
  routesBar: {
    modeTram: 'Трам',
    modeBus: 'Автобус',
    modeAll: 'Транспорт',
    modeTramA11y: 'Трамваї',
    modeBusA11y: 'Автобуси',
    modeAllA11y: 'Весь транспорт',
    reverse: 'Обернути',
    reverseA11y: 'Обернути маршрут: поміняти старт і ціль',
    direct: 'Прямі',
    directOnA11y: 'Фільтр лише прямих: увімкнено. Натисни, щоб показати всі.',
    directOffA11y: 'Фільтр лише прямих: вимкнено. Натисни, щоб увімкнути.',
    modeFilterA11y: (cur: string) => `Фільтрувати транспорт: зараз ${cur}. Натисни, щоб змінити.`,
    timeA11y: (label: string) => `Час відправлення: ${label}. Натисни, щоб змінити.`,
  },
  connection: {
    previewTitle: 'Перегляд маршруту',
    previewHint: 'Натисніть і утримуйте, щоб переглянути маршрут.',
    previewSwipe: 'Посуньте вгору, щоб відкрити деталі',
    previewRelease: 'Відпустіть, щоб відкрити деталі',
    previewOpen: 'Відкрити деталі маршруту',
    transfers: (n: number) =>
      n <= 0 ? 'прямо' : isOne(n) ? '1 пересадка' : isFew(n) ? `${n} пересадки` : `${n} пересадок`,
    connections: (n: number) =>
      isOne(n) ? '1 сполучення' : isFew(n) ? `${n} сполучення` : `${n} сполучень`,
    walkAll: 'цілком пішки',
    walkLeg: 'пішки',
    cardA11y: (
      dep: string,
      dur: number,
      depAt: string,
      arrAt: string,
      via: string,
      lines: string,
    ) =>
      `${dep}, час їзди ${dur} хв, відправлення ${depAt}, прибуття ${arrAt}, ${via}${lines ? `, лінії ${lines}` : ''}`,
    walkRoute: 'піший маршрут',
  },
  vehiclePos: {
    noRoute: 'Немає даних про маршрут',
    liveBetween: (from: string, to: string) => `Транспорт: ${from} → ${to} • наживо`,
    liveBefore: (stop: string) => `Транспорт: перед ${stop} • наживо`,
    liveAt: (stop: string) => `Транспорт: ${stop} • наживо`,
    liveNear: (stop: string) => `Транспорт: поблизу ${stop} • наживо`,
    estRoute: (from: string, to: string) => `Орієнтовна позиція: ${from} → ${to}`,
    estBefore: (at: string) => `До від'їзду (${at}) • орієнтовна позиція`,
    estDone: 'Рейс завершено • орієнтовна позиція',
    estBetween: (from: string, to: string) => `Транспорт (орієнт.): ${from} → ${to}`,
  },
  leg: {
    fareBoundary: 'Межа тарифних зон',
    fareBoundaryDetail: (areas: string, point: string) => point ? `${areas} · ${point}` : areas,
    noData: 'Немає даних про маршрут',
    expandA11y: (line: string, dir: string, expanded: boolean) =>
      `${line} напрямок ${dir}. ${expanded ? 'Згорнути' : 'Розгорнути'} список зупинок.`,
    vehicleBetween: (mode: string, from: string, to: string) => `${mode} між ${from} та ${to}`,
    vehicleFarBack: 'Транспорт ще далі на маршруті',
    vehicleNotStarted: 'Рейс ще не розпочався',
    fromPrefix: 'з ',
    toPrefix: 'до ',
    stopsSummary: (n: number, mins: number, open: boolean) => {
      const stops = isOne(n) ? `${n} зупинка` : isFew(n) ? `${n} зупинки` : `${n} зупинок`;
      return `${stops} • ~${mins} хв • ${open ? 'згорнути' : 'розгорнути'}`;
    },
  },
  compass: {
    journeyTitle: 'Навігація в дорозі',
    riding: 'Поїздка до зупинки висадки',
    transferWalk: 'Пішки до пересадки',
    headToDestination: 'Ідіть до місця призначення',
    navToDestination: (dist: string) => `${dist} до місця призначення`,
    nextStopAt: (name: string) => `Наступна зупинка: ${name}`,
    rideTo: (name: string) => `Їдьте до: ${name}`,
    waitForDeparture: (time: string) => `Чекайте на відправлення о ${time}`,
    journeyArrived: 'Ви прибули',
    vehicleGps: 'GPS-позиція транспорту',
    vehicleGpsMissing: 'Немає свіжої GPS-позиції транспорту. Маршрут залишається видимим.',
    alightAt: (name: string) => `Виходьте: ${name}`,
    boardAt: (name: string) => `Сідайте: ${name}`,
    stopsRemaining: (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'зупинка' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'зупинки' : 'зупинок'} до виходу`,
    mapLoading: 'Завантаження мапи…',
    mapFailed: 'Не вдалося завантажити мапу. Перевірте підключення до інтернету.',
    mapRetry: 'Завантажити мапу знову',
    openMap: 'Відкрити повну мапу маршруту',
    ahead: 'Просто перед тобою',
    slightRight: 'Трохи праворуч',
    right: 'Праворуч від тебе',
    backRight: 'За тобою праворуч',
    back: 'Позаду тебе',
    backLeft: 'За тобою ліворуч',
    left: 'Ліворуч від тебе',
    slightLeft: 'Трохи ліворуч',
    noCoords: 'Ця зупинка не має координат у розкладі.',
    locOff: 'Локацію вимкнено. Без неї не покажу напрямок до зупинки.',
    locWaiting: 'Позиції ще немає. Зачекай на GPS або відкрий повну мапу.',
    title: 'Навігація до зупинки',
    followCompass: 'Піший маршрут крок за кроком',
    directionPrefix: (d: string) => `напрямок ${d}`,
    straight: 'по прямій',
    distanceText: (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} км` : `${m} м`),
    walkMins: (m: number) => `~${m} хв пішки`,
    headToStop: 'Іди до зупинки',
    nextStop: 'Наступна зупинка',
    navToStop: (dist: string) => `${dist} до зупинки`,
    navA11y: (what: string, dist: string) => `${what}, ${dist}. Торкнись, щоб відкрити повну мапу.`,
    rerouting: 'Шукаю новий маршрут',
    openSettingsA11y: 'Відкрити налаштування застосунку',
    enableLoc: 'Увімкни локацію в налаштуваннях',
  },
  lastTrip: {
    backA11y: (from: string, to: string) =>
      `Швидке повернення: ${from} до ${to}. Відпусти, щоб шукати.`,
    lastA11y: (from: string, to: string) =>
      `Останнє сполучення: ${from} до ${to}. Тягни далі, щоб обернути.`,
    pullHint: 'Останнє шукане сполучення.\nВідпусти, щоб шукати',
    pullHintBack: 'Дорога назад.\nВідпусти, щоб шукати',
  },
  suggestion: {
    stopFallback: 'Зупинка',
  },
  data: {
    stepUnpack: 'Розпакування…',
    stepStops: 'Зупинки…',
    stepLines: 'Лінії…',
    stepCalendar: 'Календар…',
    stepTrips: 'Рейси…',
    stepTimes: 'Часи відправлень…',
    stepTimesK: (k: number) => `Часи відправлень… (${k} тис.)`,
    stepIndex: 'Побудова індексів…',
    stepWeights: 'Ваги зупинок…',
    stepDb: 'Завантаження бази…',
    stepVerify: 'Перевірка…',
    errStops: 'Немає stops.txt в архіві GTFS',
    errTrips: 'Немає trips.txt в архіві GTFS',
    errTimes: 'Немає stop_times.txt в архіві GTFS',
    prepareFail: 'Не вдалося підготувати розклад',
    retryHint: 'Натисни, щоб спробувати знову.',
  },
  downloader: {
    noNet: 'Немає з’єднання з інтернетом',
    timeout: 'Завантаження тривало задовго',
    noSpace: 'Замало місця на телефоні',
    unavailable: 'Розклад тимчасово недоступний',
    failed: 'Не вдалося завантажити розклад',
    hintRetry: 'Перевір інтернет і натисни, щоб повторити.',
    hintTouch: 'Натисни, щоб спробувати знову.',
    hintSpace: 'Звільни трохи місця і натисни, щоб повторити.',
    hintLater: 'Спробуй пізніше.',
    noFile: 'Завантаження GTFS не повернуло файл',
  },
  notification: {
    channelTracking: 'Відстеження поїздки',
    channelTrackingDesc: 'Тихе сповіщення про прогрес і відлік до відправлення або прибуття.',
    channelAlerts: 'Повідомлення про поїздку',
    channelAlertsDesc: 'Затримки, зміни маршруту та прибуття.',
    permDenied:
      'Сповіщення вимкнено. Увімкни їх у системних налаштуваннях для kilometr, щоб відстежувати відправлення та прогрес поїздки.',
    actionStop: 'Зупинити',
    actionRoute: 'Маршрут',
    showRoutes: 'Показати маршрут',
    actionOk: 'Гаразд',
    modeWalk: 'Пішки',
    modeTram: 'Трамвай',
    modeBus: 'Автобус',
    modeTrain: 'Потяг',
    modeSubway: 'Метро',
    modeCable: 'Канатна дорога',
    modeTrolleybus: 'Тролейбус',
    departTitle: (service: string, at: string) => `${service} • відправлення о ${at}`,
    rideTitle: (service: string, at: string) => `${service} • прибуття о ${at}`,
    transferTitle: (service: string, at: string) => `Пересадка • ${service} • відправлення о ${at}`,
    arrivedTitle: 'Ти на місці',
    arrivedBody: (at: string, dur: string) => `Прибуття о ${at} • поїздка тривала ${dur}`,
    nextStop: (name: string) => `наступна ${name}`,
    estimatedNextStop: (name: string) => `Орієнтовна наступна зупинка: ${name}`,
    stopHere: (name: string) => `зупинка ${name}`,
    alightAt: (name: string) => `Виходь на: ${name}`,
    directionTo: (dir: string) => `У напрямку ${dir}`,
    platform: (num: string) => `колія ${num}`,
    walkApproach: (min: number) => `~${min} хв пішки`,
    rideLength: (min: number) => `їзда ${min} хв`,
    departAt: (at: string) => `відправлення о ${at}`,
    arriveAt: (at: string) => `прибуття о ${at}`,
    delayLate: (min: number) => `затримка +${Math.round(min)} хв`,
    delayEarly: (min: number) => `на ${Math.abs(Math.round(min))} хв раніше`,
    stops: (n: number) => (isOne(n) ? '1 зупинка' : isFew(n) ? `${n} зупинки` : `${n} зупинок`),
    transfers: (n: number) =>
      isOne(n) ? '1 пересадка' : isFew(n) ? `${n} пересадки` : `${n} пересадок`,
    newDeparture: (at: string) => `новий рейс о ${at}`,
    delayTitle: (line: string, eta: string) => `Затримка • ${line} • ${eta}`,
  },
  ios: {
    departure: 'Відправлення',
    arrival: 'Прибуття',
    alighting: 'Вихід',
    walking: 'Пішки',
    waiting: 'Очікування',
    riding: 'У дорозі',
    transfer: 'Пересадка',
    nextStop: 'Наступна зупинка',
    startupTitle: 'Помилка застосунку',
    startupHint: 'Kilometr не може продовжити роботу. Поділіться звітом, щоб допомогти знайти причину помилки.',
    startupShare: 'Поділитися',
    locationPermission: 'Дозвольте доступ до геолокації, щоб шукати маршрути від вашого місця.',
    liveTitle: 'Жива активність',
    liveHint: 'Час поїздки на екрані блокування та в Dynamic Island. Дані оновлюються, коли застосунок активний.',
    liveDisabled: 'Увімкніть Живі активності в системних налаштуваннях Kilometr.',
    stale: 'За розкладом. Відкрийте Kilometr для оновлення.',
    alarmHint: 'Нагадування зі звуком сповіщення. Беззвучний режим і Зосередження можуть його заглушити. Повноекранний будильник не запускається.',
  },
  alarm: {
    title: 'Будильник на поїздку',
    set: 'Поставити будильник',
    edit: 'Змінити будильник',
    hint: 'Звук, вібрація та повний екран перед виходом.',
    question: 'Скільки часу потрібно перед виходом?',
    before: 'перед виходом',
    minutes: (n: number) => isOne(n) ? 'хвилина' : isFew(n) ? 'хвилини' : 'хвилин',
    lead: (n: number) => `За ${n} ${isOne(n) ? 'хвилину' : isFew(n) ? 'хвилини' : 'хвилин'} до виходу`,
    less: 'На хвилину пізніше',
    more: 'На хвилину раніше',
    ringsAt: (time: string) => `Задзвонить о ${time}`,
    journeyAt: (time: string) => `Вихід о ${time}`,
    boarding: (line: string, time: string, stop: string) => `${line} • ${time} • ${stop}`,
    save: 'Увімкнути будильник',
    saving: 'Налаштування будильника…',
    remove: 'Видалити будильник',
    preview: 'Перегляд будильника',
    ringTitle: 'Час збиратися',
    dismiss: 'Вимкнути будильник',
    showRoute: 'Показати сполучення',
    channel: 'Будильник на поїздку',
    channelDescription: 'Повноекранні будильники для вибраного сполучення.',
    unavailable: 'Установіть актуальний застосунок Kilometr, щоб налаштувати нагадування.',
    tooLate: 'Цей час уже минув. Вибери менше хвилин до виходу.',
    past: 'Ця поїздка вже почалася.',
    error: 'Не вдалося поставити будильник. Спробуй ще раз.',
    replace: 'Цей будильник замінить попередній, налаштований для іншої поїздки.',
    exactHint: 'Дозволь будильники й нагадування, щоб будильник задзвонив у вибраний час.',
    exactAction: 'Дозволити будильники',
    fullScreenHint: 'Дозволь повноекранні будильники, щоб будильник з’явився на заблокованому телефоні.',
    fullScreenAction: 'Дозволити повний екран',
    notificationHint: 'Увімкни сповіщення будильника, щоб телефон міг показати сигнал.',
    notificationAction: 'Увімкнути сповіщення',
    soundHint: 'Використовує звук і гучність будильника з налаштувань телефону.',
  },
  notificationPrefs: {
    title: 'Сповіщення',
    devBuildWarn: 'Потрібен девелопмент-збірка. У Expo Go сповіщення не працюють.',
    unsupportedTitle: 'Сповіщення недоступні',
    unsupportedBody:
      'Для відстеження поїздки потрібна девелопмент-збірка. Expo Go не підтримує сповіщення.',
    trackTitle: 'Відстеження поїздки',
    trackHint: 'Сповіщення з поточним етапом поїздки та даними маршруту.',
    liveTitle: 'Прогрес і таймер',
    liveHint: 'Система оновлює смугу маршруту й таймер, навіть коли застосунок закритий.',
    liveHintBasic:
      'Ця версія не підтримує live-прогрес. Сповіщення все одно показує етап поїздки й дані маршруту.',
    livePromoteHint:
      'Система не показує це сповіщення в Live Updates. Дозволь Live Updates у налаштуваннях сповіщень kilometr.',
    openNotificationSettings: 'Відкрити налаштування сповіщень',
    alertsTitle: 'Попередження',
    disruptionTitle: 'Попередження про затримку',
    disruptionHint: 'Коли рейс їде помітно пізніше, ніж показували раніше.',
    on: 'Увімк.',
    off: 'Вимк.',
  },
  pinned: {
    channel: 'Закріплене сполучення',
    nowText: 'відправлення зараз',
    inMin: (m: number) => `за ${m} хв`,
    tram: 'Трамвай',
    bus: 'Автобус',
    titleLine: (mode: string, line: string, time: string) => `${mode} ${line} • ${time}`,
    titlePlain: (time: string) => `Сполучення • ${time}`,
  },
  widgets: {
    journeyTitle: 'Твої напрямки',
    journeyDescription: 'Час виходу й маршрути до збережених і нещодавно знайдених місць',
    trackingTitle: 'Твоя поїздка',
    openApp: 'Знайти маршрут у Kilometr',
    addPlace: 'Додати місце',
    refresh: 'Оновити в застосунку',
    fromOrigin: (name: string) => `З: ${name}`,
    picker: {
      tripDescription: 'Час до виходу або прибуття, прогрес і пересадки',
      searchTitle: 'Куди їдемо?',
      searchDescription: 'Знайти маршрут або вибрати збережене місце',
      placesTitle: 'Мої місця',
      placesDescription: 'Знайти маршрут із поточного місця одним дотиком',
    },
    preview: { home: 'Дім', work: 'Робота', gym: 'Спортзал', school: 'Школа', origin: 'Центр' },
    checkRoutes: 'Знайти сполучення',
    early: (n: string) => `-${n} хв`,
    now: 'зараз',
    min: 'хв',
    onTime: 'Вчасно',
    timetable: 'Розклад',
    late: (n: string) => `+${n} хв`,
    departAt: (t: string) => `вихід ${t}`,
    departIn: (n: string) => `Виходь за ${n} хв`,
    departNow: 'Час виходити',
    arriveIn: (n: string) => `прибуття за ${n} хв`,
    arrived: 'На місці',
    updated: (t: string) => `станом на ${t}`,
    stale: 'Знайти наступне сполучення',
    destEmpty: 'Знайдіть маршрут, щоб побачити його тут.',
    tripEmptyTitle: 'Поїздка не відстежується',
    tripEmptyBody: 'Виберіть сполучення й увімкніть відстеження.',
    placesEmpty: 'Додайте своє перше місце',
    search: 'Куди їдемо?',
  },
};
