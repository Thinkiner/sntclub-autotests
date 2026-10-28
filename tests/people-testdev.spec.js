// ============================================================
// Смоук-тест: раздел «Люди» на testdev.sntclub.ru (ЛК Председателя)
// Тестовый фреймворк: Playwright Test (@playwright/test)
//
// Блоки по вкладкам НЕЗАВИСИМЫ (как в settings-snt.spec.js): если упал один тест,
// остальные продолжают выполняться. Последовательно (serial) идёт только цепочка
// «1.8 Тестовый человек», где шаги действительно зависят друг от друга.
//
//  0. Навигация по 4 вкладкам раздела
//  1. Люди:
//     1.1 Отображение кнопок, колонок, таблицы, пагинации
//     1.2 Поиск в строке «Поиск и фильтрация» по ФИО
//     1.3 Фильтры ФИО / Email / Телефон / Член СНТ / Max / Telegram / Согласие ПД → Найти → Сбросить
//     1.4 «Скачать Excel» и «Скачать логины/пароли»
//     1.5 Карточка Соснова: вкладки «Карточка», «Участки», «Верификации»
//     1.6 Редактирование Соснова: Отчество, Телефон, «Может голосовать (онлайн)» → вернуть
//     1.7 Валидация формы «+ Добавить» и кнопка «Отменить»
//     1.8 Тестовый человек (serial-цепочка): создание (все поля) → «Редактировать» из меню строки →
//         групповые действия ((де)активация голосования, инлайн-редактирование, «Создать ЛК (без email'а)»)
//         → удаление групповым «Удалить»
//  2. Настройка дополнительных полей:
//     2.1 Отображение, 2.2 валидация, 2.3 текстовое поле (обязательное + скрытое) → редактирование → удаление,
//     2.4 «Выпадающий список» / «Один из многих» / «Несколько из многих» с вариантами → удаление
//  3. Люди + доп. поле: свой тестовый человек и своё обязательное поле → проверка в карточке → удаление обоих
//  4. Верификация пользователей: таблица, фильтры, Excel, карточка, меню строки (без изменений)
//  5. Экспорт: скачивание .xlsx и проверка содержимого
//  6. Импорт: валидация, обновление Соснова через CSV → возврат вторым импортом
//
// Авторизация выполняется ОДИН раз на воркер (storageState), а не перед каждым тестом.
// Все изменения откатываются в блоках finally / afterAll.
//
// Запуск:
//   npx playwright test people-testdev.spec.js --workers=1 --headed
//   npx playwright test people-testdev.spec.js --workers=1 -g "4. Верификация"   ← только один блок
// ============================================================

const { test: base, expect } = require('@playwright/test');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// НАСТРОЙКИ ТЕСТА
// ─────────────────────────────────────────────────────────────
const TEST_USER = {
  email: 'test.ramos@mail.ru',
  password: 'Wqmyt1DZ7L',
};

const BASE_URL = 'https://testdev.sntclub.ru';

// ─────────────────────────────────────────────────────────────
// Учётные данные HTML-защиты тестовой площадки (Basic Auth)
// ─────────────────────────────────────────────────────────────
const BASIC_AUTH = {
  username: 'devsite',
  password: 'devsitesntclub',
};

/** Роль, которую выбираем после авторизации */
const ROLE = 'Председатель';

const TABS = [
  { name: 'Люди', path: '/snt/people/' },
  { name: 'Верификация пользователей', path: '/snt/regions/accounts/' },
  { name: 'Настройка дополнительных полей', path: '/snt/people/property/' },
  { name: 'Экспорт/Импорт', path: '/snt/people/import/' },
];

const PEOPLE_COLUMNS = ['ФИО', 'Email', 'Участки', 'Телефон',
  'Адрес места жительства', 'Может голосовать', 'Может голосовать онлайн', 'Вес голоса при голосовании',
  'Почтовый адрес', 'Доля Собственника', 'Член СНТ', 'Telegram', 'Max'];

const VERIFY_COLUMNS = ['Участок', 'Собственник', 'Пользователь', 'Email',
  'Последний вход в личный кабинет', 'Член СНТ', 'Статус'];

const PROPERTY_COLUMNS = ['Название поля', 'Тип', 'Обязательное?', 'Скрытое?'];

/** Существующий человек, которого редактируем и возвращаем как было */
const SOSNOV = {
  id: '244958',
  lastName: 'Соснов',
  name: 'Егор',
  secondName: 'Петрович',
  fio: 'Соснов Егор Петрович',
  email: 'sosnov_egor@mail.ru',
  phone: '+7 (999) 000-00-02',
  phoneDigits: '9990000002',
  address: 'г. Москва. ул. Каштановый бульвар. 6',
  sectors: ['6'],
};

/** Префикс тестовых сущностей — по нему делается очистка */
const TEST_PREFIX = 'Автотестов';

/** Флаг: остались ли неудалённые тестовые данные (чтобы afterAll не запускался вхолостую) */
let needsEmergencyCleanup = false;

/** Файл с cookies авторизованной сессии (общий для всех тестов воркера) */
const AUTH_FILE = path.join(os.tmpdir(), 'sntclub-people-testdev-auth.json');

/** Сколько минут переиспользовать сохранённую сессию между запусками */
const AUTH_MAX_AGE_MIN = 20;

/**
 * Авторизация один раз на воркер: логинимся, сохраняем cookies в AUTH_FILE,
 * каждый тест стартует уже авторизованным. Если сессия протухла — open() перелогинится сам.
 */
const test = base.extend({
  storageState: ({ workerStorageState }, use) => use(workerStorageState),
  workerStorageState: [async ({ browser }, use) => {
    const fresh = fs.existsSync(AUTH_FILE)
      && (Date.now() - fs.statSync(AUTH_FILE).mtimeMs) < AUTH_MAX_AGE_MIN * 60_000;
    if (!fresh) {
      const ctx = await browser.newContext({
        httpCredentials: { ...BASIC_AUTH, origin: BASE_URL },
      });
      const page = await ctx.newPage();
      await login(page);
      await ctx.storageState({ path: AUTH_FILE });
      await ctx.close();
    }
    await use(AUTH_FILE);
  }, { scope: 'worker' }],
});

// Basic Auth и разумные тайм-ауты на клики/ввод (15 с) и навигацию (30 с)
test.use({
  httpCredentials: { ...BASIC_AUTH, origin: BASE_URL },
  actionTimeout: 15_000,
  navigationTimeout: 30_000,
});

// ─────────────────────────────────────────────────────────────
// УТИЛИТЫ
// ─────────────────────────────────────────────────────────────

/** Уникальный суффикс по времени, например 15-37-37 */
function stamp() {
  return new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
}

function log(msg) {
  console.log(`  ${msg}`);
}

async function login(page) {
  // Стенд иногда отвечает медленно — одна повторная попытка загрузки страницы входа
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    if (await page.getByPlaceholder('Ivanov@mail.ru').isVisible({ timeout: 20_000 }).catch(() => false)) break;
    log(`Страница входа не загрузилась (попытка ${attempt})`);
  }
  await page.getByPlaceholder('Ivanov@mail.ru').fill(TEST_USER.email);
  await page.getByPlaceholder('******').fill(TEST_USER.password);
  await page.locator('#login-btn').click();

  // Экран выбора роли появляется не всегда
  const predRole = page.locator('a, button, div').filter({ hasText: new RegExp(`^${ROLE}$`) }).first();
  if (await predRole.isVisible({ timeout: 5_000 }).catch(() => false)) {
    log(`Экран выбора роли → «${ROLE}»`);
    await predRole.click();
  }
  await expect(page.locator('#topUser')).toBeVisible({ timeout: 25_000 });
}

async function open(page, p) {
  const url = `${BASE_URL}${p}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (e) {
    // Предыдущее действие (например, групповое действие Bitrix) могло запустить перезагрузку страницы
    if (/ERR_ABORTED|interrupted by another navigation/i.test(String(e))) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    } else {
      throw e;
    }
  }
  // Сессия протухла → нас выкинуло на форму входа: логинимся, обновляем AUTH_FILE, идём снова
  await page.locator('#pageMain, #login-btn').first().waitFor({ timeout: 15_000 }).catch(() => {});
  if (await page.locator('#login-btn').isVisible().catch(() => false)) {
    log('Сессия истекла — повторный вход');
    await login(page);
    await page.context().storageState({ path: AUTH_FILE });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
  await expect(page.locator('#pageMain')).toBeVisible();
}

/**
 * Открыть страницу с гридом и сбросить фильтр, если он остался от прошлого (упавшего) прогона.
 * Фильтр Bitrix хранится на сервере для пользователя и переживает перезапуск теста.
 */
async function openGrid(page, p) {
  await open(page, p);
  const find = page.locator('input[name="FIND"]');
  const searchText = await find.inputValue().catch(() => '');
  const squares = await page.locator('.main-ui-square:visible, .main-ui-filter-search-square:visible').count();
  if (searchText || squares) {
    log(`Остался фильтр от прошлого прогона («${searchText}», полей: ${squares}) — сбрасываем`);
    await resetFilter(page, { force: true });
  }
}

/** Проверка нативной HTML5-валидации поля */
async function validity(locator) {
  return locator.evaluate((el) => ({ valid: el.checkValidity(), message: el.validationMessage }));
}

/**
 * Регэксп «точный текст» с нормализацией пробелов (в вёрстке бывают двойные: «Член  СНТ»).
 * Для «Член СНТ» также подходит любая форма товарищества на стенде («Член СТС», «Член ТСН» и т.д.).
 */
function textRe(text) {
  if (text === 'Член СНТ') return /^\s*Член\s+\S+\s*$/i;
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\s*$`);
}

