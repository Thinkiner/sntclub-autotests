// ============================================================
// Смоук-тест: раздел «Водопотребление → Тарифы» на release.sntclub.ru (ЛК Председателя)
// Тестовый фреймворк: Playwright Test (@playwright/test)
//
// Архитектура (как в energy-tariffs.spec.js и people.spec.js):
// Тест разбит на независимые этапы по подразделам в строгом порядке:
//  0. Навигация по всем 4 вкладкам раздела «Водопотребление → Тарифы»
//  1. Подраздел «Тарифы» (/snt/bookkeeping/tariffs/water/):
//     1.1 Отображение вкладок, кнопок, карточек тарифов («Тестовый тариф» и «Автотест Проверка»),
//         таблицы периодов, переключение между тарифами + поиск и фильтрация по периодам
//     1.2 Редактирование тарифа «Автотест Проверка» (id=220): изменение названия тарифа и редактирование
//         периода (стоимость + потери и переключение типа потерь % ↔ руб/м³) → проверка → возврат исходных данных
//     1.3 Валидация и переключение параметров в модальных окнах «+ Добавить тариф» и «+ Добавить новый период»
//         (без сохранения, т.к. в разделе водопотребления нет удаления тарифов и периодов)
//  2. Подраздел «Счетчики» (/snt/bookkeeping/tariffs/water/counters/):
//     2.1 Отображение шагов импорта, ссылок шаблонов, кнопок, переключателей и всех 10 колонок таблицы
//     2.2 Скачивание обоих файлов-шаблонов (.xlsx): для массового добавления счётчиков и показаний
//     2.3 Быстрый поиск и фильтрация по 3 полям: Участок, Марка счётчика, Название тарифа → Найти → Сбросить
//     2.4 Импорт («Загрузить данные»): валидация без файла + загрузка .xlsx со счётчиком (шаги 1→2→3) → проверка → удаление
//  3. Подраздел «Действующие счётчики» (/snt/bookkeeping/tariffs/water/counters/?mode=active):
//     3.1 Редактирование существующего счётчика участка №3 (Огородова М.В., id=4265) — Марка, Серийный номер,
//         Номер пломбы → проверка в таблице → возврат исходных данных
//     3.2 Валидация пустой формы «Добавить счётчик» и проверка чек-бокса «Добавить в Календарь событий»
//  4. Действия с действующими и архивными счётчиками (?mode=active и ?mode=archive):
//     4.1 Полный цикл тестового счётчика на участке №14 (показания 0, с датой поверки):
//         создание → «Добавить в Календарь событий» и «Удалить из Календаря событий» (из меню «☰» и групповым действием) →
//         перевод «Убрать в архив» → проверка во вкладке «Архивные счётчики» →
//         возврат «Активировать» → проверка в «Действующих счётчиках» → повторный перевод «Убрать в архив» →
//         удаление кнопкой «Удалить счётчики без показаний» во вкладке «Архивные счётчики»
//
// Авторизация выполняется ОДИН раз на воркер (storageState).
// Все изменения откатываются в блоках finally / afterAll.
//
// Запуск:
//   npx playwright test water-tariffs-release.spec.js --workers=1 --headed
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

const BASE_URL = 'https://release.sntclub.ru';

// ─────────────────────────────────────────────────────────────
// Учётные данные HTML-защиты тестовой площадки (Basic Auth)
// ─────────────────────────────────────────────────────────────
const BASIC_AUTH = {
  username: 'devsite',
  password: 'devsitesntclub',
};

/** Роль, которую выбираем после авторизации */
const ROLE = 'Председатель';

/** ID текущего СНТ на стенде (используется в delEmptyCounters) */
const SNT_ID = '17487';

/** Вкладки / подразделы раздела «Водопотребление → Тарифы» */
const TABS = [
  { name: 'Тарифы', path: '/snt/bookkeeping/tariffs/water/' },
  { name: 'Счетчики', path: '/snt/bookkeeping/tariffs/water/counters/' },
  { name: 'Действующие счётчики', path: '/snt/bookkeeping/tariffs/water/counters/?mode=active' },
  { name: 'Архивные счётчики', path: '/snt/bookkeeping/tariffs/water/counters/?mode=archive' },
];

/** Колонки таблицы периодов тарифа во вкладке «Тарифы» */
const TARIFF_PERIOD_COLUMNS = [
  'Стоимость тарифа, руб.',
  'Потери',
  'Дата начала',
  'Дата окончания',
];

/** Колонки таблицы счётчиков воды */
const COUNTER_COLUMNS = [
  'Участок',
  'Улица',
  'Собственники',
  'Марка счётчика',
  'Серийный номер',
  'Номер пломбы',
  'Название тарифа',
  'Показания',
  'Следующая дата поверки',
  'В календаре',
];

/** Основной тариф водопотребления (с историей периодов) */
const MAIN_TARIFF = {
  id: '152',
  name: 'Тестовый тариф',
  samplePriceFilter: '4',
  samplePriceDisplay: '4.00',
  samplePeriodBegin: '01.04.2025',
};

/** Второй тариф («Тариф весна-лето», id=163), на котором проверяем редактирование названия и периода */
const SECOND_TARIFF = {
  id: '163',
  name: 'Тариф весна-лето',
  periodId: '209',
  originalPrice: '5.50',
  originalLosses: '0.25',
  originalLossesDisplay: '0.25 %',
  originalLossesTypeVal: '32', // 32 = %, 33 = руб/м³
  dateBegin: '01.04.2025',
  dateEnd: '31.08.2025',
  nextPeriodBegin: '01.01.2026',
};

/** Существующий действующий счётчик участка №3 (Огородова Майа Вадимовна), который редактируем и возвращаем */
const COUNTER_UNIT_3 = {
  id: '4095',
  sectorId: '253538',
  unitNumber: '3',
  street: 'Тополевый тупик',
  ownerFio: 'Огородова Майа Вадимовна',
  brand: 'Agua fuerte',
  serial: 'P14566987',
  plomb: '23D50001',
  tariffId: '152',
  tariffName: 'Тестовый тариф',
};

/** Свободный участок без активного водного счётчика для тестирования импорта и полного цикла */
const FREE_UNIT = {
  sectorId: '255482',
  number: '8',
  street: 'Ивовая набережная',
};

/** Префикс тестовых сущностей — по нему делается очистка */
const TEST_PREFIX = 'Автотест';

/** Флаг: остались ли неудалённые тестовые счётчики (чтобы afterAll не запускался вхолостую) */
let needsEmergencyCleanup = false;

/** Файл с cookies авторизованной сессии (общий для всех тестов воркера) */
const AUTH_FILE = path.join(os.tmpdir(), 'sntclub-water-tariffs-release-auth.json');

/** Сколько минут переиспользовать сохранённую сессию между запусками */
const AUTH_MAX_AGE_MIN = 20;

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

test.use({
  httpCredentials: { ...BASIC_AUTH, origin: BASE_URL },
  actionTimeout: 15_000,
  navigationTimeout: 25_000,
});

