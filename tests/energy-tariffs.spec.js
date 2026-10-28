// ============================================================
// Смоук-тест: раздел «Электроэнергия → Тарифы» на lk.sntclub.ru (ЛК Председателя)
// Тестовый фреймворк: Playwright Test (@playwright/test)
//
// Архитектура (как в people.spec.js и units.spec.js):
// Тест разбит на независимые этапы по подразделам в строгом порядке:
//  0. Навигация по всем 4 вкладкам раздела «Электроэнергия → Тарифы»
//  1. Подраздел «Тарифы» (/snt/bookkeeping/tariffs/):
//     1.1 Отображение кнопок, списка тарифов, периодов и переключение карточек тарифов
//     1.2 Редактирование существующего тарифа «!!!ОДНОСТАВОЧНЫЙ» (название + ставка периода) → вернуть как было
//     1.3 Валидация пустой формы «+ Добавить тариф» и переключение параметров (тип, соц. тариф, потери, диапазоны)
//     1.4 Создание, проверка и удаление 3 тестовых тарифов:
//         - Тариф 1: Однотарифный + без потерь + без диапазонов (+ добавление периода, редактирование периода и названия) → удаление
//         - Тариф 2: Двухтарифный + потери в рублях + 1 диапазон (100 кВт) → проверка → удаление
//         - Тариф 3: Трёхтарифный + потери в процентах + 2 диапазона (100 кВт и 200 кВт) → проверка → удаление
//  2. Подраздел «Счетчики» (/snt/bookkeeping/tariffs/counters/):
//     2.1 Отображение шагов импорта, кнопок, переключателей и всех колонок таблицы
//     2.2 Скачивание обоих шаблонов (.xlsx): для массового добавления счётчиков и показаний
//     2.3 Быстрый поиск и фильтрация по 3 полям: Участок, Название тарифа, Тип счетчика → Найти → Сбросить
//     2.4 Импорт («Загрузить данные»): валидация без файла + загрузка .xlsx со счётчиком (шаги 1→2→3) → проверка → удаление
//  3. Подраздел «Действующие счётчики» (/snt/bookkeeping/tariffs/counters/?mode=active):
//     3.1 Редактирование существующего счётчика участка №6 (Соснов Е.П., id=39715) → проверить → вернуть как было
//     3.2 Валидация пустой формы «Добавить счётчик» и переключение типа тарифа в форме
//  4. Действия с действующими и архивными счётчиками (?mode=active и ?mode=archive):
//     4.1 Полный цикл тестового счётчика (без показаний, с датой поверки):
//         создание → «Добавить в Календарь событий» и «Удалить из Календаря событий» (из меню «☰» и групповым действием) →
//         «Копировать» (создание копии и её удаление) → перевод «В архив» → проверка во вкладке «Архивные счётчики» →
//         возврат «Из архива» → проверка в «Действующих» → перевод «В архив» →
//         проверка кнопки «Удалить счётчики без показаний» и удаление тестового счётчика
//
// Авторизация выполняется ОДИН раз на воркер (storageState).
// Все изменения откатываются в блоках finally / afterAll.
//
// Запуск:
//   ./run-energy-tariffs.sh
//   npx playwright test energy-tariffs.spec.js --workers=1 --headed
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

const BASE_URL = 'https://lk.sntclub.ru';

/** Роль, которую выбираем после авторизации */
const ROLE = 'Председатель';

/** Вкладки / подразделы раздела «Электроэнергия → Тарифы» */
const TABS = [
  { name: 'Тарифы', path: '/snt/bookkeeping/tariffs/' },
  { name: 'Счетчики', path: '/snt/bookkeeping/tariffs/counters/' },
  { name: 'Действующие счётчики', path: '/snt/bookkeeping/tariffs/counters/?mode=active' },
  { name: 'Архивные счётчики', path: '/snt/bookkeeping/tariffs/counters/?mode=archive' },
];

/** Колонки таблицы счётчиков */
const COUNTER_COLUMNS = [
  'Участок',
  'Улица',
  'Собственники',
  'Марка счётчика',
  'Серийный номер',
  'Номер пломбы',
  'Название тарифа',
  'Тип счетчика',
  'Т1',
  'Т2',
  'Т3',
  'Следующая дата поверки',
  'В календаре',
];

/** Существующий тариф, который редактируем и возвращаем как было */
const EXISTING_TARIFF = {
  id: '3203',
  name: '!!!ОДНОСТАВОЧНЫЙ',
  periodId: '8929',
  originalRateT1: '5.35',
};

/** Существующий действующий счётчик участка №6 (Соснов Егор Петрович), который редактируем и возвращаем */
const COUNTER_UNIT_6 = {
  id: '39715',
  unitNumber: '6',
  street: 'Каштановый бульвар',
  ownerFio: 'Соснов Егор Петрович',
  brand: 'Электрон',
  serial: 'Seria-210006',
  plomb: 'Plomb-46006',
  tariffId: '1869',
  tariffName: 'Эконом день-ночь',
  tariffType: 'Двухтарифный',
};

/** Участок без активного счётчика для тестирования импорта и создания */
const FREE_UNIT = {
  sectorId: '280703',
  number: '14',
  street: 'Васельковая',
};

/** Префикс тестовых сущностей — по нему делается очистка */
const TEST_PREFIX = 'Автотест';

/** Флаг: остались ли неудалённые тестовые данные (чтобы afterAll не запускался вхолостую) */
let needsEmergencyCleanup = false;

/** Файл с cookies авторизованной сессии (общий для всех тестов воркера) */
const AUTH_FILE = path.join(os.tmpdir(), 'sntclub-energy-tariffs-auth.json');

/** Сколько минут переиспользовать сохранённую сессию между запусками */
const AUTH_MAX_AGE_MIN = 20;

const test = base.extend({
  storageState: ({ workerStorageState }, use) => use(workerStorageState),
  workerStorageState: [async ({ browser }, use) => {
    const fresh = fs.existsSync(AUTH_FILE)
      && (Date.now() - fs.statSync(AUTH_FILE).mtimeMs) < AUTH_MAX_AGE_MIN * 60_000;
    if (!fresh) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await login(page);
      await ctx.storageState({ path: AUTH_FILE });
      await ctx.close();
    }
    await use(AUTH_FILE);
  }, { scope: 'worker' }],
});

test.use({ actionTimeout: 15_000, navigationTimeout: 25_000 });

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

/**
 * Подтвердить действие со счётчиком («В архив», «Из архива», «Удалить») и дождаться
 * завершения AJAX-запроса electricity:counters.list и последующего window.location.reload()
 */
async function confirmCounterAction(page) {
  await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && /electricity|counters\.list/i.test(r.url()),
      { timeout: 20_000 }
    ),
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {}),
    confirmYes(page),
  ]);
  await expect(page.locator('#pageMain')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(250);
}

/** Выполнить действие с Календарём событий и дождаться POST-запроса */
async function performCalendarAction(page, action) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 20_000 }),
    action(),
  ]);
  await waitGrid(page);
}

/** Отправить форму в боковой панели (iframe) и дождаться завершения POST-запроса */
async function submitSliderForm(page, buttonLocator) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 20_000 }),
    buttonLocator.click(),
  ]);
  await page.waitForTimeout(300);
  await closeSlider(page).catch(() => {});
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