/** Видимые строки грида Bitrix */
function gridRows(page) {
  return page.locator('tr.main-grid-row-body:not([hidden])');
}

/** Строка грида Bitrix по тексту */
function gridRow(page, text) {
  return gridRows(page).filter({ hasText: text });
}

/** Ждём окончания ajax-перезагрузки грида */
async function waitGrid(page) {
  // Лоадер грида Bitrix для ожидания не годится: после ajax-перезагрузки его контейнер
  // остаётся в DOM «видимым» (ненулевой размер), а «.main-ui-loader» фильтра виден всегда.
  // Надёжный сигнал — ответ сервера (его ловит gridReload); здесь только даём DOM отрисоваться.
  await page.waitForTimeout(300);
}

/** Выполнить действие и дождаться ответа сервера с новым содержимым грида */
async function gridReload(page, action) {
  await Promise.all([
    page.waitForResponse((r) => /grid_id=|internal=true/.test(r.url()) && r.request().method() === 'POST', { timeout: 8_000 })
      .catch(() => log('  (ответ грида не дождались)')),
    action(),
  ]);
  await waitGrid(page);
}

/** Значения колонки грида по названию заголовка */
async function columnValues(page, header) {
  return page.evaluate((header) => {
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const row = [...document.querySelectorAll('tr.main-grid-row-body')].find(vis);
    if (!row) return [];
    const table = row.closest('table');
    const heads = [...table.querySelectorAll('tr.main-grid-row-head th')];
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const matchHeader = (t, h) => norm(t) === h || (h === 'Член СНТ' && /^Член\s+\S+$/i.test(norm(t)));
    const idx = heads.findIndex((th) => matchHeader(th.innerText, header));
    if (idx < 0) return null;
    return [...table.querySelectorAll('tr.main-grid-row-body')].filter(vis)
      .map((tr) => (tr.children[idx]?.innerText || '').trim());
  }, header);
}

/** Подтвердить действие: нативный confirm / #confirmBox / BX-попап */
async function confirmYes(page) {
  const yes = page.locator(
    '#confirmBox.active #btnYes, .popup__dialog.active #btnYes, ' +
    '.popup-window:visible .popup-window-button:has-text("OK"), ' +
    '.popup-window:visible .popup-window-button:has-text("Да"), ' +
    '.popup-window:visible .popup-window-button:has-text("Удалить"), ' +
    '.popup-window:visible .ui-btn:has-text("OK"), .popup-window:visible .ui-btn:has-text("Да"), ' +
    '.popup-window:visible .ui-btn:has-text("Удалить")'
  ).first();
  if (await yes.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await yes.click();
  }
}

/** Отменить подтверждение: #confirmBox / BX-попап */
async function confirmNo(page) {
  const no = page.locator(
    '#confirmBox.active #btnNo, .popup__dialog.active #btnNo, ' +
    '.popup-window:visible .popup-window-button:has-text("Отмена"), ' +
    '.popup-window:visible .ui-btn:has-text("Отмена"), .popup-window:visible .popup-window-button:has-text("Нет")'
  ).first();
  if (await no.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await no.click();
    return true;
  }
  return false;
}

/** Открыть меню «☰» строки грида и выбрать пункт по тексту */
async function gridRowAction(page, rowText, itemText) {
  const row = gridRow(page, rowText).first();
  await expect(row).toBeVisible();
  await row.locator('.main-grid-row-action-button').click();
  const item = page.locator('.menu-popup-item:visible', { hasText: itemText }).first();
  await expect(item).toBeVisible();
  await item.click();
}

/** Поиск в строке «Поиск и фильтрация» */
async function quickSearch(page, text) {
  const find = page.locator('input[name="FIND"]');
  const current = await find.inputValue().catch(() => '');
  const squares = await page.locator('.main-ui-square:visible, .main-ui-filter-search-square:visible').count();
  if (current === text && squares === 0) return;
  await find.fill(text);
  await gridReload(page, () => find.press('Enter'));
}

/** Открыть всплывающее окно фильтра */
async function openFilter(page) {
  const fields = page.locator('.main-ui-control-field:visible');
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(300); // дать закрыться предыдущему окну (анимация)
    if (await fields.first().isVisible().catch(() => false)) break;
    await page.locator('input[name="FIND"]').click();
    if (await fields.first().isVisible({ timeout: 3_000 }).catch(() => false)) break;
  }
  await expect(fields.first()).toBeVisible();
  const popup = page.locator('.main-ui-filter-wrapper:visible, .main-ui-popup:visible').last();
  await expect(popup.getByText('Найти', { exact: true })).toBeVisible();
  return popup;
}

/** Сбросить фильтр (кнопка «Сбросить» в окне фильтра) */
async function resetFilter(page, { force = false } = {}) {
  if (!force) {
    const searchText = await page.locator('input[name="FIND"]').inputValue().catch(() => '');
    const squares = await page.locator('.main-ui-square:visible, .main-ui-filter-search-square:visible').count();
    const popupOpen = await page.locator('.main-ui-control-field:visible').first().isVisible().catch(() => false);
    if (!searchText && !squares && !popupOpen) return;
  }
  const popup = await openFilter(page);
  await gridReload(page, () => popup.getByText('Сбросить', { exact: true }).click());
  if (await page.locator('.main-ui-control-field:visible').first().isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
  }
}

/** Выбрать значение в выпадающем списке фильтра Bitrix по подписи поля */
async function filterSelect(page, popup, label, value) {
  // В вёрстке встречаются двойные пробелы («Член  СНТ») и разные формы («Член СТС» и т.д.)
  const re = textRe(label);
  const field = page.locator('.main-ui-control-field:visible')
    .filter({ has: page.locator('.main-ui-control-field-label', { hasText: re }) }).first();
  await field.locator('div.main-ui-select').first().click();
  await page.locator('.main-ui-select-inner-item:visible').filter({ hasText: new RegExp(`^\\s*${value}\\s*$`) }).first().click();
  await expect(field.locator('.main-ui-select-name')).toHaveText(value);
}

/** Нажать «Найти» в окне фильтра */
async function filterApply(page, popup) {
  await gridReload(page, () => popup.getByText('Найти', { exact: true }).click());
}

/** Установить чек-бокс (в т.ч. стилизованный через label) */
async function setCheckbox(root, selector, checked) {
  const input = root.locator(selector).first();
  if ((await input.isChecked()) === checked) return;
  const id = await input.getAttribute('id');
  const label = id ? root.locator(`label[for="${id}"]`).first() : null;
  if (label && (await label.isVisible().catch(() => false))) await label.click();
  else await input.click({ force: true });
  await input.page().waitForTimeout(300);
  if ((await input.isChecked()) !== checked) {
    // Клик не сработал (форма ещё инициализировалась) — повторяем через setChecked
    await input.setChecked(checked, { force: true });
  }
  await expect(input).toBeChecked({ checked });
}