// ─────────────────────────────────────────────────────────────
// УТИЛИТЫ
// ─────────────────────────────────────────────────────────────

function stamp() {
  return new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
}

function log(msg) {
  console.log(`  ${msg}`);
}

async function login(page) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    if (await page.getByPlaceholder('Ivanov@mail.ru').isVisible({ timeout: 20_000 }).catch(() => false)) break;
    log(`Страница входа не загрузилась (попытка ${attempt})`);
  }
  await page.getByPlaceholder('Ivanov@mail.ru').fill(TEST_USER.email);
  await page.getByPlaceholder('******').fill(TEST_USER.password);
  await page.locator('#login-btn').click();

  const predRole = page.locator('a, button, div').filter({ hasText: new RegExp(`^${ROLE}$`) }).first();
  if (await predRole.isVisible({ timeout: 5_000 }).catch(() => false)) {
    log(`Экран выбора роли → «${ROLE}»`);
    await predRole.click();
  }
  await expect(page.locator('#topUser')).toBeVisible({ timeout: 25_000 });
}

async function open(page, p) {
  const url = `${BASE_URL}${p}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      break;
    } catch (e) {
      if (attempt < 3 && /ERR_ABORTED|interrupted by another navigation|Timeout/i.test(String(e))) {
        await page.waitForTimeout(1000);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
      } else {
        throw e;
      }
    }
  }
  await page.locator('#pageMain, #login-btn').first().waitFor({ timeout: 30_000 }).catch(() => {});
  if (await page.locator('#login-btn').isVisible().catch(() => false)) {
    log('Сессия истекла — повторный вход');
    await login(page);
    await page.context().storageState({ path: AUTH_FILE });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
  await expect(page.locator('#pageMain')).toBeVisible();
}

/** Открыть страницу с гридом и сбросить фильтр, если он остался от прошлого теста */
async function openGrid(page, p) {
  await open(page, p);
  const find = page.locator('input[name="FIND"]');
  if ((await find.count()) === 0) return;
  const searchText = await find.inputValue().catch(() => '');
  const squares = await page.locator('.main-ui-filter-search .main-ui-square:visible, .main-ui-square:visible').count();
  if (searchText || squares) {
    log(`Остался фильтр («${searchText}», полей: ${squares}) — сбрасываем`);
    await resetFilter(page);
  }
}

/** Проверка нативной HTML5-валидации поля */
async function validity(locator) {
  return locator.evaluate((el) => ({ valid: el.checkValidity(), message: el.validationMessage }));
}

/** Видимые строки грида Bitrix */
function gridRows(page) {
  return page.locator('tr.main-grid-row-body:not([hidden])');
}

/** Строка грида Bitrix по тексту */
function gridRow(page, text) {
  return gridRows(page).filter({ hasText: text });
}

async function waitGrid(page) {
  await page.waitForTimeout(250);
}

async function gridReload(page, action) {
  await Promise.all([
    page.waitForResponse((r) => /grid_id=|internal=true/.test(r.url()) && r.request().method() === 'POST', { timeout: 15_000 })
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
    const idx = heads.findIndex((th) => th.innerText.replace(/\s+/g, ' ').trim() === header);
    if (idx < 0) return null;
    return [...table.querySelectorAll('tr.main-grid-row-body')].filter(vis)
      .map((tr) => (tr.children[idx]?.innerText || '').trim());
  }, header);
}

/** Подтвердить действие в BX-попапе / MessageBox */
async function confirmYes(page) {
  const yes = page.locator(
    '#confirmBox.active #btnYes, .popup__dialog.active #btnYes, ' +
    '.popup-window:visible .popup-window-button:has-text("OK"), ' +
    '.popup-window:visible .popup-window-button:has-text("ОК"), ' +
    '.popup-window:visible .popup-window-button:has-text("Да"), ' +
    '.popup-window:visible .popup-window-button:has-text("Удалить"), ' +
    '.popup-window:visible .ui-btn:has-text("OK"), ' +
    '.popup-window:visible .ui-btn:has-text("ОК"), ' +
    '.popup-window:visible .ui-btn:has-text("Да"), ' +
    '.popup-window:visible .ui-btn:has-text("Удалить"), ' +
    '.popup-window:visible .ui-btn-primary'
  ).first();
  await expect(yes).toBeVisible({ timeout: 5_000 });
  await yes.click();
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
  await find.fill(text);
  await gridReload(page, () => find.press('Enter'));
}

/** Открыть всплывающее окно фильтра */
async function openFilter(page) {
  const fields = page.locator('.main-ui-control-field:visible, .main-ui-control-field-group:visible');
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(350);
    if (await fields.first().isVisible().catch(() => false)) break;
    await page.locator('input[name="FIND"]').click();
    if (await fields.first().isVisible({ timeout: 3_000 }).catch(() => false)) break;
  }
  await expect(fields.first()).toBeVisible();
  const popup = page.locator('.main-ui-filter-wrapper:visible, .main-ui-popup:visible').last();
  await expect(popup.getByText('Найти', { exact: true })).toBeVisible();
  return popup;
}

/** Сбросить фильтр */
async function resetFilter(page) {
  const popup = await openFilter(page);
  await gridReload(page, () => popup.getByText('Сбросить', { exact: true }).click());
  if (await page.locator('.main-ui-control-field:visible').first().isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(300);
}

/** Выбрать значение в multi-select / select поле фильтра Bitrix по подписи поля */
async function filterMultiSelect(page, label, value) {
  const re = new RegExp(`^\\s*${label.replace(/[?()]/g, '\\$&').replace(/\s+/g, '\\s+')}\\s*$`);
  const field = page.locator('.main-ui-control-field:visible, .main-ui-control-field-group:visible')
    .filter({ has: page.locator('.main-ui-control-field-label', { hasText: re }) }).first();
  await field.locator('.main-ui-select, .main-ui-multi-select').first().click();
  const item = page.locator('.main-ui-select-inner-item:visible, .popup-window:visible .main-ui-select-inner-item')
    .filter({ hasText: new RegExp(`^\\s*${value}\\s*$`) }).first();
  await expect(item).toBeVisible();
  await item.click();
  // Закрываем выпадающий список кликом по заголовку поля
  await field.locator('.main-ui-control-field-label').first().click();
}

async function filterApply(page, popup) {
  await gridReload(page, () => popup.getByText('Найти', { exact: true }).click());
}

/**
 * Дождаться загрузки AJAX-формы внутри модального окна #popup (#popupContainer)
 * и завершения инициализации её встроенных скриптов (BX.ready).
 */
async function waitPopupForm(page, formSelector) {
  const form = page.locator(`#popup ${formSelector}`).first();
  await expect(form).toBeVisible({ timeout: 15_000 });
  // Даём BX.ready подгрузить зависимые бандлы (money-editor, bx.currency) и навесить submit-обработчик
  await page.waitForTimeout(500);
  return form;
}