/** Выбрать значение в выпадающем списке фильтра Bitrix по подписи поля */
async function filterSelect(page, label, value) {
  const re = new RegExp(`^\\s*${label.replace(/[?()]/g, '\\$&').replace(/\s+/g, '\\s+')}\\s*$`);
  const field = page.locator('.main-ui-control-field:visible, .main-ui-control-field-group:visible')
    .filter({ has: page.locator('.main-ui-control-field-label', { hasText: re }) }).first();
  await field.locator('div.main-ui-select').first().click();
  await page.locator('.main-ui-select-inner-item:visible').filter({ hasText: new RegExp(`^\\s*${value}\\s*$`) }).first().click();
  await expect(field.locator('.main-ui-select-name').first()).toHaveText(value);
}

async function filterApply(page, popup) {
  await gridReload(page, () => popup.getByText('Найти', { exact: true }).click());
}

/** Iframe боковой панели (SIDE_SLIDER) по части URL */
async function sliderFrame(page, urlPart) {
  const frameEl = page.locator(`iframe[src*="${urlPart}"]`).last();
  await expect(frameEl).toBeVisible({ timeout: 15_000 });
  const frame = await (await frameEl.elementHandle()).contentFrame();
  await expect.poll(() => frame.url(), { timeout: 15_000 }).toContain(urlPart);
  await frame.waitForLoadState('domcontentloaded');
  await frame.locator('form, body').first().waitFor();
  await page.waitForTimeout(200);
  return frame;
}

/** Закрыть боковую панель */
async function closeSlider(page) {
  const close = page.locator('.side-panel-label-icon-close:visible, .side-panel-close:visible').first();
  if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) await close.click();
  else await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
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

/** Установить дату в поле flatpickr */
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

/** Снять выделение со строки грида */
async function unselectGridRow(page, rowText) {
  const row = gridRow(page, rowText).first();
  if ((await row.count()) > 0 && (await row.locator('input[name="ID[]"]').isChecked())) {
    await row.locator('td.main-grid-cell-checkbox').click({ force: true });
  }
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

/**
 * Создать тариф через «+ Добавить тариф» на /snt/bookkeeping/tariffs/.
 * @param {object} opts
 * @param {string} opts.name - Название тарифа
 * @param {'1'|'2'|'3'} opts.type - 1: Однотарифный, 2: Двухтарифный, 3: Трехтарифный
 * @param {boolean} [opts.losses=false] - Учитывать потери
 * @param {'RUB'|'PERCENT'} [opts.lossesType='RUB'] - Тип потерь
 * @param {string} [opts.dateBegin='01.01.2026']
 * @param {string} [opts.dateEnd='30.06.2026']
 * @param {Array<{range?: string, prices: string[], lossesRub?: string[], lossesPercent?: string}>} opts.blocks
 */
async function createTariff(page, opts) {
  await open(page, '/snt/bookkeeping/tariffs/');
  await page.getByRole('button', { name: '+ Добавить тариф' }).click();
  const f = await sliderFrame(page, '/snt/bookkeeping/tariffs/add/');

  await f.locator('#NAME').fill(opts.name);
  await f.locator('#TYPE').selectOption(String(opts.type));
  await expect(f.locator('#block-index-0')).toBeVisible({ timeout: 10_000 });

  await setDateInput(f, '#DATE_BEGIN', opts.dateBegin || '01.01.2026');
  await setDateInput(f, '#DATE_END', opts.dateEnd || '30.06.2026');

  // Сначала добавляем нужные дополнительные диапазоны (блоки 1, 2...),
  // а затем включаем чек-бокс «Учитывать потери», чтобы поля потерь раскрылись во всех блоках
  for (let bIdx = 1; bIdx < opts.blocks.length; bIdx++) {
    await f.locator('button.button-add-field', { hasText: 'Добавить диапазон' }).last().click();
    await expect(f.locator(`#block-index-${bIdx}`)).toBeVisible({ timeout: 10_000 });
  }

  if (opts.losses) {
    await setCheckbox(f, '#LOSSES', true);
    await expect(f.locator('#is_losses')).toBeVisible();
    const radioId = opts.lossesType === 'PERCENT' ? '#PERCENT' : '#RUB';
    await setCheckbox(f, radioId, true);
  }

  for (let bIdx = 0; bIdx < opts.blocks.length; bIdx++) {
    const blk = opts.blocks[bIdx];
    const blkLoc = f.locator(`#block-index-${bIdx}`);
    if (bIdx > 0 && blk.range !== undefined) {
      await blkLoc.locator(`input[name="PRICE_BLOCK[${bIdx}][RANGE]"]`).fill(String(blk.range));
    }
    const priceInputs = blkLoc.locator(`input[name="PRICE_BLOCK[${bIdx}][PRICE][]"]`);
    for (let i = 0; i < blk.prices.length; i++) {
      await priceInputs.nth(i).fill(String(blk.prices[i]));
    }
    if (opts.losses && opts.lossesType === 'RUB' && blk.lossesRub) {
      const rubInputs = blkLoc.locator(`input[name="PRICE_BLOCK[${bIdx}][LOSSES_RUB][]"]`);
      for (let i = 0; i < blk.lossesRub.length; i++) {
        await rubInputs.nth(i).fill(String(blk.lossesRub[i]));
      }
    }
    if (opts.losses && opts.lossesType === 'PERCENT' && blk.lossesPercent !== undefined) {
      await blkLoc.locator(`input[name="PRICE_BLOCK[${bIdx}][LOSSES_PERCENT]"]`).fill(String(blk.lossesPercent));
    }
  }

  await submitSliderForm(page, f.locator('button[name="send"]', { hasText: 'Добавить' }));

  await open(page, '/snt/bookkeeping/tariffs/');
  const tabLink = page.locator('.card__tabs a.card__tab', { hasText: opts.name }).first();
  await expect(tabLink, `тариф «${opts.name}» появился в списке тарифов`).toBeVisible({ timeout: 15_000 });
  const href = await tabLink.getAttribute('href');
  const idMatch = href && href.match(/id=(\d+)/);
  const id = idMatch ? idMatch[1] : null;
  log(`Создан тестовый тариф «${opts.name}» (id=${id})`);
  return { id, name: opts.name, href };
}

/** Удалить тариф по названию через кнопку «Удалить тариф» */
async function deleteTariffByName(page, name) {
  const activeTab = page.locator('.card__tabs a.card__tab.active');
  const activeName = (await activeTab.innerText().catch(() => '')).trim();
  if (activeName !== name) {
    await open(page, '/snt/bookkeeping/tariffs/');
    const tabLink = page.locator('.card__tabs a.card__tab', { hasText: name }).first();
    if ((await tabLink.count()) === 0) return;
    await tabLink.click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
  const delBtn = page.getByRole('button', { name: 'Удалить тариф' });
  if (await delBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await delBtn.click();
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {}),
      confirmYes(page),
    ]);
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.card__tabs a.card__tab', { hasText: name })).toHaveCount(0, { timeout: 15_000 });
  log(`Удалён тестовый тариф «${name}»`);
}

/** Удалить счётчик по его ID через AJAX-действия компонента (сначала в архив, затем удаление) */
async function deleteCounterById(page, counterId) {
  await page.evaluate(async (id) => {
    try {
      await BX.ajax.runComponentAction('electricity:counters.list', 'status', {
        mode: 'class',
        data: { itemId: id, active: 0 },
      });
    } catch { /* уже в архиве */ }
    try {
      await BX.ajax.runComponentAction('electricity:counters.list', 'deleteCounter', {
        mode: 'class',
        data: { counterId: id },
      });
    } catch { /* игнорируем */ }
  }, counterId);
}