/** Ввод телефона в поле с маской */
async function typePhone(locator, digits) {
  const formatted = `+7 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
  await locator.click();
  await locator.press('ControlOrMeta+a');
  await locator.press('Backspace');
  await locator.pressSequentially(digits, { delay: 60 });
  if ((await locator.inputValue()) !== formatted) {
    // Маска иногда «съедает» символы при посимвольном вводе — вставляем готовое значение
    log(`  маска телефона дала «${await locator.inputValue()}», вставляем «${formatted}»`);
    await locator.fill('');
    await locator.fill(formatted);
  }
  await expect(locator).toHaveValue(formatted);
}

/** Отметить строку грида чек-боксом */
async function selectGridRow(page, rowText) {
  const row = gridRow(page, rowText).first();
  await expect(row).toBeVisible();
  await row.locator('.main-grid-cell-checkbox').click();
  await expect(row.locator('input[name="ID[]"]')).toBeChecked();
}

/** Групповое действие: выбрать пункт в «- Действия -» и нажать «Применить» */
async function groupAction(page, actionName) {
  await page.locator('#set-type_control').click();
  await page.locator('.menu-popup-item:visible', { hasText: actionName }).first().click();
  const apply = page.locator('#apply_button:visible, #edit_apply_button:visible, .main-grid-buttons.apply:visible').first();
  await expect(apply).toBeVisible();
  await apply.click();
  await confirmYes(page);
  // Bitrix после группового действия отправляет AJAX и может запустить reload страницы
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(600);
  await waitGrid(page);
}

/** Скачивание по клику: ждём событие download, возвращаем путь к файлу */
async function downloadByClick(page, locator, name) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 25_000 }),
    locator.click(),
  ]);
  const file = path.join(os.tmpdir(), `${Date.now()}-${name || dl.suggestedFilename()}`);
  await dl.saveAs(file);
  log(`Скачан файл «${dl.suggestedFilename()}» (${fs.statSync(file).size} байт)`);
  return { file, name: dl.suggestedFilename() };
}

/** Скачивание по ссылке: если браузер не начал загрузку, проверяем ответ сервера */
async function checkDownloadLink(page, link) {
  const href = await link.getAttribute('href');
  const dl = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }).catch(() => null),
    link.click(),
  ]).then(([d]) => d);
  if (dl) {
    const file = path.join(os.tmpdir(), `${Date.now()}-${dl.suggestedFilename()}`);
    await dl.saveAs(file);
    const size = fs.statSync(file).size;
    log(`Скачан «${dl.suggestedFilename()}» (${size} байт)`);
    expect(size).toBeGreaterThan(0);
    return;
  }
  log(`Событие download не пришло — проверяем ответ ${href}`);
  const resp = await page.request.get(`${BASE_URL}${href}`);
  expect(resp.status()).toBe(200);
  expect((await resp.body()).length).toBeGreaterThan(0);
}

/** Строки xlsx (первый лист) через unzip — без сторонних библиотек */
function readXlsx(file) {
  const unzip = (p) => execSync(`unzip -p "${file}" ${p}`, { maxBuffer: 50 * 1024 * 1024 }).toString('utf8');
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  let shared = [];
  try {
    shared = [...unzip('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => decode([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join('')));
  } catch { /* нет общих строк */ }
  const sheet = unzip('xl/worksheets/sheet1.xml');
  const colIdx = (ref) => ref.replace(/\d+/g, '').split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
    const out = [];
    for (const c of r[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, inner = ''] = c;
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      const is = (inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
      let val = '';
      if (/t="s"/.test(attrs)) val = shared[Number(v)] ?? '';
      else if (is !== undefined) val = decode(is);
      else if (v !== undefined) val = decode(v);
      out[colIdx(ref)] = val;
    }
    return Array.from(out, (x) => x ?? '');
  });
}

/** Iframe боковой панели (SIDE_SLIDER) по части URL */
async function sliderFrame(page, urlPart) {
  const frameEl = page.locator(`iframe[src*="${urlPart}"]`).last();
  await expect(frameEl).toBeVisible({ timeout: 15_000 });
  const frame = await (await frameEl.elementHandle()).contentFrame();
  // iframe сначала about:blank, потом грузит форму — ждём именно её и полную загрузку
  await expect.poll(() => frame.url(), { timeout: 15_000 }).toContain(urlPart);
  await frame.waitForLoadState('load');
  await frame.locator('form, body').first().waitFor();
  await page.waitForTimeout(350); // инициализация JS формы
  return frame;
}

/** Закрыть боковую панель */
async function closeSlider(page) {
  const close = page.locator('.side-panel-label-icon-close:visible, .side-panel-close:visible').first();
  if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) await close.click();
  else await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
}

/** Отменить незавершённую сессию импорта, если она есть */
async function cancelImportSession(page) {
  await open(page, '/snt/people/import/');
  const cancel = page.locator('#import-preview-area #btn-cancel');
  if (await cancel.isVisible({ timeout: 3_000 }).catch(() => false)) {
    log('Отменяем незавершённую сессию импорта');
    await cancel.click();
    await page.locator('.popup-window:visible').getByText('OK', { exact: true }).click();
    await expect(page.locator('#notice-existing-session')).toHaveCount(0, { timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
}

/** CSV для импорта (UTF-8 с BOM, разделитель «;») */
function writeCsv(rows) {
  const file = path.join(os.tmpdir(), `people-import-${Date.now()}.csv`);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  fs.writeFileSync(file, '\uFEFF' + rows.map((r) => r.map(esc).join(';')).join('\r\n'));
  return file;
}

/** Импорт файла: загрузить → проверить предпросмотр → применить */
async function importFile(page, file, expectValues) {
  await cancelImportSession(page);
  await page.locator('#import-file-input').setInputFiles(file);
  await expect(page.locator('#btn-upload')).toBeEnabled();
  await page.locator('#btn-upload').click();
  await expect(page.locator('#import-preview-area')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#pimport-tbody tr')).toHaveCount(1, { timeout: 30_000 });
  for (const [field, value] of Object.entries(expectValues)) {
    await expect(page.locator(`#pimport-tbody [data-field="${field}"]`)).toHaveValue(value);
  }
  await expect(page.locator('#pimport-errors-banner')).toBeHidden();
  await page.locator('#btn-apply').click();
  await confirmYes(page);
  await expect(page.locator('#import-preview-area #btn-apply')).toBeHidden({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  log(`Результат импорта: ${(await page.locator('.people-import-panel#panel-import').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
}

/** Удалить человека по тексту строки (через меню строки) */
async function deletePersonRow(page, rowText) {
  await gridRowAction(page, rowText, 'Удалить');
  await confirmYes(page);
  await waitGrid(page);
}

/** Удалить доп. поле по названию (через меню строки) */
async function deleteProperty(page, name) {
  await open(page, '/snt/people/property/');
  if ((await gridRow(page, name).count()) === 0) return;
  await gridRowAction(page, name, 'Удалить');
  await confirmYes(page);
  await expect(gridRow(page, name)).toHaveCount(0, { timeout: 15_000 });
  needsEmergencyCleanup = false;
}

/**
 * Заполнить существующие на стенде обязательные доп. поля (PROP[...]),
 * чтобы форма создания человека («+ Добавить») не блокировалась чужими полями стенда.
 */
async function fillRequiredCustomProps(root) {
  await root.locator('form, body').first().evaluate((container) => {
    for (const el of container.querySelectorAll('input[name^="PROP["][required], textarea[name^="PROP["][required]')) {
      if (el.type === 'radio' || el.type === 'checkbox') continue;
      if (!el.value) {
        el.value = 'Автотест';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    for (const sel of container.querySelectorAll('select[name^="PROP["][required]')) {
      if (!sel.value && sel.options.length > 0) {
        const opt = [...sel.options].find((o) => o.value !== '') || sel.options[0];
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    const names = new Set(
      [...container.querySelectorAll('input[type="radio"][name^="PROP["][required], input[type="checkbox"][name^="PROP["][required]')]
        .map((el) => el.name)
    );
    for (const name of names) {
      const group = [...container.querySelectorAll(`input[name="${CSS.escape(name)}"]`)];
      if (group.length > 0 && !group.some((el) => el.checked)) {
        group[0].checked = true;
        group[0].dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });
}

/**
 * Создать человека через «+ Добавить». Заполняются только переданные поля.
 * Возвращает объект с добавленным id.
 */
async function createPerson(page, p) {
  needsEmergencyCleanup = true;
  await open(page, '/snt/people/');
  await page.locator('#pageMain').getByText('+ Добавить', { exact: true }).first().click();
  const f = await sliderFrame(page, 'new=y');
  await f.locator('input[name="LAST_NAME"]').fill(p.lastName);
  await f.locator('input[name="NAME"]').fill(p.name);
  if (p.secondName) await f.locator('input[name="SECOND_NAME"]').fill(p.secondName);
  await f.locator('input[name="EMAIL"]').fill(p.email);
  if (p.phoneDigits) await typePhone(f.locator('input[name="PHONE"]'), p.phoneDigits);
  if (p.living) await f.locator('input[name="LIVING_ADDRESS"]').fill(p.living);
  if (p.post) await f.locator('input[name="POST_ADDRESS"]').fill(p.post);
  if (p.position) await f.locator('input[name="POSITION_TITLE"]').fill(p.position);
  if (p.isMember) await f.locator('select[name="IS_MEMBER"]').selectOption({ label: p.isMember });
  if (p.voteAccess !== undefined) await setCheckbox(f, 'input[name="VOTE_ACCESS"]', p.voteAccess);
  if (p.voteOnline !== undefined) await setCheckbox(f, 'input[name="VOTE_ONLINE"]', p.voteOnline);
  if (p.weight) await f.locator('input[name="VOTE_WEIGHT"]').fill(p.weight);
  if (p.share) await f.locator('input[name="OWNERS_SHARE"]').fill(p.share);
  await fillRequiredCustomProps(f);
  await savePersonForm(f);
  await page.waitForTimeout(1500);

  await open(page, '/snt/people/');
  await quickSearch(page, p.email);
  const row = gridRow(page, p.email).first();
  await expect(row, `человек ${p.email} появился в списке`).toBeVisible();
  const href = await row.locator('a', { hasText: p.lastName }).first().getAttribute('href');
  p.id = new URL(href, BASE_URL).searchParams.get('id');
  log(`Создан тестовый человек id=${p.id} (${p.email})`);
  return p;
}

/** Удалить человека по email (через меню строки), если он есть */
async function deletePersonByEmail(page, email) {
  await open(page, '/snt/people/');
  await quickSearch(page, email);
  if ((await gridRow(page, email).count()) > 0) {
    log(`Удаляем человека ${email}`);
    await deletePersonRow(page, email);
    await expect(gridRow(page, email)).toHaveCount(0, { timeout: 15_000 });
  }
  await resetFilter(page);
  needsEmergencyCleanup = false;
}

/** Создать доп. поле через «+ Добавить» */
async function createProperty(page, { name, type = 'text', required = false, onlyPred = false, variants = [] }) {
  needsEmergencyCleanup = true;
  await open(page, '/snt/people/property/');
  await page.locator('#pageMain').getByText('+ Добавить', { exact: true }).first().click();
  const f = await sliderFrame(page, '/snt/property/');
  await f.locator('#property-name').fill(name);
  await f.locator('#selectType').selectOption(type);
  for (let i = 0; i < variants.length; i++) await f.locator('input[name="VALUE[]"]').nth(i).fill(variants[i]);
  await setCheckbox(f, '#required-input', required);
  await setCheckbox(f, '#pred-access-input', onlyPred);
  await f.locator('button, input[type="submit"]').filter({ hasText: 'Добавить' }).last().click();
  await page.waitForTimeout(1200);
  await open(page, '/snt/people/property/');
  await expect(gridRow(page, name).first(), `доп. поле «${name}» создано`).toBeVisible();
}

/** Новый контекст с сохранённой авторизацией — для afterAll-очистки */
async function withAuthPage(browser, fn) {
  const ctx = await browser.newContext({
    storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
    httpCredentials: { ...BASIC_AUTH, origin: BASE_URL },
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  try {
    if (!fs.existsSync(AUTH_FILE)) await login(page);
    await fn(page);
  } catch (e) {
    console.warn(`  ⚠ Ошибка очистки: ${e.message}`);
  } finally {
    await ctx.close();
  }
}

/** Открыть форму редактирования Соснова */
async function openSosnovEdit(page) {
  await open(page, `/snt/people/detail/?edit=y&id=${SOSNOV.id}`);
  await expect(page.locator('input[name="LAST_NAME"]')).toBeVisible();
}

/** Сохранить форму человека */
async function savePersonForm(root) {
  await root.locator('button, input[type="submit"]').filter({ hasText: 'Сохранить' }).first().click();
}

// ─────────────────────────────────────────────────────────────
// ТЕСТЫ
// ─────────────────────────────────────────────────────────────

test.describe('Раздел «Люди» (testdev.sntclub.ru)', () => {
  // Тесты независимы: падение одного не останавливает остальные (как в settings-snt.spec.js)
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    page.on('dialog', (d) => d.accept().catch(() => {}));
  });

  // Страховочная очистка по префиксу — запускается только если в каком-то тесте остались неудалённые данные
  test.afterAll(async ({ browser }) => {
    if (!needsEmergencyCleanup) return;
    needsEmergencyCleanup = false;
    await withAuthPage(browser, async (page) => {
      await cancelImportSession(page).catch(() => {});

      await open(page, '/snt/people/property/');
      const props = await gridRows(page).filter({ hasText: 'Автотест' }).allInnerTexts();
      for (const row of props) {
        const name = row.split('\t').map((x) => x.trim()).find((x) => x.startsWith('Автотест'));
        if (name) {
          log(`Очистка: доп. поле «${name}»`);
          await deleteProperty(page, name).catch((e) => console.warn(`  ⚠ ${e.message}`));
        }
      }

      for (let i = 0; i < 5; i++) {
        await open(page, '/snt/people/');
        await quickSearch(page, TEST_PREFIX);
        if ((await gridRow(page, TEST_PREFIX).count()) === 0) break;
        log('Очистка: удаляем оставшегося тестового человека');
        await deletePersonRow(page, TEST_PREFIX).catch((e) => console.warn(`  ⚠ ${e.message}`));
      }
      await resetFilter(page).catch(() => {});
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 0. Навигация
  // ═══════════════════════════════════════════════════════════
  test('0. Навигация по всем вкладкам', async ({ page }) => {
    await open(page, '/snt/people/');
    for (const tab of TABS) {
      log(`Вкладка «${tab.name}»`);
      await page.locator(`a.tabs__link[href="${tab.path}"]`).first().click();
      await page.waitForURL(`${BASE_URL}${tab.path}`);
      await expect(page.locator('li.tabs__item.active a.tabs__link')).toHaveAttribute('href', tab.path);
      await expect(page.locator('body')).not.toContainText(/Fatal error|Страница не найдена/i);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 1. Люди
  // ═══════════════════════════════════════════════════════════
  test.describe('1. Люди', () => {
    const PATH = '/snt/people/';

    test('1.1 Отображение кнопок, колонок и таблицы', async ({ page }) => {
      await openGrid(page, PATH);
      for (const b of ['Скачать Excel', '+ Добавить', 'Скачать логины/пароли']) {
        await expect(page.locator('#pageMain').getByText(b, { exact: true }).first()).toBeVisible();
      }
      await expect(page.locator('input[name="FIND"]')).toBeVisible();
      for (const col of ['ФИО', 'Email', 'Участки', 'Телефон', 'Член СНТ']) {
        expect(await columnValues(page, col), `колонка «${col}»`).not.toBeNull();
      }
      expect(await gridRows(page).count()).toBeGreaterThan(0);
      await expect(gridRow(page, SOSNOV.fio).first()).toBeVisible();
      const next = page.locator('#pageMain a', { hasText: /следующая/i }).first();
      if (await next.isVisible().catch(() => false)) {
        log('Пагинация: переход на 2-ю страницу и обратно');
        const firstBefore = await gridRows(page).first().innerText();
        await next.click();
        await waitGrid(page);
        await expect.poll(async () => gridRows(page).first().innerText()).not.toBe(firstBefore);
        expect(await gridRows(page).count()).toBeGreaterThan(0);
        await page.locator('#pageMain a', { hasText: /предыдущая/i }).first().click();
        await waitGrid(page);
        await expect(gridRow(page, SOSNOV.fio).first()).toBeVisible();
      } else {
        log('Пагинация: всего 1 страница (<= 20 записей), переход не требуется');
      }
      // Чек-боксы настройки колонок присутствуют
      for (const col of PEOPLE_COLUMNS) {
        await expect(page.locator('label', { hasText: textRe(col) }).first()).toBeAttached();
      }
    });

    test('1.2 Поиск по ФИО', async ({ page }) => {
      await openGrid(page, PATH);
      try {
        log('Поиск «Соснов»');
        // Поиск полнотекстовый: ищет по всем полям (ФИО, улица и т.д.)
        await quickSearch(page, SOSNOV.lastName);
        await expect(gridRow(page, SOSNOV.fio).first()).toBeVisible();
        const rowsText = await gridRows(page).allInnerTexts();
        for (const t of rowsText) expect(t.toLowerCase()).toContain(SOSNOV.lastName.toLowerCase());

        log('Поиск по несуществующему значению → пустой список');
        await quickSearch(page, 'НетТакогоЧеловека12345');
        await expect(gridRow(page, SOSNOV.fio)).toHaveCount(0);
      } finally {
        await resetFilter(page);
      }
      await expect(gridRow(page, SOSNOV.fio).first()).toBeVisible();
    });

    test('1.3 Фильтры → Найти → Сбросить', async ({ page }) => {
      await openGrid(page, PATH);
      try {
        const textFilters = [
          { name: 'FIO', value: SOSNOV.lastName, column: 'ФИО', expect: SOSNOV.lastName },
          { name: 'EMAIL', value: SOSNOV.email, column: 'Email', expect: SOSNOV.email },
          { name: 'PHONE', value: SOSNOV.phone, column: 'ФИО', expect: SOSNOV.lastName },
        ];
        for (const f of textFilters) {
          log(`Фильтр ${f.name} = «${f.value}»`);
          const popup = await openFilter(page);
          await popup.locator(`input[name="${f.name}"]`).fill(f.value);
          await filterApply(page, popup);
          const vals = await columnValues(page, f.column);
          expect(vals.length, `фильтр ${f.name} что-то нашёл`).toBeGreaterThan(0);
          for (const v of vals) expect(v).toContain(f.expect);
          await resetFilter(page);
        }

        const selectFilters = [
          { label: 'Член СНТ', value: 'Да', column: 'Член СНТ', expect: 'Да' },
          { label: 'Член СНТ', value: 'Нет', column: 'Член СНТ', expect: 'Нет' },
          { label: 'Согласие на политику ПД', value: 'Есть', column: 'Согласие на политику ПД', expect: 'Есть', optional: true },
          { label: 'Может получать уведомления по Max?', value: 'Да' },
          { label: 'Может получать уведомления по Telegram?', value: 'Да' },
        ];
        for (const f of selectFilters) {
          const popup = await openFilter(page);
          if (f.optional && (await page.locator('.main-ui-control-field-label:visible', { hasText: textRe(f.label) }).count()) === 0) {
            log(`Фильтр «${f.label}» отсутствует на этом стенде — пропускаем`);
            continue;
          }
          log(`Фильтр «${f.label}» = «${f.value}»`);
          await filterSelect(page, popup, f.label, f.value);
          await filterApply(page, popup);
          await expect(page.locator('body')).not.toContainText(/Fatal error/i);
          if (f.column) {
            const vals = await columnValues(page, f.column);
            log(`  найдено строк: ${vals.length}`);
            for (const v of vals) expect(v).toBe(f.expect);
          } else {
            log(`  найдено строк: ${await gridRows(page).count()}`);
          }
          await resetFilter(page);
        }
      } finally {
        await resetFilter(page).catch(() => {});
      }
      await expect(gridRow(page, SOSNOV.fio).first()).toBeVisible();
    });

    test('1.4 Скачать Excel и Скачать логины/пароли', async ({ page }) => {
      await open(page, PATH);
      log('Скачать Excel');
      await checkDownloadLink(page, page.locator('#pageMain a', { hasText: 'Скачать Excel' }).first());
      await open(page, PATH);
      log('Скачать логины/пароли');
      await checkDownloadLink(page, page.locator('#pageMain a', { hasText: 'Скачать логины/пароли' }).first());
    });

    test('1.5 Карточка Соснова: вкладки Карточка / Участки / Верификации', async ({ page }) => {
      await open(page, PATH);
      log('Ссылка ФИО в списке ведёт на карточку (открывается в новой вкладке)');
      const link = page.locator('#pageMain a', { hasText: SOSNOV.fio }).first();
      await expect(link).toHaveAttribute('href', `/snt/people/detail/?id=${SOSNOV.id}`);
      const [card] = await Promise.all([page.context().waitForEvent('page', { timeout: 15_000 }), link.click()]);
      await card.waitForLoadState('domcontentloaded');
      await expect(card.locator('input[name="LAST_NAME"]')).toHaveValue(SOSNOV.lastName);
      await card.close();
      await open(page, `/snt/people/detail/?id=${SOSNOV.id}`);

      log('Вкладка «Карточка»');
      const main = page.locator('#pageMain');
      for (const label of ['Фамилия', 'Имя', 'Отчество', 'Email', 'Телефон', 'Адрес места жительства',
        'Почтовый адрес', 'Должность', 'Может голосовать', 'Может голосовать онлайн',
        'Вес голоса при голосовании', 'Доля Собственника']) {
        await expect(main.getByText(label, { exact: false }).first()).toBeVisible();
      }
      await expect(main.getByText(/Член\s+\S+/i).first()).toBeVisible();
      await expect(page.locator('input[name="LAST_NAME"]')).toHaveValue(SOSNOV.lastName);
      await expect(page.locator('input[name="NAME"]')).toHaveValue(SOSNOV.name);
      await expect(main).toContainText(SOSNOV.email);

      log('Вкладка «Участки»');
      await main.getByText('Участки', { exact: true }).first().click();
      for (const s of SOSNOV.sectors) {
        await expect(main.getByText(new RegExp(`№ участка\\s*${s}\\b`)).first()).toBeVisible();
      }
      const editSector = main.locator('a, button').filter({ hasText: /^\s*Редактировать\s*$/ }).locator('visible=true').first();
      await expect(editSector).toBeVisible();
      const href = await editSector.getAttribute('href');
      log(`«Редактировать» участок → ${href || 'без href'}`);
      await editSector.click();
      await page.waitForTimeout(2000);
      const opened = /sector|region/i.test(page.url())
        || (await page.locator('iframe[src*="sector"], iframe[src*="region"]').count()) > 0
        || (await page.locator('.side-panel:visible, .popup-window:visible').count()) > 0;
      expect(opened, 'открылась форма участка').toBe(true);
      log('Возвращаемся без сохранения');

      log('Вкладка «Верификации»');
      await open(page, `/snt/people/detail/?id=${SOSNOV.id}`);
      await page.locator('#pageMain').getByText('Верификации', { exact: true }).first().click();
      for (const id of ['SECTOR', 'FIO', 'U_FIO', 'EMAIL', 'LAST_LOGIN', 'IS_MEMBER', 'ACTION']) {
        await expect(page.locator(`#${id}-checkbox`)).toBeAttached();
      }
      await expect(gridRow(page, SOSNOV.email).first()).toBeVisible();
    });

    test('1.6 Редактирование Соснова: Отчество, Телефон, голосование → вернуть', async ({ page }) => {
      const newSecond = `${SOSNOV.secondName}Автотест`;
      const newPhoneDigits = '9990000099';
      await openSosnovEdit(page);
      const origVote = await page.locator('input[name="VOTE_ACCESS"]').isChecked();
      const origOnline = await page.locator('input[name="VOTE_ONLINE"]').isChecked();
      log(`Исходно: голосовать=${origVote}, онлайн=${origOnline}`);

      try {
        log('Меняем Отчество, Телефон и оба чек-бокса голосования');
        await page.locator('input[name="SECOND_NAME"]').fill(newSecond);
        await typePhone(page.locator('input[name="PHONE"]'), newPhoneDigits);
        await expect(page.locator('input[name="PHONE"]')).toHaveValue(/000-00-99/);
        await setCheckbox(page, 'input[name="VOTE_ACCESS"]', !origVote);
        await setCheckbox(page, 'input[name="VOTE_ONLINE"]', !origOnline);
        await savePersonForm(page);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1500);

        log('Проверяем сохранённые значения');
        await open(page, `/snt/people/detail/?id=${SOSNOV.id}`);
        await expect(page.locator('input[name="SECOND_NAME"]')).toHaveValue(newSecond);
        await expect(page.locator('input[name="PHONE"]')).toHaveValue(/000-00-99/);
        await expect(page.locator('input[name="VOTE_ACCESS"]')).toBeChecked({ checked: !origVote });
        await expect(page.locator('input[name="VOTE_ONLINE"]')).toBeChecked({ checked: !origOnline });
      } finally {
        log('Возвращаем исходные значения');
        await openSosnovEdit(page);
        await page.locator('input[name="SECOND_NAME"]').fill(SOSNOV.secondName);
        await typePhone(page.locator('input[name="PHONE"]'), SOSNOV.phoneDigits);
        await setCheckbox(page, 'input[name="VOTE_ACCESS"]', origVote);
        await setCheckbox(page, 'input[name="VOTE_ONLINE"]', origOnline);
        await savePersonForm(page);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1500);
      }
      await open(page, `/snt/people/detail/?id=${SOSNOV.id}`);
      await expect(page.locator('input[name="SECOND_NAME"]')).toHaveValue(SOSNOV.secondName);
      await expect(page.locator('input[name="PHONE"]')).toHaveValue(SOSNOV.phone);
      await expect(page.locator('input[name="VOTE_ACCESS"]')).toBeChecked({ checked: origVote });
      await expect(page.locator('input[name="VOTE_ONLINE"]')).toBeChecked({ checked: origOnline });
    });

    test('1.7 Форма «+ Добавить»: валидация и «Отменить»', async ({ page }) => {
      await open(page, PATH);
      await page.locator('#pageMain').getByText('+ Добавить', { exact: true }).first().click();
      const f = await sliderFrame(page, 'new=y');

      for (const name of ['LAST_NAME', 'NAME', 'SECOND_NAME', 'EMAIL', 'PHONE', 'LIVING_ADDRESS', 'POST_ADDRESS',
        'POSITION_TITLE', 'IS_MEMBER', 'VOTE_ACCESS', 'VOTE_ONLINE', 'VOTE_WEIGHT', 'OWNERS_SHARE']) {
        await expect(f.locator(`[name="${name}"]`).first()).toBeAttached();
      }

      log('Пустые Фамилия/Имя → не сохраняется');
      await savePersonForm(f);
      await page.waitForTimeout(800);
      expect((await validity(f.locator('input[name="LAST_NAME"]'))).valid).toBe(false);
      expect((await validity(f.locator('input[name="NAME"]'))).valid).toBe(false);
      await expect(page.locator('iframe[src*="new=y"]').last()).toBeVisible();

      log('Маска телефона: буквы не вводятся');
      await f.locator('input[name="PHONE"]').click();
      await f.locator('input[name="PHONE"]').pressSequentially('abcабв', { delay: 30 });
      expect(await f.locator('input[name="PHONE"]').inputValue()).not.toMatch(/[a-zа-я]/i);

      log('Некорректный Email → не сохраняется');
      const bad = `${TEST_PREFIX}Невалид-${stamp()}`;
      await f.locator('input[name="LAST_NAME"]').fill(bad);
      await f.locator('input[name="NAME"]').fill('Тест');
      await f.locator('input[name="EMAIL"]').fill('not-an-email');
      await f.locator('input[name="PHONE"]').fill('');
      await savePersonForm(f);
      await page.waitForTimeout(2500);
      const frameStillOpen = await page.locator('iframe[src*="new=y"]').last().isVisible().catch(() => false);
      const formText = frameStillOpen ? (await f.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ') : '';
      log(`После сохранения с плохим email форма открыта: ${frameStillOpen}. ${formText.slice(0, 300)}`);
      await open(page, PATH);
      await quickSearch(page, bad);
      if ((await gridRow(page, bad).count()) > 0) {
        // Известное поведение стенда: email не валидируется. Фиксируем, но не роняем весь прогон.
        const msg = 'БАГ: человек с некорректным email «not-an-email» сохраняется';
        console.warn(`  ⚠ ${msg}`);
        test.info().annotations.push({ type: 'bug', description: msg });
        await deletePersonRow(page, bad);
        await quickSearch(page, bad);
        await expect(gridRow(page, bad)).toHaveCount(0);
      }
      await resetFilter(page);

      log('«Отменить» закрывает форму без сохранения');
      const name = `${TEST_PREFIX}Отмена-${stamp()}`;
      await page.locator('#pageMain').getByText('+ Добавить', { exact: true }).first().click();
      const f2 = await sliderFrame(page, 'new=y');
      await f2.locator('input[name="LAST_NAME"]').fill(name);
      await f2.locator('input[name="NAME"]').fill('Тест');
      await f2.locator('button, a').filter({ hasText: /^\s*Отменить\s*$/ }).first().click();
      await page.waitForTimeout(1500);
      const stillOpen = await page.locator('iframe[src*="new=y"]:visible').count();
      log(`После «Отменить» боковая панель ${stillOpen ? 'осталась открытой' : 'закрылась'}`);
      if (stillOpen) await closeSlider(page);
      await open(page, PATH);
      await quickSearch(page, name);
      await expect(gridRow(page, name)).toHaveCount(0);
      await resetFilter(page);
    });

    // ─────────────────────────────────────────────────────────
    // 1.8 Тестовый человек — единственная цепочка зависимых шагов.
    // serial: при падении шага остальные шаги ЦЕПОЧКИ пропускаются,
    // но тесты других вкладок продолжают выполняться.
    // ─────────────────────────────────────────────────────────
    test.describe.serial('1.8 Тестовый человек: создание → редактирование → групповые действия → удаление', () => {
      let person = null;

      test.afterAll(async ({ browser }) => {
        if (!person) return;
        await withAuthPage(browser, (page) => deletePersonByEmail(page, person.email));
      });

      test('1.8.1 Создание (все поля)', async ({ page }) => {
        const s = stamp();
        person = await createPerson(page, {
          lastName: TEST_PREFIX,
          name: 'Тест',
          secondName: `Смоук${s.replace(/-/g, '')}`,
          email: `autotest.people.${Date.now()}@example.com`,
          phoneDigits: '9001234567',
          living: 'г. Москва, ул. Автотестовая, д. 1',
          post: 'г. Москва, а/я 1, Автотест',
          position: 'Тестировщик',
          isMember: 'Да',
          voteAccess: true,
          voteOnline: true,
          weight: '2',
          share: '50',
        });
        const p = person;
        const row = gridRow(page, p.email).first();
        await expect(row).toContainText(p.secondName);
        await expect(row).toContainText('(900) 123-45-67');

        log('Проверяем карточку');
        await open(page, `/snt/people/detail/?id=${p.id}`);
        await expect(page.locator('input[name="SECOND_NAME"]')).toHaveValue(p.secondName);
        await expect(page.locator('input[name="POSITION_TITLE"]')).toHaveValue(p.position);
        await expect(page.locator('select[name="IS_MEMBER"]')).toHaveValue('1');
        await expect(page.locator('input[name="VOTE_ACCESS"]')).toBeChecked();
        await expect(page.locator('input[name="VOTE_ONLINE"]')).toBeChecked();
        await expect(page.locator('input[name="VOTE_WEIGHT"]')).toHaveValue(p.weight);
        await expect(page.locator('input[name="OWNERS_SHARE"]')).toHaveValue(p.share);
        await expect(page.locator('#pageMain')).toContainText(p.living);
        await expect(page.locator('#pageMain')).toContainText(p.post);
      });

      test('1.8.2 Меню строки → «Редактировать»', async ({ page }) => {
        const p = person;
        await open(page, PATH);
        await quickSearch(page, p.email);
        const row = gridRow(page, p.email).first();
        await row.locator('.main-grid-row-action-button').click();
        for (const item of ['Редактировать', 'Удалить']) {
          await expect(page.locator('.menu-popup-item:visible', { hasText: item }).first()).toBeVisible();
        }
        await page.locator('.menu-popup-item:visible', { hasText: 'Редактировать' }).first().click();
        await page.waitForURL(/edit=y/);
        await expect(page.locator('input[name="LAST_NAME"]')).toHaveValue(p.lastName);

        p.position = 'Тестировщик (изменено)';
        log('Меняем Должность и Телефон');
        await page.locator('input[name="POSITION_TITLE"]').fill(p.position);
        await typePhone(page.locator('input[name="PHONE"]'), '9007654321');
        await savePersonForm(page);
        await page.waitForTimeout(1000);

        await open(page, `/snt/people/detail/?id=${p.id}`);
        await expect(page.locator('input[name="POSITION_TITLE"]')).toHaveValue(p.position);
        await expect(page.locator('input[name="PHONE"]')).toHaveValue(/765-43-21/);
      });

      test('1.8.3 Групповые действия', async ({ page }) => {
        const p = person;
        const checkCard = async (vote, online) => {
          await open(page, `/snt/people/detail/?id=${p.id}`);
          await expect(page.locator('input[name="VOTE_ACCESS"]')).toBeChecked({ checked: vote });
          await expect(page.locator('input[name="VOTE_ONLINE"]')).toBeChecked({ checked: online });
        };
        const prepare = async () => {
          await open(page, PATH);
          await quickSearch(page, p.email);
          await selectGridRow(page, p.email);
        };

        log('Список групповых действий');
        await prepare();
        await expect(page.getByText(/Отмечено:\s*1/i).first()).toBeVisible();
        await page.locator('#set-type_control').click();
        for (const a of ['Редактировать', 'Создать личный кабинет', 'Создать ЛК (без email',
          'Повторно отправить данные для входа', 'Активировать возможность голосовать',
          'Деактивировать возможность голосовать', 'Активировать возможность голосовать онлайн',
          'Деактивировать возможность голосовать онлайн', 'Удалить']) {
          await expect(page.locator('.menu-popup-item:visible', { hasText: a }).first()).toBeVisible();
        }
        await page.keyboard.press('Escape');

        const steps = [
          ['Деактивировать возможность голосовать онлайн', true, false],
          ['Деактивировать возможность голосовать', false, false],
          ['Активировать возможность голосовать', true, false],
          ['Активировать возможность голосовать онлайн', true, true],
        ];
        for (const [action, vote, online] of steps) {
          log(action);
          await prepare();
          await groupAction(page, action);
          await checkCard(vote, online);
        }

        log('Инлайн-редактирование: меняем Отчество');
        await prepare();
        await page.locator('#set-type_control').click();
        await page.locator('.menu-popup-item:visible', { hasText: /^\s*Редактировать\s*$/ }).first().click();
        await page.locator('#edit_apply_button_control').click();
        const secondField = page.locator(`input[name="FIELDS[${p.id}][SECOND_NAME]"]`);
        await expect(secondField, 'строка перешла в режим редактирования').toBeVisible();
        for (const f of ['LAST_NAME', 'NAME', 'SECOND_NAME', 'EMAIL', 'PHONE', 'IS_MEMBER']) {
          await expect(page.locator(`[name="FIELDS[${p.id}][${f}]"]`)).toBeVisible();
        }
        await expect(secondField).toHaveValue(p.secondName);
        const newSecond = `${p.secondName}Инлайн`;
        await secondField.fill(newSecond);
        await page.locator('button:visible, span:visible').filter({ hasText: /^\s*Сохранить\s*$/ }).last().click();
        await expect(secondField).toBeHidden({ timeout: 15_000 });
        await waitGrid(page);
        await open(page, `/snt/people/detail/?id=${p.id}`);
        await expect(page.locator('input[name="SECOND_NAME"]')).toHaveValue(newSecond);
        p.secondName = newSecond;

        log('Создать ЛК (без email\'а)');
        await prepare();
        await groupAction(page, 'Создать ЛК (без email');
        await open(page, PATH);
        await quickSearch(page, p.email);
        await gridRow(page, p.email).first().locator('.main-grid-row-action-button').click();
        await expect(page.locator('.menu-popup-item:visible', { hasText: 'Личный кабинет создан' }).first()).toBeVisible();
        await page.keyboard.press('Escape');
      });

      test('1.8.4 Удаление групповым действием «Удалить»', async ({ page }) => {
        const p = person;
        await open(page, PATH);
        await quickSearch(page, p.email);
        await selectGridRow(page, p.email);
        await groupAction(page, 'Удалить');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await quickSearch(page, p.email);
        await expect(gridRow(page, p.email)).toHaveCount(0, { timeout: 15_000 });
        person = null;
        needsEmergencyCleanup = false;
        await resetFilterSafe(page);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 2. Настройка дополнительных полей
  // ═══════════════════════════════════════════════════════════
  test.describe('2. Настройка дополнительных полей', () => {
    const PATH = '/snt/people/property/';

    async function openAddForm(page) {
      await open(page, PATH);
      await page.locator('#pageMain').getByText('+ Добавить', { exact: true }).first().click();
      return sliderFrame(page, '/snt/property/');
    }

    test('2.1 Отображение', async ({ page }) => {
      await open(page, PATH);
      await expect(page.locator('#pageMain').getByText('+ Добавить', { exact: true }).first()).toBeVisible();
      for (const col of PROPERTY_COLUMNS) {
        expect(await columnValues(page, col), `колонка «${col}»`).not.toBeNull();
        await expect(page.locator('label', { hasText: textRe(col) }).first()).toBeAttached();
      }
      if ((await gridRows(page).count()) > 0) {
        const row = gridRows(page).first();
        await expect(row).toBeVisible();
        await row.locator('.main-grid-row-action-button').click();
        for (const item of ['Редактировать', 'Удалить']) {
          await expect(page.locator('.menu-popup-item:visible', { hasText: item }).first()).toBeVisible();
        }
        await page.keyboard.press('Escape');
      }
    });

    test('2.2 Валидация: пустое название не сохраняется', async ({ page }) => {
      const f = await openAddForm(page);
      for (const t of ['Текстовое поле', 'Выпадающий список', 'Один из многих', 'Несколько из многих']) {
        await expect(f.locator('#selectType option', { hasText: t })).toBeAttached();
      }
      await expect(f.locator('#required-input')).toBeAttached();
      await expect(f.locator('#pred-access-input')).toBeAttached();
      await f.locator('button, input[type="submit"]').filter({ hasText: 'Добавить' }).last().click();
      await page.waitForTimeout(800);
      expect((await validity(f.locator('#property-name'))).valid).toBe(false);
      await closeSlider(page);
    });

    test('2.3 Текстовое поле (обязательное + только председателю) → редактирование → удаление', async ({ page }) => {
      const name = `Автотест текст ${stamp()}`;
      let current = name;
      try {
        await createProperty(page, { name, type: 'text', required: true, onlyPred: true });
        const row = gridRow(page, name).first();
        await expect(row).toContainText('Текстовое поле');
        const names = await columnValues(page, 'Название поля');
        const i = names.findIndex((n) => n === name);
        expect((await columnValues(page, 'Обязательное?'))[i], 'Обязательное? = Да').toBe('Да');
        expect((await columnValues(page, 'Скрытое?'))[i], 'Скрытое? = Да').toBe('Да');

        log('Редактирование: тип изменить нельзя, меняем название');
        await gridRowAction(page, name, 'Редактировать');
        const ef = await sliderFrame(page, '/snt/property/');
        await expect(ef.locator('#property-name')).toHaveValue(name);
        const typeDisabled = await ef.locator('#selectType').evaluate((el) => el.disabled || el.hasAttribute('readonly') || el.closest('[disabled]') !== null);
        expect(typeDisabled, 'тип поля нельзя изменить при редактировании').toBe(true);
        const newName = `${name} изм`;
        await ef.locator('#property-name').fill(newName);
        await ef.locator('button, input[type="submit"]').filter({ hasText: /Сохранить|Добавить/ }).last().click();
        await page.waitForTimeout(2000);
        await open(page, PATH);
        await expect(gridRow(page, newName).first()).toBeVisible();
        current = newName;
      } finally {
        log(`Удаляем «${current}»`);
        await deleteProperty(page, current);
        if (current !== name) await deleteProperty(page, name).catch(() => {});
      }
    });

    test('2.4 Списочные поля с вариантами → удаление', async ({ page }) => {
      const types = [
        { value: 'select', label: 'Выпадающий список' },
        { value: 'radio', label: 'Один из многих' },
        { value: 'checkbox', label: 'Несколько из многих' },
      ];
      for (const t of types) {
        const name = `Автотест ${t.label} ${stamp()}`;
        log(`Создаём «${name}»`);
        const f = await openAddForm(page);
        await f.locator('#property-name').fill(name);
        await f.locator('#selectType').selectOption(t.value);
        await expect(f.locator('.js-variants-list')).toBeVisible();
        await expect(f.locator('input[name="VALUE[]"]')).toHaveCount(3);
        log('  «+ Добавить вариант» и удаление варианта');
        await f.locator('.register-sites__add-variant').click();
        await expect(f.locator('input[name="VALUE[]"]')).toHaveCount(4);
        await f.locator('.register-sites__delete-variant').last().click();
        await expect(f.locator('input[name="VALUE[]"]')).toHaveCount(3);
        const variants = ['Вариант А', 'Вариант Б', 'Вариант В'];
        for (let i = 0; i < 3; i++) await f.locator('input[name="VALUE[]"]').nth(i).fill(variants[i]);
        await f.locator('button, input[type="submit"]').filter({ hasText: 'Добавить' }).last().click();
        await page.waitForTimeout(2000);

        try {
          await open(page, PATH);
          const row = gridRow(page, name).first();
          await expect(row).toBeVisible();
          await expect(row).toContainText(t.label);
          log('  Варианты сохранились');
          await gridRowAction(page, name, 'Редактировать');
          const ef = await sliderFrame(page, '/snt/property/');
          await expect(ef.locator('#property-name')).toHaveValue(name);
          const readVals = () => ef.locator('input[type="text"]').evaluateAll((els) => els.map((e) => `${e.name}=${e.value}`));
          await expect.poll(async () => (await readVals()).join('|'), { timeout: 10_000 }).toContain(variants[0]);
          const vals = (await readVals()).join('|');
          for (const v of variants) expect(vals).toContain(v);
          await closeSlider(page);
        } finally {
          log(`  Удаляем «${name}»`);
          await deleteProperty(page, name);
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 3. Люди + доп. поле (создаём обязательное поле → проверяем в карточке Соснова → удаляем поле)
  // ═══════════════════════════════════════════════════════════
  test('3. Обязательное доп. поле в карточке человека', async ({ page }) => {
    const propName = `Автотест обязательное ${stamp()}`;
    let propCreated = false;
    try {
      await createProperty(page, { name: propName, type: 'text', required: true, onlyPred: true });
      propCreated = true;

      await openSosnovEdit(page);
      const label = page.locator('#pageMain label', { hasText: propName }).first();
      await expect(label, 'доп. поле появилось в форме человека').toBeVisible();
      const forId = await label.getAttribute('for');
      const fieldInput = () => (forId
        ? page.locator(`[id="${forId}"]`)
        : page.locator('#pageMain label', { hasText: propName }).first().locator('xpath=following::input[1]'));

      log('Пустое обязательное доп. поле → не сохраняется');
      await fieldInput().fill('');
      await savePersonForm(page);
      await page.waitForTimeout(800);
      const v = await validity(fieldInput());
      const errText = await page.locator('#pageMain').innerText();
      expect(!v.valid || /обязател|заполн/i.test(errText), 'обязательное поле не даёт сохранить').toBe(true);

      log('Заполняем и сохраняем');
      await fillRequiredCustomProps(page);
      await fieldInput().fill('Значение автотеста');
      await savePersonForm(page);
      await page.waitForTimeout(1000);
      await open(page, `/snt/people/detail/?id=${SOSNOV.id}`);
      await expect(page.locator('#pageMain')).toContainText('Значение автотеста');
    } finally {
      if (propCreated) {
        log(`Удаляем доп. поле «${propName}»`);
        await deleteProperty(page, propName).catch((e) => console.warn(`  ⚠ ${e.message}`));
      }
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 4. Верификация пользователей
  // ═══════════════════════════════════════════════════════════
  test.describe('4. Верификация пользователей', () => {
    const PATH = '/snt/regions/accounts/';

    test('4.1 Таблица, колонки и статусы', async ({ page }) => {
      await openGrid(page, PATH);
      await expect(page.locator('#pageMain').getByText('Скачать Excel', { exact: true }).first()).toBeVisible();
      for (const col of VERIFY_COLUMNS) {
        expect(await columnValues(page, col), `колонка «${col}»`).not.toBeNull();
        await expect(page.locator('label', { hasText: textRe(col) }).first()).toBeAttached();
      }
      expect(await gridRows(page).count()).toBeGreaterThan(0);
      const icons = await gridRows(page).locator('svg use').evaluateAll((els) => [...new Set(els.map((e) => (e.getAttribute('xlink:href') || '').split('#')[1]))]);
      log(`Иконки статусов: ${icons.join(', ')}`);
      expect(icons.length).toBeGreaterThan(0);
    });

    test('4.2 Поиск и фильтры → Найти → Сбросить', async ({ page }) => {
      await open(page, PATH);
      try {
        log('Сначала сбрасываем сохранённый фильтр');
        await resetFilter(page, { force: true });

        log('Поиск «Соснов»');
        await quickSearch(page, SOSNOV.lastName);
        await expect(gridRow(page, SOSNOV.lastName).first()).toBeVisible();
        await resetFilter(page);

        const filters = [
          { name: 'SECTOR_NUMBER', value: '6', expect: SOSNOV.lastName },
          { name: 'SECTOR_STREET', value: 'Каштановый бульвар', expect: SOSNOV.lastName },
          { name: 'FIO', value: SOSNOV.lastName, expect: SOSNOV.lastName },
          { name: 'ACCOUNT_FIO', value: SOSNOV.lastName, expect: SOSNOV.lastName },
          { name: 'EMAIL', value: SOSNOV.email, expect: SOSNOV.email },
        ];
        for (const f of filters) {
          log(`Фильтр ${f.name} = «${f.value}»`);
          const popup = await openFilter(page);
          await popup.locator(`input[name="${f.name}"]`).fill(f.value);
          await filterApply(page, popup);
          await expect(gridRow(page, f.expect).first()).toBeVisible();
          await resetFilter(page);
        }

        for (const v of ['Да', 'Нет']) {
          log(`Фильтр «Верифицирован?» = «${v}»`);
          const popup = await openFilter(page);
          await filterSelect(page, popup, 'Верифицирован?', v);
          await filterApply(page, popup);
          await expect(page.locator('body')).not.toContainText(/Fatal error/i);
          log(`  найдено строк: ${await gridRows(page).count()}`);
          await resetFilter(page);
        }
      } finally {
        await resetFilter(page).catch(() => {});
      }
    });

    test('4.3 Скачать Excel', async ({ page }) => {
      await open(page, PATH);
      await checkDownloadLink(page, page.locator('#pageMain a', { hasText: 'Скачать Excel' }).first());
    });

    test('4.4 Клик по ФИО → карточка в боковой панели', async ({ page }) => {
      await openGrid(page, PATH);
      await quickSearch(page, SOSNOV.lastName);
      await gridRow(page, SOSNOV.email).first().locator('a', { hasText: SOSNOV.fio }).first().click();
      const f = await sliderFrame(page, '/snt/people/detail/');
      await expect(f.locator('input[name="LAST_NAME"]')).toHaveValue(SOSNOV.lastName);
      await closeSlider(page);
      await resetFilter(page);
    });

    test('4.5 Меню строки: «Верифицировать» (только открыть) и «Удалить заявку» (отмена)', async ({ page }) => {
      await openGrid(page, PATH);
      const unverifiedBtn = '.main-grid-row-action-button[data-actions*="Верифицировать"]';
      const row = gridRows(page).filter({ has: page.locator(unverifiedBtn) }).first();
      const rowText = (await row.innerText()).split('\t').map((s) => s.trim()).filter(Boolean).slice(0, 3).join(' | ');
      const email = (await row.innerText()).match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0];
      log(`Строка: ${rowText}`);
      await row.locator('.main-grid-row-action-button').click();
      await expect(page.locator('.menu-popup-item:visible', { hasText: 'Верифицировать пользователя' }).first()).toBeVisible();
      await expect(page.locator('.menu-popup-item:visible', { hasText: 'Удалить заявку' }).first()).toBeVisible();

      log('«Удалить заявку» → отменяем');
      let dialogSeen = false;
      page.removeAllListeners('dialog');
      page.once('dialog', (d) => { dialogSeen = true; log(`confirm: ${d.message()}`); d.dismiss(); });
      await page.locator('.menu-popup-item:visible', { hasText: 'Удалить заявку' }).first().click();
      const cancelled = await confirmNo(page);
      expect(dialogSeen || cancelled, 'было окно подтверждения').toBe(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      if (email) await expect(gridRow(page, email).first()).toBeVisible();

      log('«Верифицировать пользователя» → страница открывается, ничего не подтверждаем');
      const row2 = email ? gridRow(page, email).first() : gridRows(page).filter({ has: page.locator(unverifiedBtn) }).first();
      await row2.locator('.main-grid-row-action-button').click();
      await page.locator('.menu-popup-item:visible', { hasText: 'Верифицировать пользователя' }).first().click();
      await page.waitForURL(/\/snt\/regions\/verification\/\?id=\d+/, { timeout: 15_000 });
      await expect(page.locator('#pageMain')).toBeVisible();
      await expect(page.locator('body')).not.toContainText(/Fatal error|Страница не найдена/i);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 5. Экспорт
  // ═══════════════════════════════════════════════════════════
  test('5. Экспорт: скачивание .xlsx и проверка содержимого', async ({ page }) => {
    await cancelImportSession(page);
    await page.locator('#tab-export').click();
    await expect(page.locator('#panel-export')).toBeVisible();
    await expect(page.locator('#panel-export')).toContainText('ID собственника');
    const { file, name } = await downloadByClick(page, page.locator('#btn-export'));
    expect(name).toMatch(/\.xlsx$/);
    const rows = readXlsx(file);
    log(`Строк в файле: ${rows.length}`);
    expect(rows[0]).toEqual(expect.arrayContaining(['ID собственника', 'Фамилия', 'Имя', 'Отчество', 'Email', 'Телефон']));
    const sosnov = rows.find((r) => r[0] === SOSNOV.id);
    expect(sosnov, 'Соснов есть в выгрузке').toBeTruthy();
    expect(sosnov[1]).toBe(SOSNOV.lastName);
    expect(sosnov[4]).toBe(SOSNOV.email);
  });

  // ═══════════════════════════════════════════════════════════
  // 6. Импорт
  // ═══════════════════════════════════════════════════════════
  test.describe('6. Импорт', () => {
    test('6.1 Без файла кнопка неактивна; файл неверного формата', async ({ page }) => {
      await cancelImportSession(page);
      await page.locator('#tab-import').click();
      await expect(page.locator('#btn-upload')).toBeDisabled();
      await expect(page.locator('#import-file-input')).toHaveAttribute('accept', /\.xlsx/);

      log('Загружаем PDF');
      await page.locator('#import-file-input').setInputFiles(path.join(__dirname, 'fixtures', 'test-document.pdf'));
      if (await page.locator('#btn-upload').isEnabled()) {
        await page.locator('#btn-upload').click();
        await page.waitForTimeout(4000);
        const rowsInPreview = await page.locator('#pimport-tbody tr').count();
        const text = (await page.locator('#panel-import').innerText()).replace(/\s+/g, ' ');
        log(`Ответ: ${text.slice(0, 200)}`);
        expect(rowsInPreview, 'PDF не должен дать строк для импорта').toBe(0);
      } else {
        log('Кнопка осталась неактивной');
      }
      await cancelImportSession(page);
    });

    test('6.2 Обновление Соснова через CSV → возврат вторым импортом', async ({ page }) => {
      // Берём актуальную строку Соснова из экспорта, чтобы не затереть другие поля
      await cancelImportSession(page);
      await page.locator('#tab-export').click();
      const { file } = await downloadByClick(page, page.locator('#btn-export'));
      const rows = readXlsx(file);
      const header = rows[0];
      const orig = rows.find((r) => r[0] === SOSNOV.id);
      expect(orig).toBeTruthy();
      const iSecond = header.indexOf('Отчество');
      const original = [...orig];
      const changed = [...orig];
      changed[iSecond] = `${SOSNOV.secondName}Импорт`;

      try {
        log('Импорт изменённого отчества');
        await importFile(page, writeCsv([header, changed]), { USER_ID: SOSNOV.id, SECOND_NAME: changed[iSecond] });
        await open(page, `/snt/people/detail/?id=${SOSNOV.id}`);
        await expect(page.locator('input[name="SECOND_NAME"]')).toHaveValue(changed[iSecond]);
      } finally {
        log('Возвращаем исходные данные вторым импортом');
        await importFile(page, writeCsv([header, original]), { USER_ID: SOSNOV.id, SECOND_NAME: original[iSecond] });
      }
      await open(page, `/snt/people/detail/?id=${SOSNOV.id}`);
      await expect(page.locator('input[name="SECOND_NAME"]')).toHaveValue(SOSNOV.secondName);
      await expect(page.locator('input[name="PHONE"]')).toHaveValue(SOSNOV.phone);
    });
  });
});

/** Сброс фильтра на странице «Люди» без падения теста */
async function resetFilterSafe(page) {
  try {
    await open(page, '/snt/people/');
    await resetFilter(page);
  } catch { /* не критично */ }
}