/** Закрыть модальное окно #popup */
async function closePopupModal(page) {
  const closeBtn = page.locator('#popup .popup__close:visible').first();
  if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await closeBtn.click();
  } else {
    await page.evaluate(() => { if (typeof closePopup === 'function') closePopup(); });
  }
  await page.waitForTimeout(250);
}

/** Отправить форму в модальном окне #popup и дождаться POST-ответа + перезагрузки страницы */
async function submitPopupForm(page, formLocator, ajaxUrlPart) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(ajaxUrlPart), { timeout: 20_000 }),
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {}),
    formLocator.locator('button[type="submit"]').click(),
  ]);
  await expect(page.locator('#popup')).not.toHaveClass(/active/, { timeout: 15_000 });
  await expect(page.locator('#pageMain')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
}

/** Установить чек-бокс или радиокнопку (в том числе со скрытым input и кликабельным label) */
async function setCheckbox(root, selector, checked) {
  const input = root.locator(selector).first();
  if ((await input.isChecked()) === checked) return;
  const id = await input.getAttribute('id');
  const label = id ? root.locator(`label[for="${id}"]`).first() : null;
  if (label && (await label.isVisible().catch(() => false))) await label.click();
  else await input.click({ force: true });
  await input.page().waitForTimeout(200);
  if ((await input.isChecked()) !== checked) {
    await input.setChecked(checked, { force: true });
  }
  await expect(input).toBeChecked({ checked });
}

/** Установить дату в поле flatpickr / custom-date */
async function setDateInput(root, selector, dateStr) {
  await root.locator(selector).first().evaluate((el, val) => {
    if (el._flatpickr) {
      el._flatpickr.setDate(val, true, 'd.m.Y');
    }
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, dateStr);
}

/** Отметить строку грида чек-боксом */
async function selectGridRow(page, rowText) {
  const row = gridRow(page, rowText).first();
  await expect(row).toBeVisible();
  if (!(await row.locator('input[name="ID[]"]').isChecked())) {
    await row.locator('td.main-grid-cell-checkbox').click({ force: true });
  }
  await expect(row.locator('input[name="ID[]"]')).toBeChecked();
}

/** Выбрать групповое действие в панели грида счётчиков и нажать «Применить» */
async function applyCounterGroupAction(page, actionLabel) {
  const dropdown = page.locator('#snt-counter-cal-action_control').first();
  await expect(dropdown).toBeVisible();
  await dropdown.click();
  const item = page.locator('.menu-popup-item:visible', { hasText: actionLabel }).first();
  await expect(item).toBeVisible();
  await item.click();
  const applyBtn = page.locator('#apply_button').first();
  await expect(applyBtn).toBeVisible();
  await applyBtn.click();
}

/** Выполнить действие с Календарём событий и дождаться POST-запроса */
async function performCalendarAction(page, action) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 20_000 }),
    action(),
  ]);
  await waitGrid(page);
}

/**
 * Подтвердить перевод водного счётчика «Убрать в архив» / «Вернуть из архива» в попапе #popup
 * и дождаться завершения AJAX-запроса active.php + перезагрузки страницы.
 */
async function confirmWaterArchivePopup(page, btnText) {
  const btn = page.locator('#popup button.event-delete-data', { hasText: btnText }).first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/local/ajax/water/counters/active.php'), { timeout: 20_000 }),
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {}),
    btn.click(),
  ]);
  await expect(page.locator('#popup')).not.toHaveClass(/active/, { timeout: 15_000 });
  await expect(page.locator('#pageMain')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
}

/**
 * Быстрое удаление тестового водного счётчика без показаний по его ID:
 * переводит счётчик в архив и запускает штатную очистку пустых счётчиков воды.
 */