/** Аварийная очистка тестового счётчика по серийному номеру (или марке) */
async function cleanupCounterByText(page, text) {
  for (const url of [
    '/snt/bookkeeping/tariffs/counters/?mode=active',
    '/snt/bookkeeping/tariffs/counters/?mode=archive',
  ]) {
    await openGrid(page, url);
    const ids = await gridRow(page, text).evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-id')).filter(Boolean));
    for (const id of ids) {
      log(`Очистка тестового счётчика id=${id} («${text}»)`);
      await deleteCounterById(page, id);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// ТЕСТЫ
// ─────────────────────────────────────────────────────────────

test.describe('Раздел «Электроэнергия → Тарифы» (ЛК Председателя)', () => {
  test.setTimeout(300_000);

  test.afterAll(async ({ browser }) => {
    if (!needsEmergencyCleanup) return;
    // Гарантированная очистка тестовых тарифов и счётчиков, если какой-либо тест был прерван
    const ctx = await browser.newContext({ storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined });
    const page = await ctx.newPage();
    try {
      await open(page, '/snt/bookkeeping/tariffs/');
      const testTabs = page.locator('.card__tabs a.card__tab').filter({ hasText: TEST_PREFIX });
      const tCount = await testTabs.count();
      for (let i = 0; i < tCount; i++) {
        const name = (await testTabs.first().innerText()).trim();
        await deleteTariffByName(page, name).catch(() => {});
      }
      await cleanupCounterByText(page, /Автотест|AT-/).catch(() => {});
    } finally {
      await ctx.close();
    }
  });

  // ════════════════════════════════════════════════════════════
  // 0. Навигация по всем 4 вкладкам раздела
  // ════════════════════════════════════════════════════════════
  test('0. Навигация по всем вкладкам раздела «Электроэнергия → Тарифы»', async ({ page }) => {
    for (const tab of TABS) {
      await open(page, tab.path);
      log(`✓ Открыта вкладка «${tab.name}» (${tab.path})`);
    }
  });

  // ════════════════════════════════════════════════════════════
  // 1. Подраздел «Тарифы» (/snt/bookkeeping/tariffs/)
  // ════════════════════════════════════════════════════════════
  test('1.1 Вкладка «Тарифы»: отображение кнопок, списка тарифов, периодов и переключение карточек', async ({ page }) => {
    await open(page, '/snt/bookkeeping/tariffs/');

    // Верхние вкладки раздела «Тарифы» и подвкладки «Электроэнергии»
    await expect(page.locator('.tabs__link', { hasText: 'Взносы' })).toBeVisible();
    await expect(page.locator('.tabs__link', { hasText: 'Электроэнергия' })).toBeVisible();
    await expect(page.locator('.tabs__link', { hasText: 'Водопотребление' })).toBeVisible();
    await expect(page.locator('.tabs--sublist .tabs__link', { hasText: 'Тарифы' })).toBeVisible();
    await expect(page.locator('.tabs--sublist .tabs__link', { hasText: 'Счетчики' })).toBeVisible();

    // Кнопка «+ Добавить тариф» и список тарифов
    await expect(page.getByRole('button', { name: '+ Добавить тариф' })).toBeVisible();
    const tariffTabs = page.locator('.card__tabs a.card__tab');
    expect(await tariffTabs.count()).toBeGreaterThan(1);
    await expect(tariffTabs.filter({ hasText: EXISTING_TARIFF.name })).toBeVisible();

    // Переключение на другой тариф из списка и обратно на «!!!ОДНОСТАВОЧНЫЙ»
    const secondTab = tariffTabs.nth(1);
    const secondName = (await secondTab.innerText()).trim();
    await secondTab.click();
    await expect(page.locator('.card__tabs a.card__tab.active')).toHaveText(secondName);

    await tariffTabs.filter({ hasText: EXISTING_TARIFF.name }).click();
    await expect(page.locator('.card__tabs a.card__tab.active')).toHaveText(EXISTING_TARIFF.name);

    // Периоды тарифа «!!!ОДНОСТАВОЧНЫЙ»: чек-боксы аккордеонов, таблица и кнопки
    const firstPeriodLabel = page.locator('.period-container label[for^="period_"]').first();
    const firstPeriodInput = page.locator('.period-container input[name="period"]').first();
    await expect(firstPeriodLabel).toBeVisible();

    // Раскрываем первый период кликом по label
    const wasChecked = await firstPeriodInput.isChecked();
    await firstPeriodLabel.click();
    await expect(firstPeriodInput).toBeChecked({ checked: !wasChecked });
    if (wasChecked) {
      await firstPeriodLabel.click();
      await expect(firstPeriodInput).toBeChecked({ checked: true });
    }

    const firstPeriodBody = page.locator('.period-container .body').first();
    await expect(firstPeriodBody).toBeVisible();
    await expect(firstPeriodBody.locator('th', { hasText: 'Тип показаний' })).toBeVisible();
    await expect(firstPeriodBody.locator('th', { hasText: 'Стоимость, руб/кВт ч' })).toBeVisible();
    await expect(firstPeriodBody.getByRole('button', { name: 'Редактировать период' })).toBeVisible();

    await expect(page.getByRole('button', { name: '+ Добавить новый период' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Редактировать название тарифа' })).toBeVisible();
    // К тарифу «!!!ОДНОСТАВОЧНЫЙ» привязаны счётчики, поэтому кнопки «Удалить тариф» быть не должно
    await expect(page.getByRole('button', { name: 'Удалить тариф' })).toHaveCount(0);
    log('✓ Все элементы вкладки «Тарифы» и периоды тарифа «!!!ОДНОСТАВОЧНЫЙ» отображаются корректно');
  });

  test('1.2 Вкладка «Тарифы»: редактирование тарифа «!!!ОДНОСТАВОЧНЫЙ» (название и ставка периода) с возвратом', async ({ page }) => {
    await open(page, `/snt/bookkeeping/tariffs/?id=${EXISTING_TARIFF.id}`);
    const tempName = `${EXISTING_TARIFF.name} ред`;
    const tempRate = '5.45';

    // Считываем текущую ставку Т1 первого периода, чтобы гарантированно вернуть точное исходное значение
    const firstPeriodInput = page.locator(`#period_${EXISTING_TARIFF.periodId}`);
    if (!(await firstPeriodInput.isChecked())) {
      await page.locator(`label[for="period_${EXISTING_TARIFF.periodId}"]`).click();
    }
    const firstBody = page.locator(`label[for="period_${EXISTING_TARIFF.periodId}"] + .body`);
    const origRate = (await firstBody.locator('tbody tr td').nth(1).innerText()).trim() || EXISTING_TARIFF.originalRateT1;
    let nameRestored = true;
    let rateRestored = true;

    try {
      // 1) Редактируем название тарифа
      await page.getByRole('button', { name: 'Редактировать название тарифа' }).click();
      let f = await sliderFrame(page, `/snt/bookkeeping/tariffs/edit/?id=${EXISTING_TARIFF.id}`);
      await expect(f.locator('#NAME')).toHaveValue(EXISTING_TARIFF.name);
      await f.locator('#NAME').fill(tempName);
      nameRestored = false;
      await submitSliderForm(page, f.locator('button[name="send"]', { hasText: 'Сохранить' }));

      await open(page, `/snt/bookkeeping/tariffs/?id=${EXISTING_TARIFF.id}`);
      await expect(page.locator('.card__tabs a.card__tab.active')).toHaveText(tempName);
      log(`✓ Название тарифа изменено на «${tempName}»`);

      // Возвращаем исходное название
      await page.getByRole('button', { name: 'Редактировать название тарифа' }).click();
      f = await sliderFrame(page, `/snt/bookkeeping/tariffs/edit/?id=${EXISTING_TARIFF.id}`);
      await f.locator('#NAME').fill(EXISTING_TARIFF.name);
      await submitSliderForm(page, f.locator('button[name="send"]', { hasText: 'Сохранить' }));

      await open(page, `/snt/bookkeeping/tariffs/?id=${EXISTING_TARIFF.id}`);
      await expect(page.locator('.card__tabs a.card__tab.active')).toHaveText(EXISTING_TARIFF.name);
      nameRestored = true;
      log(`✓ Название тарифа возвращено: «${EXISTING_TARIFF.name}»`);

      // 2) Редактируем период (ставку Т1)
      if (!(await page.locator(`#period_${EXISTING_TARIFF.periodId}`).isChecked())) {
        await page.locator(`label[for="period_${EXISTING_TARIFF.periodId}"]`).click();
      }
      await firstBody.getByRole('button', { name: 'Редактировать период' }).click();
      f = await sliderFrame(page, '/snt/bookkeeping/tariffs/period_edit/');
      const priceInput = f.locator('input[name="PRICE_BLOCK[0][PRICE][]"]').first();
      await expect(priceInput).toBeVisible();
      await priceInput.fill(tempRate);
      rateRestored = false;
      await submitSliderForm(page, f.locator('button[name="send"]', { hasText: 'Сохранить' }));

      await open(page, `/snt/bookkeeping/tariffs/?id=${EXISTING_TARIFF.id}`);
      if (!(await page.locator(`#period_${EXISTING_TARIFF.periodId}`).isChecked())) {
        await page.locator(`label[for="period_${EXISTING_TARIFF.periodId}"]`).click();
      }
      await expect(firstBody.locator('tbody tr td').nth(1)).toHaveText(tempRate);
      log(`✓ Ставка периода изменена с ${origRate} на ${tempRate}`);

      // Возвращаем исходную ставку периода
      await firstBody.getByRole('button', { name: 'Редактировать период' }).click();
      f = await sliderFrame(page, '/snt/bookkeeping/tariffs/period_edit/');
      await f.locator('input[name="PRICE_BLOCK[0][PRICE][]"]').first().fill(origRate);
      await submitSliderForm(page, f.locator('button[name="send"]', { hasText: 'Сохранить' }));

      await open(page, `/snt/bookkeeping/tariffs/?id=${EXISTING_TARIFF.id}`);
      if (!(await page.locator(`#period_${EXISTING_TARIFF.periodId}`).isChecked())) {
        await page.locator(`label[for="period_${EXISTING_TARIFF.periodId}"]`).click();
      }
      await expect(firstBody.locator('tbody tr td').nth(1)).toHaveText(origRate);
      rateRestored = true;
      log(`✓ Ставка периода возвращена: ${origRate}`);
    } finally {
      // Аварийный откат, если тест прервался до штатного возврата значений
      if (!nameRestored) {
        await open(page, `/snt/bookkeeping/tariffs/?id=${EXISTING_TARIFF.id}`);
        await page.getByRole('button', { name: 'Редактировать название тарифа' }).click();
        const f = await sliderFrame(page, `/snt/bookkeeping/tariffs/edit/?id=${EXISTING_TARIFF.id}`);
        await f.locator('#NAME').fill(EXISTING_TARIFF.name);
        await submitSliderForm(page, f.locator('button[name="send"]', { hasText: 'Сохранить' }));
      }
      if (!rateRestored) {
        await open(page, `/snt/bookkeeping/tariffs/?id=${EXISTING_TARIFF.id}`);
        if (!(await page.locator(`#period_${EXISTING_TARIFF.periodId}`).isChecked())) {
          await page.locator(`label[for="period_${EXISTING_TARIFF.periodId}"]`).click();
        }
        await firstBody.getByRole('button', { name: 'Редактировать период' }).click();
        const f = await sliderFrame(page, '/snt/bookkeeping/tariffs/period_edit/');
        await f.locator('input[name="PRICE_BLOCK[0][PRICE][]"]').first().fill(origRate);
        await submitSliderForm(page, f.locator('button[name="send"]', { hasText: 'Сохранить' }));
      }
    }
  });

  test('1.3 Вкладка «Тарифы»: валидация пустой формы «+ Добавить тариф» и переключение всех параметров', async ({ page }) => {
    await open(page, '/snt/bookkeeping/tariffs/');
    await page.getByRole('button', { name: '+ Добавить тариф' }).click();
    const f = await sliderFrame(page, '/snt/bookkeeping/tariffs/add/');

    // HTML5-валидация обязательных полей на пустой форме
    expect((await validity(f.locator('#NAME'))).valid).toBe(false);
    expect((await validity(f.locator('#TYPE'))).valid).toBe(false);
    expect((await validity(f.locator('#DATE_BEGIN'))).valid).toBe(false);
    expect((await validity(f.locator('#DATE_END'))).valid).toBe(false);

    // Чек-бокс «Социальный тариф»
    await setCheckbox(f, '#SOCIAL', true);
    await setCheckbox(f, '#SOCIAL', false);

    // Чек-бокс «Учитывать потери» и радиокнопки «%» / «Руб.»
    await expect(f.locator('#is_losses')).toBeHidden();
    await setCheckbox(f, '#LOSSES', true);
    await expect(f.locator('#is_losses')).toBeVisible();
    await setCheckbox(f, '#PERCENT', true);
    await setCheckbox(f, '#RUB', true);
    await setCheckbox(f, '#LOSSES', false);
    await expect(f.locator('#is_losses')).toBeHidden();

    // Переключение типа счётчика: Однотарифный (1 поле цены), Двухтарифный (2 поля), Трёхтарифный (3 поля)
    await f.locator('#TYPE').selectOption('1');
    await expect(f.locator('#block-index-0 input[name="PRICE_BLOCK[0][PRICE][]"]')).toHaveCount(1);
    await f.locator('#TYPE').selectOption('2');
    await expect(f.locator('#block-index-0 input[name="PRICE_BLOCK[0][PRICE][]"]')).toHaveCount(2);
    await f.locator('#TYPE').selectOption('3');
    await expect(f.locator('#block-index-0 input[name="PRICE_BLOCK[0][PRICE][]"]')).toHaveCount(3);

    // Добавление и удаление диапазона потребления
    await f.locator('button.button-add-field', { hasText: 'Добавить диапазон' }).click();
    await expect(f.locator('#block-index-1')).toBeVisible();
    await f.locator('#block-index-1 button[onclick*="delBlock"]').click();
    await expect(f.locator('#block-index-1')).toHaveCount(0);

    await closeSlider(page);
    log('✓ Валидация и переключение всех элементов формы «+ Добавить тариф» проверены');
  });

  test('1.4 Вкладка «Тарифы»: создание, проверка и удаление 3 тестовых тарифов (1/2/3-тарифный, потери нет/руб/%, диапазоны 0/1/2)', async ({ page }) => {
    const s = stamp();
    const t1Name = `${TEST_PREFIX} Т1 без потерь ${s}`;
    const t1Renamed = `${t1Name} изм`;
    const t2Name = `${TEST_PREFIX} Т2 руб 1диап ${s}`;
    const t3Name = `${TEST_PREFIX} Т3 проц 2диап ${s}`;
    let allTariffsDeleted = false;
    needsEmergencyCleanup = true;

    try {
      // ─────────────────────────────────────────────────────────
      // ТАРИФ 1: Однотарифный + без потерь + без диапазонов
      // + проверка добавления периода, редактирования периода и названия
      // ─────────────────────────────────────────────────────────
      const t1 = await createTariff(page, {
        name: t1Name,
        type: '1',
        losses: false,
        dateBegin: '01.01.2026',
        dateEnd: '30.06.2026',
        blocks: [{ prices: ['4.50'] }],
      });

      await open(page, `/snt/bookkeeping/tariffs/?id=${t1.id}`);
      await expect(page.getByRole('button', { name: 'Удалить тариф' })).toBeVisible();

      // Раскрываем созданный период и проверяем ставку Т1 = 4.5
      const p1Label = page.locator('.period-container label[for^="period_"]').first();
      await expect(p1Label).toContainText('Период с 01.01.2026 по 30.06.2026');
      await p1Label.click();
      await expect(page.locator('.period-container .body').first()).toContainText('4.5');

      // Добавляем новый период через «+ Добавить новый период»
      await page.getByRole('button', { name: '+ Добавить новый период' }).click();
      let f = await sliderFrame(page, '/snt/bookkeeping/tariffs/period_add/');
      // Дата начала автоматически равна следующему дню после прошлого периода (01.07.2026)
      await expect(f.locator('#DATE_BEGIN')).toHaveValue('01.07.2026');
      await setDateInput(f, '#DATE_END', '31.12.2026');
      await f.locator('input[name="PRICE_BLOCK[0][PRICE][]"]').first().fill('5.10');
      await submitSliderForm(page, f.locator('button[name="send"]', { hasText: 'Добавить' }));

      await open(page, `/snt/bookkeeping/tariffs/?id=${t1.id}`);
      await expect(page.locator('.period-container label[for^="period_"]')).toHaveCount(2);
      const newPeriodLabel = page.locator('.period-container label[for^="period_"]', { hasText: '01.07.2026 по 31.12.2026' });
      await expect(newPeriodLabel).toBeVisible();
      await newPeriodLabel.click();

      // Редактируем добавленный период
      const newPeriodBody = page.locator('.period-container .body').first();
      await newPeriodBody.getByRole('button', { name: 'Редактировать период' }).click();
      f = await sliderFrame(page, '/snt/bookkeeping/tariffs/period_edit/');
      await f.locator('input[name="PRICE_BLOCK[0][PRICE][]"]').first().fill('5.25');
      await submitSliderForm(page, f.locator('button[name="send"]', { hasText: 'Сохранить' }));

      await open(page, `/snt/bookkeeping/tariffs/?id=${t1.id}`);
      await page.locator('.period-container label[for^="period_"]', { hasText: '01.07.2026 по 31.12.2026' }).click();
      await expect(page.locator('.period-container .body').first()).toContainText('5.25');

      // Редактируем название тестового тарифа
      await page.getByRole('button', { name: 'Редактировать название тарифа' }).click();
      f = await sliderFrame(page, `/snt/bookkeeping/tariffs/edit/?id=${t1.id}`);
      await f.locator('#NAME').fill(t1Renamed);
      await submitSliderForm(page, f.locator('button[name="send"]', { hasText: 'Сохранить' }));

      await open(page, `/snt/bookkeeping/tariffs/?id=${t1.id}`);
      await expect(page.locator('.card__tabs a.card__tab.active')).toHaveText(t1Renamed);

      // Удаляем Тариф 1
      await deleteTariffByName(page, t1Renamed);

      // ─────────────────────────────────────────────────────────
      // ТАРИФ 2: Двухтарифный + потери в рублях + 1 диапазон (100 кВт)
      // ─────────────────────────────────────────────────────────
      const t2 = await createTariff(page, {
        name: t2Name,
        type: '2',
        losses: true,
        lossesType: 'RUB',
        dateBegin: '01.01.2026',
        dateEnd: '31.12.2026',
        blocks: [
          { prices: ['5.00', '3.00'], lossesRub: ['0.50', '0.30'] },
          { range: '100', prices: ['6.00', '3.50'], lossesRub: ['0.60', '0.35'] },
        ],
      });

      await open(page, `/snt/bookkeeping/tariffs/?id=${t2.id}`);
      await page.locator('.period-container label[for^="period_"]').first().click();
      const body2 = page.locator('.period-container .body').first();
      await expect(body2).toContainText('Суммарное потребление от 0 кВт ч');
      await expect(body2).toContainText('Суммарное потребление от 100 кВт ч');
      await expect(body2).toContainText('Потери, руб');
      await expect(body2).toContainText('0.5');
      await expect(body2).toContainText('0.6');
      log('✓ Тариф 2 (Двухтарифный, потери в рублях, 1 диапазон 100 кВт) проверен');

      await deleteTariffByName(page, t2Name);

      // ─────────────────────────────────────────────────────────
      // ТАРИФ 3: Трёхтарифный + потери в процентах + 2 диапазона (100 кВт и 200 кВт)
      // ─────────────────────────────────────────────────────────
      const t3 = await createTariff(page, {
        name: t3Name,
        type: '3',
        losses: true,
        lossesType: 'PERCENT',
        dateBegin: '01.01.2026',
        dateEnd: '31.12.2026',
        blocks: [
          { prices: ['6.00', '4.50', '3.00'], lossesPercent: '5' },
          { range: '100', prices: ['7.00', '5.00', '3.50'], lossesPercent: '7' },
          { range: '200', prices: ['8.00', '6.00', '4.00'], lossesPercent: '10' },
        ],
      });

      await open(page, `/snt/bookkeeping/tariffs/?id=${t3.id}`);
      await page.locator('.period-container label[for^="period_"]').first().click();
      const body3 = page.locator('.period-container .body').first();
      await expect(body3).toContainText('Суммарное потребление от 0 кВт ч');
      await expect(body3).toContainText('Суммарное потребление от 100 кВт ч');
      await expect(body3).toContainText('Суммарное потребление от 200 кВт ч');
      await expect(body3).toContainText('Потери, %');
      await expect(body3).toContainText('Т1');
      await expect(body3).toContainText('Т2');
      await expect(body3).toContainText('Т3');
      await expect(body3).toContainText('5');
      await expect(body3).toContainText('7');
      await expect(body3).toContainText('10');
      log('✓ Тариф 3 (Трёхтарифный, потери в %, 2 диапазона 100 и 200 кВт) проверен');

      await deleteTariffByName(page, t3Name);
      allTariffsDeleted = true;
      needsEmergencyCleanup = false;
    } finally {
      if (!allTariffsDeleted) {
        for (const name of [t1Name, t1Renamed, t2Name, t3Name]) {
          await deleteTariffByName(page, name).catch(() => {});
        }
        needsEmergencyCleanup = false;
      }
    }
  });

  // ════════════════════════════════════════════════════════════
  // 2. Подраздел «Счетчики» (/snt/bookkeeping/tariffs/counters/)
  // ════════════════════════════════════════════════════════════
  test('2.1 Вкладка «Счетчики»: отображение шагов импорта, кнопок, вкладок и всех колонок таблицы', async ({ page }) => {
    await openGrid(page, '/snt/bookkeeping/tariffs/counters/');

    // Шаги загрузки файла
    await expect(page.locator('.steps__item-title', { hasText: 'Загрузите файл' })).toBeVisible();
    await expect(page.locator('.steps__item-title', { hasText: 'Обработка файла' })).toBeVisible();
    await expect(page.locator('.steps__item-title', { hasText: 'Обработка данных' })).toBeVisible();

    // Ссылки скачивания шаблонов и кнопки
    await expect(page.locator('a', { hasText: /Скачать пример файла для массового добавления счётчиков/i })).toBeVisible();
    await expect(page.locator('a', { hasText: /Скачать пример файла для массового добавления показаний/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Загрузить данные' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Добавить счётчик' })).toBeVisible();

    // Подвкладки «Действующие счётчики» / «Архивные счётчики», «Экспорт в Excel» и строка поиска
    await expect(page.locator('a.card__tab', { hasText: 'Действующие счётчики' })).toBeVisible();
    await expect(page.locator('a.card__tab', { hasText: 'Архивные счётчики' })).toBeVisible();
    await expect(page.locator('a', { hasText: 'Экспорт в Excel' })).toBeVisible();
    await expect(page.locator('input[name="FIND"]')).toBeVisible();

    // Проверка наличия всех стандартных колонок таблицы
    for (const col of COUNTER_COLUMNS) {
      const vals = await columnValues(page, col);
      expect(vals, `колонка «${col}» должна присутствовать в таблице счётчиков`).not.toBeNull();
    }
    expect(await gridRows(page).count()).toBeGreaterThan(0);
    log(`✓ Проверены все ${COUNTER_COLUMNS.length} колонок таблицы счётчиков`);
  });

  test('2.2 Вкладка «Счетчики»: скачивание обоих файлов-шаблонов и выгрузки «Экспорт в Excel» (.xlsx)', async ({ page }) => {
    await open(page, '/snt/bookkeeping/tariffs/counters/');

    // 1) Пример файла для массового добавления счётчиков
    const linkCounters = page.locator('a', { hasText: /Скачать пример файла для массового добавления счётчиков/i });
    const [dl1] = await Promise.all([
      page.waitForEvent('download', { timeout: 35_000 }),
      linkCounters.click(),
    ]);
    const file1 = path.join(os.tmpdir(), `counters-template-${Date.now()}.xlsx`);
    await dl1.saveAs(file1);
    expect(fs.statSync(file1).size).toBeGreaterThan(0);
    const rows1 = readXlsx(file1);
    expect(rows1[0]).toEqual(expect.arrayContaining([
      'Номер участка',
      'Улица',
      'Марка счётчика',
      'Серийный номер',
      'Номер пломбы',
      'Тариф',
      'Дата',
      'Показания Т1',
      'Следующая дата поверки',
    ]));
    log(`✓ Скачан шаблон счётчиков «${dl1.suggestedFilename()}» (${rows1.length} строк)`);

    // 2) Пример файла для массового добавления показаний
    const linkReadings = page.locator('a', { hasText: /Скачать пример файла для массового добавления показаний/i });
    const [dl2] = await Promise.all([
      page.waitForEvent('download', { timeout: 35_000 }),
      linkReadings.click(),
    ]);
    const file2 = path.join(os.tmpdir(), `readings-template-${Date.now()}.xlsx`);
    await dl2.saveAs(file2);
    expect(fs.statSync(file2).size).toBeGreaterThan(0);
    const rows2 = readXlsx(file2);
    expect(rows2[0]).toEqual(expect.arrayContaining([
      'Номер участка',
      'Улица',
      'Тариф',
      'Дата',
      'Показания Т1',
    ]));
    log(`✓ Скачан шаблон показаний «${dl2.suggestedFilename()}» (${rows2.length} строк)`);

    // 3) Выгрузка «Экспорт в Excel»
    const linkExport = page.locator('a', { hasText: 'Экспорт в Excel' }).first();
    const [dl3] = await Promise.all([
      page.waitForEvent('download', { timeout: 35_000 }),
      linkExport.click(),
    ]);
    const file3 = path.join(os.tmpdir(), `counters-export-${Date.now()}.xlsx`);
    await dl3.saveAs(file3);
    expect(fs.statSync(file3).size).toBeGreaterThan(0);
    const rows3 = readXlsx(file3);
    expect(rows3.length).toBeGreaterThan(1);
    log(`✓ Скачан файл «Экспорт в Excel» («${dl3.suggestedFilename()}», ${rows3.length} строк)`);
  });

  test('2.3 Вкладка «Счетчики»: поиск и фильтрация по номеру участка, названию тарифа и типу счётчика', async ({ page }) => {
    await openGrid(page, '/snt/bookkeeping/tariffs/counters/');

    try {
      // 1) Быстрый поиск в строке «Поиск и фильтрация»
      await quickSearch(page, COUNTER_UNIT_6.serial);
      await expect(gridRow(page, COUNTER_UNIT_6.serial)).toBeVisible();
      await resetFilter(page);

      // 2) Фильтр по полю «Участок» (input[name="SECTORS_SEARCH"])
      let popup = await openFilter(page);
      await popup.locator('input[name="SECTORS_SEARCH"]').fill(COUNTER_UNIT_6.unitNumber);
      await filterApply(page, popup);
      const unitVals = await columnValues(page, 'Участок');
      expect(unitVals.length).toBeGreaterThan(0);
      expect(unitVals.every((v) => v === COUNTER_UNIT_6.unitNumber)).toBe(true);
      log(`✓ Фильтр по полю «Участок = ${COUNTER_UNIT_6.unitNumber}»: найдено строк ${unitVals.length}`);
      await resetFilter(page);

      // 3) Фильтр по полю «Название тарифа» (input[name="TARIFF_NAME"])
      popup = await openFilter(page);
      await popup.locator('input[name="TARIFF_NAME"]').fill(COUNTER_UNIT_6.tariffName);
      await filterApply(page, popup);
      const tariffVals = await columnValues(page, 'Название тарифа');
      expect(tariffVals.length).toBeGreaterThan(0);
      expect(tariffVals.every((v) => v === COUNTER_UNIT_6.tariffName)).toBe(true);
      log(`✓ Фильтр по полю «Название тарифа = ${COUNTER_UNIT_6.tariffName}»: найдено строк ${tariffVals.length}`);
      await resetFilter(page);

      // 4) Фильтр по полю «Тип счетчика» (select TARIFF_TYPE)
      popup = await openFilter(page);
      await filterSelect(page, 'Тип счетчика', COUNTER_UNIT_6.tariffType);
      await filterApply(page, popup);
      const typeVals = await columnValues(page, 'Тип счетчика');
      expect(typeVals.length).toBeGreaterThan(0);
      expect(typeVals.every((v) => v === COUNTER_UNIT_6.tariffType)).toBe(true);
      log(`✓ Фильтр по полю «Тип счетчика = ${COUNTER_UNIT_6.tariffType}»: найдено строк ${typeVals.length}`);
    } finally {
      await resetFilter(page).catch(() => {});
    }
  });

  test('2.4 Вкладка «Счетчики»: валидация «Загрузить данные» без файла и импорт счётчика через .xlsx с очисткой', async ({ page }) => {
    const s = stamp();
    const impSerial = `AT-IMP-${s}`;
    const impPlomb = `PL-IMP-${s}`;
    const impBrand = `${TEST_PREFIX}Импорт`;
    let impDeleted = false;
    needsEmergencyCleanup = true;

    await openGrid(page, '/snt/bookkeeping/tariffs/counters/');
    // Если от прерванного прогона на тестовом участке остался счётчик — удаляем его сразу без лишних переходов
    const leftoverIds = await gridRow(page, 'AT-').evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-id')).filter(Boolean));
    for (const id of leftoverIds) await deleteCounterById(page, id);

    try {
      // 1) Валидация кнопки «Загрузить данные» без выбранного файла
      await page.getByRole('button', { name: 'Загрузить данные' }).click();
      const msgBox = page.locator('.popup-window:visible', { hasText: 'Сначала выберите и добавьте файл в поле выше' });
      await expect(msgBox).toBeVisible();
      await confirmYes(page);
      await expect(msgBox).toBeHidden();
      log('✓ Валидация «Загрузить данные» без файла проверена');

      // 2) Формируем .xlsx для свободного участка №14 и проходим шаги 1 → 2 → 3
      const xlsxFile = path.join(os.tmpdir(), `import-counter-${Date.now()}.xlsx`);
      writeXlsx(xlsxFile, [
        [
          'Номер участка',
          'Улица',
          'Марка счётчика',
          'Серийный номер',
          'Номер пломбы',
          'Тариф',
          'Дата',
          'Показания Т1',
          'Показания Т2',
          'Показания Т3',
          'Следующая дата поверки',
        ],
        [
          FREE_UNIT.number,
          FREE_UNIT.street,
          impBrand,
          impSerial,
          impPlomb,
          EXISTING_TARIFF.name,
          '01.10.2026',
          '0',
          '',
          '',
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

      // Проверяем появление импортированного счётчика в таблице и сразу удаляем его по ID
      await openGrid(page, '/snt/bookkeeping/tariffs/counters/?mode=active');
      const row = gridRow(page, impSerial).first();
      await expect(row, `импортированный счётчик «${impSerial}» появился в списке`).toBeVisible();
      await expect(row).toContainText(impBrand);
      await expect(row).toContainText(impPlomb);
      const impId = await row.getAttribute('data-id');
      if (impId) {
        await deleteCounterById(page, impId);
        impDeleted = true;
        needsEmergencyCleanup = false;
      }
      log(`✓ Импорт счётчика «${impSerial}» через .xlsx выполнен успешно и очищен (id=${impId})`);
    } finally {
      if (!impDeleted) {
        await cleanupCounterByText(page, impSerial);
        needsEmergencyCleanup = false;
      }
    }
  });

  // ════════════════════════════════════════════════════════════
  // 3. Подраздел «Действующие счётчики» (/snt/bookkeeping/tariffs/counters/?mode=active)
  // ════════════════════════════════════════════════════════════
  test('3.1 Вкладка «Действующие счётчики»: редактирование счётчика участка №6 (Соснов Е.П.) и возврат исходных данных', async ({ page }) => {
    await openGrid(page, '/snt/bookkeeping/tariffs/counters/?mode=active');

    const tempBrand = `${COUNTER_UNIT_6.brand}-Тест`;
    const tempSerial = `${COUNTER_UNIT_6.serial}-T`;
    const tempPlomb = `${COUNTER_UNIT_6.plomb}-T`;

    try {
      await gridRowAction(page, COUNTER_UNIT_6.serial, 'Редактировать');
      let f = await sliderFrame(page, `/snt/bookkeeping/tariffs/counters/edit/?ID=${COUNTER_UNIT_6.id}`);

      await expect(f.locator('input[name="BRAND"]')).toHaveValue(COUNTER_UNIT_6.brand);
      await expect(f.locator('input[name="SERIAL_NUMBER"]')).toHaveValue(COUNTER_UNIT_6.serial);
      await expect(f.locator('input[name="NUMBER"]')).toHaveValue(COUNTER_UNIT_6.plomb);

      await f.locator('input[name="BRAND"]').fill(tempBrand);
      await f.locator('input[name="SERIAL_NUMBER"]').fill(tempSerial);
      await f.locator('input[name="NUMBER"]').fill(tempPlomb);
      await f.locator('select[name="TARIFF_ID"]').selectOption(COUNTER_UNIT_6.tariffId);
      await submitSliderForm(page, f.locator('button[name="send"]', { hasText: 'Сохранить' }));

      await openGrid(page, '/snt/bookkeeping/tariffs/counters/?mode=active');
      const updatedRow = gridRow(page, tempSerial).first();
      await expect(updatedRow).toBeVisible();
      await expect(updatedRow).toContainText(tempBrand);
      await expect(updatedRow).toContainText(tempPlomb);
      log(`✓ Счётчик участка №6 отредактирован (${tempBrand}, ${tempSerial}, ${tempPlomb})`);
    } finally {
      // Гарантированный откат исходных значений счётчика участка №6
      await open(page, `/snt/bookkeeping/tariffs/counters/edit/?ID=${COUNTER_UNIT_6.id}&IFRAME=Y&IFRAME_TYPE=SIDE_SLIDER`);
      await page.locator('input[name="BRAND"]').fill(COUNTER_UNIT_6.brand);
      await page.locator('input[name="SERIAL_NUMBER"]').fill(COUNTER_UNIT_6.serial);
      await page.locator('input[name="NUMBER"]').fill(COUNTER_UNIT_6.plomb);
      await page.locator('select[name="TARIFF_ID"]').selectOption(COUNTER_UNIT_6.tariffId);
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 20_000 }),
        page.locator('button[name="send"]', { hasText: 'Сохранить' }).click(),
      ]);
      await page.waitForTimeout(300);

      await openGrid(page, '/snt/bookkeeping/tariffs/counters/?mode=active');
      const restoredRow = gridRow(page, COUNTER_UNIT_6.serial).first();
      await expect(restoredRow).toBeVisible();
      await expect(restoredRow).toContainText(COUNTER_UNIT_6.brand);
      await expect(restoredRow).toContainText(COUNTER_UNIT_6.plomb);
      log(`✓ Исходные данные счётчика участка №6 восстановлены (${COUNTER_UNIT_6.brand}, ${COUNTER_UNIT_6.serial}, ${COUNTER_UNIT_6.plomb})`);
    }
  });

  test('3.2 Вкладка «Действующие счётчики»: валидация пустой формы «Добавить счётчик» и переключение типов тарифа', async ({ page }) => {
    await openGrid(page, '/snt/bookkeeping/tariffs/counters/?mode=active');
    await page.getByRole('button', { name: 'Добавить счётчик' }).click();
    const f = await sliderFrame(page, '/snt/bookkeeping/tariffs/counters/add/');

    // Проверка обязательности полей
    expect((await validity(f.locator('input[name="BRAND"]'))).valid).toBe(false);
    expect((await validity(f.locator('#DATE'))).valid).toBe(false);
    expect((await validity(f.locator('input[name="DATA[1]"]'))).valid).toBe(false);

    // Чек-бокс «Добавить в Календарь событий» по умолчанию включён
    await expect(f.locator('#ADD_TO_CALENDAR_ELECTRO_ADD')).toBeChecked();
    await setCheckbox(f, '#ADD_TO_CALENDAR_ELECTRO_ADD', false);
    await setCheckbox(f, '#ADD_TO_CALENDAR_ELECTRO_ADD', true);

    // Переключение тарифа меняет «Тип тарифа» и количество полей «Текущие показания»
    await f.locator('select[name="TARIFF_ID"]').selectOption(EXISTING_TARIFF.id); // Однотарифный
    await expect(f.locator('#tariffType')).toContainText('Однотарифный');
    await expect(f.locator('#counterData input[name^="DATA["]')).toHaveCount(1);

    await f.locator('select[name="TARIFF_ID"]').selectOption('1869'); // Эконом день-ночь (Двухтарифный)
    await expect(f.locator('#tariffType')).toContainText('Двухтарифный');
    await expect(f.locator('#counterData input[name^="DATA["]')).toHaveCount(2);

    await f.locator('select[name="TARIFF_ID"]').selectOption('1870'); // Максимум баланса (Трехтарифный)
    await expect(f.locator('#tariffType')).toContainText('Трехтарифный');
    await expect(f.locator('#counterData input[name^="DATA["]')).toHaveCount(3);

    await closeSlider(page);
    log('✓ Валидация пустой формы «Добавить счётчик» и динамическая смена полей показаний проверены');
  });

  // ════════════════════════════════════════════════════════════
  // 4. Действия с действующими и архивными счётчиками
  // ════════════════════════════════════════════════════════════
  test('4.1 Полный цикл счётчика: создание без показаний → Календарь событий → Копировать → В архив → Из архива → Удаление', async ({ page }) => {
    const s = stamp();
    const brand = `${TEST_PREFIX}Счётчик`;
    const serial = `AT-CNT-${s}`;
    const copySerial = `AT-COPY-${s}`;
    const plomb = `AT-PL-${s}`;
    const verifyDate = '01.10.2027';
    let copyDeleted = false;
    let mainDeleted = false;
    needsEmergencyCleanup = true;

    try {
      // ─────────────────────────────────────────────────────────
      // 1) Создание тестового счётчика без показаний (DATA[1] = 0) и с датой поверки
      // ─────────────────────────────────────────────────────────
      await openGrid(page, '/snt/bookkeeping/tariffs/counters/?mode=active');
      await page.getByRole('button', { name: 'Добавить счётчик' }).click();
      let f = await sliderFrame(page, '/snt/bookkeeping/tariffs/counters/add/');

      await f.locator('select[name="SECTOR_ID"]').evaluate((el, val) => {
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, FREE_UNIT.sectorId);
      await f.locator('input[name="BRAND"]').fill(brand);
      await f.locator('input[name="SERIAL_NUMBER"]').fill(serial);
      await f.locator('input[name="NUMBER"]').fill(plomb);
      await f.locator('select[name="TARIFF_ID"]').selectOption(EXISTING_TARIFF.id);
      await setDateInput(f, '#DATE', '01.10.2026');
      await setDateInput(f, '#NEXT_VERIFICATION_DATE', verifyDate);
      // Снимаем галочку «Добавить в Календарь событий», чтобы протестировать добавление в календарь отдельно
      await setCheckbox(f, '#ADD_TO_CALENDAR_ELECTRO_ADD', false);
      await f.locator('input[name="DATA[1]"]').fill('0');
      await submitSliderForm(page, f.locator('button[name="send"]', { hasText: 'Сохранить' }));

      await openGrid(page, '/snt/bookkeeping/tariffs/counters/?mode=active');
      const row = gridRow(page, serial).first();
      await expect(row, `созданный счётчик «${serial}» отображается в действующих`).toBeVisible();
      await expect(row).toContainText(verifyDate);
      await expect(row).toContainText('Не в календаре');
      log(`✓ Создан тестовый счётчик «${serial}» без показаний со статусом «Не в календаре»`);

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
      // 4) Пункт меню «Копировать»
      // ─────────────────────────────────────────────────────────
      await gridRowAction(page, serial, 'Копировать');
      f = await sliderFrame(page, '/snt/bookkeeping/tariffs/counters/add/?COPY_ID=');
      await expect(f.locator('input[name="BRAND"]')).toHaveValue(brand);
      await expect(f.locator('input[name="NUMBER"]')).toHaveValue(plomb);
      await f.locator('input[name="SERIAL_NUMBER"]').fill(copySerial);
      await setCheckbox(f, '#ADD_TO_CALENDAR_ELECTRO_ADD', false);
      await submitSliderForm(page, f.locator('button[name="send"]', { hasText: 'Сохранить' }));

      await openGrid(page, '/snt/bookkeeping/tariffs/counters/?mode=active');
      await expect(gridRow(page, copySerial).first(), `копия счётчика «${copySerial}» создана`).toBeVisible();
      log(`✓ Проверено действие «Копировать» — создана копия «${copySerial}»`);

      // Переводим копию в архив и удаляем её
      await gridRowAction(page, copySerial, 'В архив');
      await confirmCounterAction(page);
      await expect(gridRow(page, copySerial)).toHaveCount(0, { timeout: 15_000 });

      await openGrid(page, '/snt/bookkeeping/tariffs/counters/?mode=archive');
      await expect(gridRow(page, copySerial).first()).toBeVisible({ timeout: 15_000 });
      await gridRowAction(page, copySerial, 'Удалить');
      await confirmCounterAction(page);
      await expect(gridRow(page, copySerial)).toHaveCount(0, { timeout: 15_000 });
      copyDeleted = true;
      log(`✓ Копия счётчика «${copySerial}» переведена в архив и удалена`);

      // ─────────────────────────────────────────────────────────
      // 5) Перевод основного тестового счётчика «В архив» → «Из архива» → «В архив» → Удаление
      // ─────────────────────────────────────────────────────────
      await openGrid(page, '/snt/bookkeeping/tariffs/counters/?mode=active');
      await gridRowAction(page, serial, 'В архив');
      await confirmCounterAction(page);
      await expect(gridRow(page, serial)).toHaveCount(0, { timeout: 15_000 });
      log(`✓ Счётчик «${serial}» переведён в архив и исчез из «Действующих счётчиков»`);

      // Проверяем в «Архивных счётчиках» и возвращаем «Из архива»
      await openGrid(page, '/snt/bookkeeping/tariffs/counters/?mode=archive');
      await expect(gridRow(page, serial).first()).toBeVisible({ timeout: 15_000 });
      await gridRowAction(page, serial, 'Из архива');
      await confirmCounterAction(page);
      await expect(gridRow(page, serial)).toHaveCount(0, { timeout: 15_000 });

      await openGrid(page, '/snt/bookkeeping/tariffs/counters/?mode=active');
      await expect(gridRow(page, serial).first()).toBeVisible({ timeout: 15_000 });
      log(`✓ Счётчик «${serial}» возвращён «Из архива» обратно в «Действующие счётчики»`);

      // Снова отправляем «В архив» для финального удаления
      await gridRowAction(page, serial, 'В архив');
      await confirmCounterAction(page);
      await expect(gridRow(page, serial)).toHaveCount(0, { timeout: 15_000 });

      // Проверяем кнопку «Удалить счётчики без показаний» во вкладке «Архивные счётчики»
      await openGrid(page, '/snt/bookkeeping/tariffs/counters/?mode=archive');
      await expect(gridRow(page, serial).first()).toBeVisible({ timeout: 15_000 });
      const delEmptyBtn = page.getByRole('button', { name: 'Удалить счётчики без показаний' });
      await expect(delEmptyBtn).toBeVisible();
      await delEmptyBtn.click();
      const delDialog = page.locator('.popup-window:visible', { hasText: 'Удаление счётчиков' });
      await expect(delDialog).toBeVisible();
      // Закрываем окно кнопкой «Отмена», чтобы не затронуть другие счётчики стенда
      await delDialog.locator('.popup-window-button, .ui-btn').filter({ hasText: /Отмена/i }).first().click();
      await expect(delDialog).toBeHidden();
      log('✓ Проверена кнопка «Удалить счётчики без показаний» и модальное окно подтверждения');

      // Удаляем тестовый счётчик из архива через меню строки «☰ → Удалить»
      await gridRowAction(page, serial, 'Удалить');
      await confirmCounterAction(page);
      await expect(gridRow(page, serial)).toHaveCount(0, { timeout: 15_000 });
      mainDeleted = true;
      needsEmergencyCleanup = false;
      log(`✓ Тестовый счётчик «${serial}» удалён из архива`);
    } finally {
      if (!mainDeleted) await cleanupCounterByText(page, serial);
      if (!copyDeleted) await cleanupCounterByText(page, copySerial);
      needsEmergencyCleanup = false;
    }
  });
});