async function deleteWaterCounterById(page, counterId) {
  await page.evaluate(async ({ id, sntId }) => {
    const sessid = document.querySelector('#sessid')?.value || window.BX?.bitrix_sessid?.() || '';
    try {
      await fetch(`/local/ajax/water/counters/active.php?sessid=${sessid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ itemId: String(id), active: 'false' }).toString(),
      });
    } catch { /* уже в архиве */ }
    try {
      await fetch('/local/ajax/del_empty_counters.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ sntId: String(sntId), type: 'water' }).toString(),
      });
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 700));
        const res = await fetch('/local/ajax/test_block_script.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ sntId: String(sntId), type: 'water' }).toString(),
        });
        const json = await res.json().catch(() => ({}));
        if (json.success === true) break;
      }
    } catch { /* игнорируем */ }
  }, { id: counterId, sntId: SNT_ID });
}

/** Аварийная очистка тестовых счётчиков по серийному номеру (или марке) */
async function cleanupWaterCounterByText(page, text) {
  for (const url of [
    '/snt/bookkeeping/tariffs/water/counters/?mode=active',
    '/snt/bookkeeping/tariffs/water/counters/?mode=archive',
  ]) {
    await openGrid(page, url);
    const ids = await gridRow(page, text).evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-id')).filter(Boolean));
    for (const id of ids) {
      log(`Очистка тестового водного счётчика id=${id} («${text}»)`);
      await deleteWaterCounterById(page, id);
    }
  }
}

/** Строки xlsx (первый лист) через unzip */
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

/** Создать минимальный валидный .xlsx файл из двумерного массива строк */
function writeXlsx(filePath, rows) {
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const colLetter = (idx) => {
    let s = '';
    let n = idx + 1;
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };

  const sheetRows = rows.map((row, rIdx) => {
    const rNum = rIdx + 1;
    const cells = row.map((val, cIdx) => {
      const ref = `${colLetter(cIdx)}${rNum}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${esc(val)}</t></is></c>`;
    }).join('');
    return `<row r="${rNum}">${cells}</row>`;
  }).join('');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-'));
  fs.mkdirSync(path.join(tmpDir, '_rels'));
  fs.mkdirSync(path.join(tmpDir, 'xl'));
  fs.mkdirSync(path.join(tmpDir, 'xl', '_rels'));
  fs.mkdirSync(path.join(tmpDir, 'xl', 'worksheets'));

  fs.writeFileSync(path.join(tmpDir, '[Content_Types].xml'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`);

  fs.writeFileSync(path.join(tmpDir, '_rels', '.rels'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`);

  fs.writeFileSync(path.join(tmpDir, 'xl', 'workbook.xml'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`);

  fs.writeFileSync(path.join(tmpDir, 'xl', '_rels', 'workbook.xml.rels'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`);

  fs.writeFileSync(path.join(tmpDir, 'xl', 'worksheets', 'sheet1.xml'),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${sheetRows}</sheetData>` +
    `</worksheet>`);

  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  execSync(`cd "${tmpDir}" && zip -q -r "${filePath}" .`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────
// ТЕСТЫ
// ─────────────────────────────────────────────────────────────

test.describe('Раздел «Водопотребление → Тарифы» (ЛК Председателя)', () => {
  test.setTimeout(240_000);

  test.afterAll(async ({ browser }) => {
    if (!needsEmergencyCleanup) return;
    const ctx = await browser.newContext({
      storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
      httpCredentials: { ...BASIC_AUTH, origin: BASE_URL },
    });
    const page = await ctx.newPage();
    try {
      await cleanupWaterCounterByText(page, /Автотест|AT-W-/).catch(() => {});
    } finally {
      await ctx.close();
    }
  });

  // ════════════════════════════════════════════════════════════
  // 0. Навигация по всем 4 вкладкам раздела
  // ════════════════════════════════════════════════════════════
  test('0. Навигация по всем вкладкам раздела «Водопотребление → Тарифы»', async ({ page }) => {
    for (const tab of TABS) {
      await open(page, tab.path);
      log(`✓ Открыта вкладка «${tab.name}» (${tab.path})`);
    }
  });

  // ════════════════════════════════════════════════════════════
  // 1. Подраздел «Тарифы» (/snt/bookkeeping/tariffs/water/)
  // ════════════════════════════════════════════════════════════
  test('1.1 Вкладка «Тарифы»: отображение кнопок, карточек тарифов, таблицы периодов, переключение и фильтрация', async ({ page }) => {
    await openGrid(page, '/snt/bookkeeping/tariffs/water/');

    // Верхние вкладки раздела «Тарифы» и подвкладки «Водопотребления»
    await expect(page.locator('.tabs__link', { hasText: 'Взносы' })).toBeVisible();
    await expect(page.locator('.tabs__link', { hasText: 'Электроэнергия' })).toBeVisible();
    await expect(page.locator('.tabs__link', { hasText: 'Водопотребление' })).toBeVisible();
    await expect(page.locator('.tabs--sublist .tabs__link', { hasText: 'Тарифы' })).toBeVisible();
    await expect(page.locator('.tabs--sublist .tabs__link', { hasText: 'Счетчики' })).toBeVisible();

    // Кнопки управления тарифом и периодами
    await expect(page.locator('button.js-add-tariff', { hasText: '+ Добавить тариф' })).toBeVisible();
    await expect(page.locator('button.js-add-price', { hasText: '+ Добавить новый период' })).toBeVisible();
    await expect(page.locator('button.js-edit-tariff', { hasText: 'Редактировать тариф' })).toBeVisible();

    // Карточки тарифов и переключение между «Тестовый тариф» и «Автотест Проверка»
    const tariffTabs = page.locator('.card__tabs a.card__tab');
    await expect(tariffTabs.filter({ hasText: MAIN_TARIFF.name })).toBeVisible();
    await expect(tariffTabs.filter({ hasText: SECOND_TARIFF.name })).toBeVisible();

    await tariffTabs.filter({ hasText: SECOND_TARIFF.name }).click();
    await expect(page.locator('.card__tabs a.card__tab.active')).toHaveText(SECOND_TARIFF.name);
    await expect(gridRow(page, SECOND_TARIFF.dateBegin)).toBeVisible();

    await tariffTabs.filter({ hasText: MAIN_TARIFF.name }).click();
    await expect(page.locator('.card__tabs a.card__tab.active')).toHaveText(MAIN_TARIFF.name);

    // Проверка всех колонок таблицы периодов
    for (const col of TARIFF_PERIOD_COLUMNS) {
      const vals = await columnValues(page, col);
      expect(vals, `колонка «${col}» должна присутствовать в таблице периодов`).not.toBeNull();
    }
    expect(await gridRows(page).count()).toBeGreaterThan(0);

    // Поиск и фильтрация по таблице периодов тарифа
    try {
      await quickSearch(page, MAIN_TARIFF.samplePeriodBegin);
      await expect(gridRow(page, MAIN_TARIFF.samplePeriodBegin)).toBeVisible();
      await resetFilter(page);

      const popup = await openFilter(page);
      await popup.locator('input[name="PRICE_from"]').fill(MAIN_TARIFF.samplePriceFilter);
      await filterApply(page, popup);
      const priceVals = await columnValues(page, 'Стоимость тарифа, руб.');
      expect(priceVals.length).toBeGreaterThan(0);
      expect(priceVals.every((v) => v === MAIN_TARIFF.samplePriceDisplay)).toBe(true);
      log(`✓ Фильтр периодов по «Стоимость тарифа = ${MAIN_TARIFF.samplePriceDisplay}»: найдено строк ${priceVals.length}`);
    } finally {
      await resetFilter(page).catch(() => {});
    }
  });

  test('1.2 Вкладка «Тарифы»: редактирование тарифа «Автотест Проверка» (название, стоимость и тип потерь периода) с возвратом', async ({ page }) => {
    await openGrid(page, `/snt/bookkeeping/tariffs/water/?id=${SECOND_TARIFF.id}`);
    const tempName = `${SECOND_TARIFF.name} изм`;
    const tempPrice = '11.25';
    const tempLosses = '2.00';
    let nameRestored = true;
    let periodRestored = true;

    try {
      // 1) Редактируем название тарифа через кнопку «Редактировать тариф»
      await page.locator('button.js-edit-tariff', { hasText: 'Редактировать тариф' }).click();
      let form = await waitPopupForm(page, '#tariff-add-form');
      await expect(form.locator('#tariff-name')).toHaveValue(SECOND_TARIFF.name);
      await form.locator('#tariff-name').fill(tempName);
      nameRestored = false;
      await submitPopupForm(page, form, '/local/ajax/water/add-tariff.php');

      await expect(page.locator('.card__tabs a.card__tab.active')).toHaveText(tempName);
      log(`✓ Название тарифа изменено на «${tempName}»`);

      // Возвращаем исходное название
      await page.locator('button.js-edit-tariff', { hasText: 'Редактировать тариф' }).click();
      form = await waitPopupForm(page, '#tariff-add-form');
      await form.locator('#tariff-name').fill(SECOND_TARIFF.name);
      await submitPopupForm(page, form, '/local/ajax/water/add-tariff.php');

      await expect(page.locator('.card__tabs a.card__tab.active')).toHaveText(SECOND_TARIFF.name);
      nameRestored = true;
      log(`✓ Название тарифа возвращено: «${SECOND_TARIFF.name}»`);

      // 2) Редактируем период (id=309) через меню строки «☰ → Редактировать»:
      // меняем стоимость и переключаем потери с «%» (32) на «руб/м³» (33)
      await gridRowAction(page, SECOND_TARIFF.dateBegin, 'Редактировать');
      form = await waitPopupForm(page, '#price-edit-form');
      await form.locator('#PRICE').fill(tempPrice);
      await form.locator('#PERCENT').fill(tempLosses);
      await setCheckbox(form, '#LOSSES_TYPE_PERCENT-2', true); // руб/м³
      periodRestored = false;
      await submitPopupForm(page, form, '/local/ajax/water/edit-price.php');

      const updatedRow = gridRow(page, SECOND_TARIFF.dateBegin).first();
      await expect(updatedRow).toContainText(tempPrice);
      await expect(updatedRow).toContainText(`${tempLosses} руб/м³`);
      log(`✓ Период тарифа обновлён: стоимость ${tempPrice}, потери ${tempLosses} руб/м³`);

      // Возвращаем исходные значения периода (10.50 и 1.50 %)
      await gridRowAction(page, SECOND_TARIFF.dateBegin, 'Редактировать');
      form = await waitPopupForm(page, '#price-edit-form');
      await form.locator('#PRICE').fill(SECOND_TARIFF.originalPrice);
      await form.locator('#PERCENT').fill(SECOND_TARIFF.originalLosses);
      await setCheckbox(form, '#LOSSES_TYPE_PERCENT-1', true); // %
      await submitPopupForm(page, form, '/local/ajax/water/edit-price.php');

      const restoredRow = gridRow(page, SECOND_TARIFF.dateBegin).first();
      await expect(restoredRow).toContainText(SECOND_TARIFF.originalPrice);
      await expect(restoredRow).toContainText(SECOND_TARIFF.originalLossesDisplay);
      periodRestored = true;
      log(`✓ Исходные параметры периода возвращены: стоимость ${SECOND_TARIFF.originalPrice}, потери ${SECOND_TARIFF.originalLossesDisplay}`);
    } finally {
      if (!nameRestored) {
        await open(page, `/snt/bookkeeping/tariffs/water/?id=${SECOND_TARIFF.id}`);
        await page.locator('button.js-edit-tariff').click();
        const form = await waitPopupForm(page, '#tariff-add-form');
        await form.locator('#tariff-name').fill(SECOND_TARIFF.name);
        await submitPopupForm(page, form, '/local/ajax/water/add-tariff.php');
      }
      if (!periodRestored) {
        await open(page, `/snt/bookkeeping/tariffs/water/?id=${SECOND_TARIFF.id}`);
        await gridRowAction(page, SECOND_TARIFF.dateBegin, 'Редактировать');
        const form = await waitPopupForm(page, '#price-edit-form');
        await form.locator('#PRICE').fill(SECOND_TARIFF.originalPrice);
        await form.locator('#PERCENT').fill(SECOND_TARIFF.originalLosses);
        await setCheckbox(form, '#LOSSES_TYPE_PERCENT-1', true);
        await submitPopupForm(page, form, '/local/ajax/water/edit-price.php');
      }
    }
  });

  test('1.3 Вкладка «Тарифы»: валидация и переключение параметров в формах «+ Добавить тариф» и «+ Добавить новый период»', async ({ page }) => {
    await open(page, `/snt/bookkeeping/tariffs/water/?id=${SECOND_TARIFF.id}`);

    // 1) Форма «+ Добавить тариф»
    await page.locator('button.js-add-tariff', { hasText: '+ Добавить тариф' }).click();
    let form = await waitPopupForm(page, '#tariff-add-form');
    await expect(page.locator('#popup .popup__title')).toHaveText('Добавить тариф');

    // Проверка HTML5-валидации обязательных полей на пустой форме
    expect((await validity(form.locator('#tariff-name'))).valid).toBe(false);
    expect((await validity(form.locator('#PRICE'))).valid).toBe(false);
    expect((await validity(form.locator('#DATE_BEGIN'))).valid).toBe(false);
    expect((await validity(form.locator('#DATE_END'))).valid).toBe(false);

    // Поле «Потери» необязательное; проверяем переключение радиокнопок «%» / «руб/м³»
    expect((await validity(form.locator('#PERCENT'))).valid).toBe(true);
    await expect(form.locator('#LOSSES_TYPE_PERCENT-1')).toBeChecked();
    await setCheckbox(form, '#LOSSES_TYPE_PERCENT-2', true);
    await setCheckbox(form, '#LOSSES_TYPE_PERCENT-1', true);

    await closePopupModal(page);
    log('✓ Валидация и переключатели формы «+ Добавить тариф» проверены');

    // 2) Форма «+ Добавить новый период»
    await page.locator('button.js-add-price', { hasText: '+ Добавить новый период' }).click();
    form = await waitPopupForm(page, '#price-add-form');
    await expect(page.locator('#popup .popup__title')).toHaveText('Добавить стоимость');

    // Дата начала автоматически равна следующему дню после последнего периода (01.07.2026) и доступна только для чтения
    await expect(form.locator('#DATE_BEGIN')).toHaveValue(SECOND_TARIFF.nextPeriodBegin);
    expect(await form.locator('#DATE_BEGIN').getAttribute('readonly')).not.toBeNull();

    // Проверка обязательности полей стоимости и даты окончания
    expect((await validity(form.locator('#PRICE'))).valid).toBe(false);
    expect((await validity(form.locator('#DATE_END'))).valid).toBe(false);

    // Переключение радиокнопок «%» / «руб/м³»
    await setCheckbox(form, '#LOSSES_TYPE_PERCENT-2', true);
    await setCheckbox(form, '#LOSSES_TYPE_PERCENT-1', true);

    await closePopupModal(page);
    log('✓ Валидация, автоподстановка даты начала и переключатели формы «+ Добавить новый период» проверены');
  });

  // ════════════════════════════════════════════════════════════
  // 2. Подраздел «Счетчики» (/snt/bookkeeping/tariffs/water/counters/)
  // ════════════════════════════════════════════════════════════
  test('2.1 Вкладка «Счетчики»: отображение шагов импорта, кнопок, вкладок и всех колонок таблицы', async ({ page }) => {
    await openGrid(page, '/snt/bookkeeping/tariffs/water/counters/');

    // Шаги загрузки файла
    await expect(page.locator('.steps__item-title', { hasText: 'Загрузите файл' })).toBeVisible();
    await expect(page.locator('.steps__item-title', { hasText: 'Обработка файла' })).toBeVisible();
    await expect(page.locator('.steps__item-title', { hasText: 'Обработка данных' })).toBeVisible();

    // Ссылки скачивания шаблонов и кнопки
    await expect(page.locator('a[onclick*="getWImportFile"]')).toBeVisible();
    await expect(page.locator('a[onclick*="getWDataImportFile"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Загрузить данные' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Добавить счётчик' })).toBeVisible();

    // Подвкладки «Действующие счётчики» / «Архивные счётчики» и строка поиска
    await expect(page.locator('a.card__tab', { hasText: 'Действующие счётчики' })).toBeVisible();
    await expect(page.locator('a.card__tab', { hasText: 'Архивные счётчики' })).toBeVisible();
    await expect(page.locator('input[name="FIND"]')).toBeVisible();

    // Проверка наличия всех 10 колонок таблицы водных счётчиков
    for (const col of COUNTER_COLUMNS) {
      const vals = await columnValues(page, col);
      expect(vals, `колонка «${col}» должна присутствовать в таблице счётчиков воды`).not.toBeNull();
    }
    expect(await gridRows(page).count()).toBeGreaterThan(0);
    log(`✓ Проверены все ${COUNTER_COLUMNS.length} колонок таблицы водных счётчиков`);
  });

  test('2.2 Вкладка «Счетчики»: скачивание обоих файлов-шаблонов (.xlsx) для счётчиков и показаний', async ({ page }) => {
    await open(page, '/snt/bookkeeping/tariffs/water/counters/');

    // 1) Пример файла для массового добавления счётчиков
    const linkCounters = page.locator('a[onclick*="getWImportFile"]');
    const [dl1] = await Promise.all([
      page.waitForEvent('download', { timeout: 35_000 }),
      linkCounters.click(),
    ]);
    const file1 = path.join(os.tmpdir(), `water-counters-template-${Date.now()}.xlsx`);
    await dl1.saveAs(file1);
    expect(fs.statSync(file1).size).toBeGreaterThan(0);
    const rows1 = readXlsx(file1);
    expect(rows1[0]).toEqual(expect.arrayContaining([
      'Номер участка',
      'Улица',
      'Марка',
      'Серийный номер',
      'Номер пломбы',
      'Тариф',
      'Дата',
      'Показания',
      'Следующая дата поверки',
    ]));
    log(`✓ Скачан шаблон водных счётчиков «${dl1.suggestedFilename()}» (${rows1.length} строк)`);

    // 2) Пример файла для массового добавления показаний
    const linkReadings = page.locator('a[onclick*="getWDataImportFile"]');
    const [dl2] = await Promise.all([
      page.waitForEvent('download', { timeout: 35_000 }),
      linkReadings.click(),
    ]);
    const file2 = path.join(os.tmpdir(), `water-readings-template-${Date.now()}.xlsx`);
    await dl2.saveAs(file2);
    expect(fs.statSync(file2).size).toBeGreaterThan(0);
    const rows2 = readXlsx(file2);
    expect(rows2[0]).toEqual(expect.arrayContaining([
      'Номер участка',
      'Улица',
      'Тариф',
      'Дата',
      'Показания',
    ]));
    log(`✓ Скачан шаблон показаний воды «${dl2.suggestedFilename()}» (${rows2.length} строк)`);
  });

  test('2.3 Вкладка «Счетчики»: быстрый поиск и фильтрация по участку, марке счётчика и названию тарифа', async ({ page }) => {
    await openGrid(page, '/snt/bookkeeping/tariffs/water/counters/');

    try {
      // 1) Быстрый поиск в строке «Поиск и фильтрация»
      await quickSearch(page, COUNTER_UNIT_3.serial);
      await expect(gridRow(page, COUNTER_UNIT_3.serial)).toBeVisible();
      await resetFilter(page);

      // 2) Фильтр по полю «Участок» (input[name="SECTOR_NUMBER"])
      let popup = await openFilter(page);
      await popup.locator('input[name="SECTOR_NUMBER"]').fill(COUNTER_UNIT_3.unitNumber);
      await filterApply(page, popup);
      const unitVals = await columnValues(page, 'Участок');
      expect(unitVals.length).toBeGreaterThan(0);
      expect(unitVals.every((v) => v === COUNTER_UNIT_3.unitNumber)).toBe(true);
      log(`✓ Фильтр по полю «Участок = ${COUNTER_UNIT_3.unitNumber}»: найдено строк ${unitVals.length}`);
      await resetFilter(page);

      // 3) Фильтр по полю «Марка счётчика» (input[name="MODEL"])
      popup = await openFilter(page);
      await popup.locator('input[name="MODEL"]').fill(COUNTER_UNIT_3.brand);
      await filterApply(page, popup);
      const brandVals = await columnValues(page, 'Марка счётчика');
      expect(brandVals.length).toBeGreaterThan(0);
      expect(brandVals.every((v) => v === COUNTER_UNIT_3.brand)).toBe(true);
      log(`✓ Фильтр по полю «Марка счётчика = ${COUNTER_UNIT_3.brand}»: найдено строк ${brandVals.length}`);
      await resetFilter(page);

      // 4) Фильтр по полю «Название тарифа» (multi-select TARIFF_TITLE)
      popup = await openFilter(page);
      await filterMultiSelect(page, 'Название тарифа', COUNTER_UNIT_3.tariffName);
      await filterApply(page, popup);
      const tariffVals = await columnValues(page, 'Название тарифа');
      expect(tariffVals.length).toBeGreaterThan(0);
      expect(tariffVals.every((v) => v === COUNTER_UNIT_3.tariffName)).toBe(true);
      log(`✓ Фильтр по полю «Название тарифа = ${COUNTER_UNIT_3.tariffName}»: найдено строк ${tariffVals.length}`);
    } finally {
      await resetFilter(page).catch(() => {});
    }
  });

  test('2.4 Вкладка «Счетчики»: валидация «Загрузить данные» без файла и импорт счётчика через .xlsx с очисткой', async ({ page }) => {
    const s = stamp();
    const impSerial = `AT-W-IMP-${s}`;
    const impPlomb = `PL-W-IMP-${s}`;
    const impBrand = `${TEST_PREFIX}ВодаИмпорт`;
    let impDeleted = false;
    needsEmergencyCleanup = true;

    await openGrid(page, '/snt/bookkeeping/tariffs/water/counters/');
    // Если от прерванного прогона остался тестовый счётчик — сразу удаляем его
    const leftoverIds = await gridRow(page, 'AT-W-').evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-id')).filter(Boolean));
    for (const id of leftoverIds) await deleteWaterCounterById(page, id);

    try {
      // 1) Валидация кнопки «Загрузить данные» без выбранного файла
      await page.getByRole('button', { name: 'Загрузить данные' }).click();
      const msgBox = page.locator('.popup-window:visible', { hasText: 'Сначала выберите и добавьте файл в поле выше' });
      await expect(msgBox).toBeVisible();
      await confirmYes(page);
      await expect(msgBox).toBeHidden();
      log('✓ Валидация «Загрузить данные» без файла проверена');

      // 2) Формируем .xlsx для свободного участка №14 и проходим шаги 1 → 2 → 3
      const xlsxFile = path.join(os.tmpdir(), `import-water-counter-${Date.now()}.xlsx`);
      writeXlsx(xlsxFile, [
        [
          'Номер участка',
          'Улица',
          'Марка',
          'Серийный номер',
          'Номер пломбы',
          'Тариф',
          'Дата',
          'Показания',
          'Следующая дата поверки',
        ],
        [
          FREE_UNIT.number,
          FREE_UNIT.street,
          impBrand,
          impSerial,
          impPlomb,
          MAIN_TARIFF.name,
          '01.10.2025',
          '1',
          '01.10.2027',
        ],
      ]);

      await page.locator('#bx_file_countercsv_input').setInputFiles(xlsxFile);
      await page.locator('input[name="counterCsv[tmp_name]"]').waitFor({ state: 'attached', timeout: 20_000 });
      await page.getByRole('button', { name: 'Загрузить данные' }).click();

      // Шаг 2: Обработка файла и сопоставление колонок
      await expect(page.locator('#step-2')).toBeVisible({ timeout: 20_000 });
      expect(await page.locator('#setParams select').count()).toBeGreaterThanOrEqual(8);
      await page.locator('button.js-step-import', { hasText: 'Продолжить' }).click();

      // Шаг 3: Обработка данных
      await expect(page.locator('#step-3')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.success-alert-upload:not(.hidden)')).toBeVisible({ timeout: 25_000 });
      expect((await page.locator('#output_text').innerText()).trim()).toBe('');

      // Проверяем появление импортированного счётчика в таблице и удаляем его
      await openGrid(page, '/snt/bookkeeping/tariffs/water/counters/?mode=active');
      const row = gridRow(page, impSerial).first();
      await expect(row, `импортированный водный счётчик «${impSerial}» появился в списке`).toBeVisible();
      await expect(row).toContainText(impBrand);
      await expect(row).toContainText(impPlomb);
      const impId = await row.getAttribute('data-id');
      if (impId) {
        await deleteWaterCounterById(page, impId);
        impDeleted = true;
        needsEmergencyCleanup = false;
      }
      log(`✓ Импорт водного счётчика «${impSerial}» через .xlsx выполнен успешно и очищен (id=${impId})`);
    } finally {
      if (!impDeleted) {
        await cleanupWaterCounterByText(page, impSerial);
        needsEmergencyCleanup = false;
      }
    }
  });

  // ════════════════════════════════════════════════════════════
  // 3. Подраздел «Действующие счётчики» (/snt/bookkeeping/tariffs/water/counters/?mode=active)
  // ════════════════════════════════════════════════════════════
  test('3.1 Вкладка «Действующие счётчики»: редактирование счётчика участка №3 (Огородова М.В.) и возврат исходных данных', async ({ page }) => {
    await openGrid(page, '/snt/bookkeeping/tariffs/water/counters/?mode=active');

    const tempBrand = `${COUNTER_UNIT_3.brand} Тест`;
    const tempSerial = `${COUNTER_UNIT_3.serial}-T`;
    const tempPlomb = `${COUNTER_UNIT_3.plomb}-T`;
    let restored = true;

    try {
      await gridRowAction(page, COUNTER_UNIT_3.serial, 'Редактировать');
      let form = await waitPopupForm(page, '#counter-add-form');

      await expect(form.locator('input[name="MODEL"]')).toHaveValue(COUNTER_UNIT_3.brand);
      await expect(form.locator('input[name="SERIAL_NUMBER"]')).toHaveValue(COUNTER_UNIT_3.serial);
      await expect(form.locator('input[name="NUMBER"]')).toHaveValue(COUNTER_UNIT_3.plomb);

      await form.locator('input[name="MODEL"]').fill(tempBrand);
      await form.locator('input[name="SERIAL_NUMBER"]').fill(tempSerial);
      await form.locator('input[name="NUMBER"]').fill(tempPlomb);
      restored = false;
      await submitPopupForm(page, form, '/local/ajax/water/counters/add-counter.php');

      const updatedRow = gridRow(page, tempSerial).first();
      await expect(updatedRow).toBeVisible();
      await expect(updatedRow).toContainText(tempBrand);
      await expect(updatedRow).toContainText(tempPlomb);
      log(`✓ Счётчик участка №3 отредактирован (${tempBrand}, ${tempSerial}, ${tempPlomb})`);

      // Возвращаем исходные данные
      await gridRowAction(page, tempSerial, 'Редактировать');
      form = await waitPopupForm(page, '#counter-add-form');
      await form.locator('input[name="MODEL"]').fill(COUNTER_UNIT_3.brand);
      await form.locator('input[name="SERIAL_NUMBER"]').fill(COUNTER_UNIT_3.serial);
      await form.locator('input[name="NUMBER"]').fill(COUNTER_UNIT_3.plomb);
      await submitPopupForm(page, form, '/local/ajax/water/counters/add-counter.php');

      const restoredRow = gridRow(page, COUNTER_UNIT_3.serial).first();
      await expect(restoredRow).toBeVisible();
      await expect(restoredRow).toContainText(COUNTER_UNIT_3.brand);
      await expect(restoredRow).toContainText(COUNTER_UNIT_3.plomb);
      restored = true;
      log(`✓ Исходные данные счётчика участка №3 восстановлены (${COUNTER_UNIT_3.brand}, ${COUNTER_UNIT_3.serial}, ${COUNTER_UNIT_3.plomb})`);
    } finally {
      if (!restored) {
        await page.evaluate(async (c) => {
          const sessid = document.querySelector('#sessid')?.value || window.BX?.bitrix_sessid?.() || '';
          await fetch(`/local/ajax/water/counters/add-counter.php?sessid=${sessid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              ID: c.id,
              SECTOR_ID: c.sectorId,
              MODEL: c.brand,
              SERIAL_NUMBER: c.serial,
              NUMBER: c.plomb,
              TARIFF_ID: c.tariffId,
            }).toString(),
          });
        }, COUNTER_UNIT_3);
      }
    }
  });

  test('3.2 Вкладка «Действующие счётчики»: валидация пустой формы «Добавить счётчик» и переключение параметров', async ({ page }) => {
    await openGrid(page, '/snt/bookkeeping/tariffs/water/counters/?mode=active');
    await page.getByRole('button', { name: 'Добавить счётчик' }).click();
    const form = await waitPopupForm(page, '#counter-add-form');
    await expect(page.locator('#popup .popup__title')).toHaveText('Добавить счётчик');

    // Проверка обязательности полей
    expect((await validity(form.locator('input[name="MODEL"]'))).valid).toBe(false);
    expect((await validity(form.locator('#DATE'))).valid).toBe(false);
    expect((await validity(form.locator('input[name="DATA"]'))).valid).toBe(false);

    // Необязательные поля
    expect((await validity(form.locator('input[name="SERIAL_NUMBER"]'))).valid).toBe(true);
    expect((await validity(form.locator('input[name="NUMBER"]'))).valid).toBe(true);

    // Чек-бокс «Добавить в Календарь событий» по умолчанию включён
    await expect(form.locator('#ADD_TO_CALENDAR_WATER')).toBeChecked();
    await setCheckbox(form, '#ADD_TO_CALENDAR_WATER', false);
    await setCheckbox(form, '#ADD_TO_CALENDAR_WATER', true);

    // Переключение тарифа в селекте «Тариф»
    await form.locator('select[name="TARIFF_ID"]').selectOption(SECOND_TARIFF.id);
    await expect(form.locator('select[name="TARIFF_ID"]')).toHaveValue(SECOND_TARIFF.id);
    await form.locator('select[name="TARIFF_ID"]').selectOption(MAIN_TARIFF.id);

    await closePopupModal(page);
    log('✓ Валидация пустой формы «Добавить счётчик» и переключение чек-бокса/тарифа проверены');
  });

  // ════════════════════════════════════════════════════════════
  // 4. Действия с действующими и архивными счётчиками
  // ════════════════════════════════════════════════════════════
  test('4.1 Полный цикл счётчика: создание без показаний → Календарь событий → Убрать в архив → Активировать → Удаление', async ({ page }) => {
    const s = stamp();
    const brand = `${TEST_PREFIX}Вода`;
    const serial = `AT-W-CNT-${s}`;
    const plomb = `AT-W-PL-${s}`;
    const verifyDate = '01.10.2027';
    let mainDeleted = false;
    needsEmergencyCleanup = true;

    try {
      // ─────────────────────────────────────────────────────────
      // 1) Создание тестового счётчика без показаний (DATA = 0) и с датой поверки
      // ─────────────────────────────────────────────────────────
      await openGrid(page, '/snt/bookkeeping/tariffs/water/counters/?mode=active');
      await page.getByRole('button', { name: 'Добавить счётчик' }).click();
      const form = await waitPopupForm(page, '#counter-add-form');

      await form.locator('select[name="SECTOR_ID"]').evaluate((el, val) => {
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, FREE_UNIT.sectorId);
      await form.locator('input[name="MODEL"]').fill(brand);
      await form.locator('input[name="SERIAL_NUMBER"]').fill(serial);
      await form.locator('input[name="NUMBER"]').fill(plomb);
      await form.locator('select[name="TARIFF_ID"]').selectOption(MAIN_TARIFF.id);
      await setDateInput(form, '#DATE', '01.10.2026');
      await setDateInput(form, '#NEXT_VERIFICATION_DATE', verifyDate);
      // Снимаем галочку «Добавить в Календарь событий», чтобы протестировать добавление в календарь отдельно
      await setCheckbox(form, '#ADD_TO_CALENDAR_WATER', false);
      await form.locator('input[name="DATA"]').fill('0');
      await submitPopupForm(page, form, '/local/ajax/water/counters/add-counter.php');

      const row = gridRow(page, serial).first();
      await expect(row, `созданный счётчик «${serial}» отображается в действующих`).toBeVisible();
      await expect(row).toContainText(verifyDate);
      await expect(row).toContainText('Не в календаре');
      log(`✓ Создан тестовый водный счётчик «${serial}» без показаний со статусом «Не в календаре»`);

      // ─────────────────────────────────────────────────────────
      // 2) Календарь событий через меню строки «☰» (Добавить → Удалить)
      // ─────────────────────────────────────────────────────────
      await performCalendarAction(page, () => gridRowAction(page, serial, 'Добавить в Календарь событий'));
      await expect(gridRow(page, serial).first()).toContainText('В календаре', { timeout: 15_000 });
      log('✓ Через меню строки «☰» счётчик добавлен в Календарь событий («В календаре»)');

      page.once('dialog', (d) => d.accept());
      await performCalendarAction(page, () => gridRowAction(page, serial, 'Удалить из Календаря событий'));
      await expect(gridRow(page, serial).first()).toContainText('Не в календаре', { timeout: 15_000 });
      log('✓ Через меню строки «☰» счётчик удалён из Календаря событий («Не в календаре»)');

      // ─────────────────────────────────────────────────────────
      // 3) Календарь событий через групповые действия (Добавить → Удалить)
      // ─────────────────────────────────────────────────────────
      await selectGridRow(page, serial);
      await performCalendarAction(page, () => applyCounterGroupAction(page, 'Добавить в Календарь событий'));
      await expect(gridRow(page, serial).first()).toContainText('В календаре', { timeout: 15_000 });
      log('✓ Групповым действием счётчик добавлен в Календарь событий («В календаре»)');

      await selectGridRow(page, serial);
      page.once('dialog', (d) => d.accept());
      await performCalendarAction(page, () => applyCounterGroupAction(page, 'Удалить из Календаря событий'));
      await expect(gridRow(page, serial).first()).toContainText('Не в календаре', { timeout: 15_000 });
      log('✓ Групповым действием счётчик удалён из Календаря событий («Не в календаре»)');

      // ─────────────────────────────────────────────────────────
      // 4) Перевод в архив («Убрать в архив») → проверка в «Архивных счётчиках»
      // ─────────────────────────────────────────────────────────
      await gridRowAction(page, serial, 'Убрать в архив');
      await confirmWaterArchivePopup(page, 'Убрать');
      await expect(gridRow(page, serial)).toHaveCount(0, { timeout: 15_000 });
      log(`✓ Счётчик «${serial}» переведён в архив и исчез из «Действующих счётчиков»`);

      // ─────────────────────────────────────────────────────────
      // 5) Возврат из архива («Активировать») → проверка в «Действующих счётчиках»
      // ─────────────────────────────────────────────────────────
      await openGrid(page, '/snt/bookkeeping/tariffs/water/counters/?mode=archive');
      await expect(gridRow(page, serial).first()).toBeVisible({ timeout: 15_000 });
      await gridRowAction(page, serial, 'Активировать');
      await confirmWaterArchivePopup(page, 'Вернуть');
      await expect(gridRow(page, serial)).toHaveCount(0, { timeout: 15_000 });

      await openGrid(page, '/snt/bookkeeping/tariffs/water/counters/?mode=active');
      await expect(gridRow(page, serial).first()).toBeVisible({ timeout: 15_000 });
      log(`✓ Счётчик «${serial}» активирован обратно и отображается в «Действующих счётчиках»`);

      // ─────────────────────────────────────────────────────────
      // 6) Повторный перевод «Убрать в архив» и удаление через «Удалить счётчики без показаний»
      // ─────────────────────────────────────────────────────────
      await gridRowAction(page, serial, 'Убрать в архив');
      await confirmWaterArchivePopup(page, 'Убрать');
      await expect(gridRow(page, serial)).toHaveCount(0, { timeout: 15_000 });

      await openGrid(page, '/snt/bookkeeping/tariffs/water/counters/?mode=archive');
      await expect(gridRow(page, serial).first()).toBeVisible({ timeout: 15_000 });

      const delEmptyBtn = page.getByRole('button', { name: 'Удалить счётчики без показаний' });
      await expect(delEmptyBtn).toBeVisible();
      await delEmptyBtn.click();
      const delDialog = page.locator('.popup-window:visible', { hasText: 'Удаление счётчиков' });
      await expect(delDialog).toBeVisible();

      // Подтверждаем удаление счётчиков без показаний и ждём завершения фоновой задачи + перезагрузки
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {}),
        confirmYes(page),
      ]);
      await page.waitForTimeout(500);

      await openGrid(page, '/snt/bookkeeping/tariffs/water/counters/?mode=archive');
      await expect(gridRow(page, serial)).toHaveCount(0, { timeout: 15_000 });
      mainDeleted = true;
      needsEmergencyCleanup = false;
      log(`✓ Тестовый счётчик «${serial}» удалён кнопкой «Удалить счётчики без показаний»`);
    } finally {
      if (!mainDeleted) {
        await cleanupWaterCounterByText(page, serial);
      }
      needsEmergencyCleanup = false;
    }
  });
});
