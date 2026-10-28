// ============================================================
// Смоук-тест: раздел «Участки» на lk.sntclub.ru (ЛК Председателя)
// Тестовый фреймворк: Playwright Test (@playwright/test)
//
// Архитектура (как в settings-snt.spec.js):
// Тест разбит на независимые этапы по вкладкам. Никаких serial-блоков нет:
// каждый test(...) полностью самодостаточен и откатывает свои изменения в finally.
// Если упадёт любой шаг на одной вкладке — остальные тесты и вкладки продолжат
// выполняться без каскадных падений.
//
// Этапы по вкладкам:
//  0. Навигация по всем 5 вкладкам раздела «Участки»
//  1. Вкладка «Информация об участках» (/snt/units/):
//     1.1 Отображение кнопок (+ Добавить участок, + Добавить группу, Скачать), колонок и таблицы
//     1.2 Быстрый поиск в строке «Поиск и фильтрация» + сброс
//     1.3 Все поля фильтра (Участок, Улица, Кадастровый номер, Площадь участка, Группа) → Найти → Сбросить
//     1.4 Кнопка «Скачать» — скачивание Excel-файла и проверка содержимого
//     1.5 Карточка участка №6 (Соснов Е.П.): 7 вкладок + выгрузки «Excel» и «PDF»
//     1.6 Редактирование участка №6 (Улица, Кадастровый номер, «Изменить площадь») → вернуть
//     1.7 Валидация пустой формы «+ Добавить участок» и закрытие попапа
//     1.8 Полный цикл тестового участка: создание → «Редактировать» и «Изменить площадь» из меню «☰» →
//         «Копировать участок» (и удаление копии) → групповые действия (инлайн-редактирование,
//         «Добавить в группу») → групповое «Удалить»
//  2. Вкладка «Группы участков» (/snt/regions/group/):
//     2.1 Отображение кнопки «Добавить новую группу», колонок, групп и меню строки «☰»
//     2.2 Полный цикл группы: валидация → создание → добавление участка в группу →
//         проверка в колонке «Участки» → переименование → удаление группы
//  3. Вкладка «Настройка дополнительных полей» (/snt/units/fields/):
//     3.1 Отображение таблицы, колонок и меню строки «☰»
//     3.2 Связка «Участок + обязательное доп. поле»: создание поля → проверка обязательности
//         и сохранения в карточке тестового участка → удаление поля и участка
//  4. Вкладка «Импорт/экспорт участков» (/snt/units/import/):
//     4.1 Экспорт: скачивание .xlsx и проверка заголовков + участка №6
//     4.2 Импорт: обновление Улицы участка №6 через CSV → проверка в карточке → возврат вторым импортом
//  5. Вкладка «Комплексный импорт/экспорт» (/snt/units/combined/):
//     5.1 Экспорт: все чек-боксы выбора колонок (Участок + Собственник), переключение, скачивание .xlsx
//     5.2 Импорт: комплексное обновление участка №6 и собственника Соснова через CSV → проверка → возврат
//
// Запуск:
//   ./run-units.sh
//   npx playwright test units.spec.js --workers=1 --headed
//   npx playwright test units.spec.js --workers=1 -g "2. Группы участков"
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

const TABS = [
  { name: 'Информация об участках', path: '/snt/units/' },
  { name: 'Группы участков', path: '/snt/regions/group/' },
  { name: 'Настройка дополнительных полей', path: '/snt/units/fields/' },
  { name: 'Импорт/экспорт участков', path: '/snt/units/import/' },
  { name: 'Комплексный импорт/экспорт', path: '/snt/units/combined/' },
];

const UNITS_COLUMNS = [
  '№',
  'Улица',
  'Группа',
  'Люди',
  'Кадастровый номер',
  'Площадь участка',
];

const GROUPS_COLUMNS = ['Название группы', 'Участки'];

const FIELDS_COLUMNS = ['Название поля', 'Тип', 'Обязательное?', 'Скрытое?'];

/** Существующий участок №6 (Соснов Егор Петрович), который редактируем и возвращаем как было */
const UNIT_6 = {
  id: '197332',
  number: '6',
  street: 'Каштановый бульвар',
  kdNumber: '77:659413:06',
  area: '960',
  group: 'Улицы с растительностью',
  ownerId: '244958',
  ownerLastName: 'Соснов',
  ownerName: 'Егор',
  ownerSecondName: 'Петрович',
  ownerFio: 'Соснов Егор Петрович',
  ownerEmail: 'sosnov_egor@mail.ru',
};

/** Префикс тестовых сущностей — по нему делается очистка */
const TEST_PREFIX = 'Автотест';

/** Файл с cookies авторизованной сессии (общий для всех тестов воркера) */
const AUTH_FILE = path.join(os.tmpdir(), 'sntclub-units-auth.json');

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

/** Открыть страницу с гридом и сбросить фильтр ТОЛЬКО если он остался от упавшего теста фильтрации */
async function openGrid(page, p) {
  await open(page, p);
  const find = page.locator('input[name="FIND"]');
  if ((await find.count()) === 0) return;
  const searchText = await find.inputValue().catch(() => '');
  const squares = await page.locator('.main-ui-filter-search .main-ui-square:visible').count();
  if (searchText || squares) {
    log(`Остался фильтр («${searchText}», полей: ${squares}) — сбрасываем`);
    await resetFilter(page);
  }
}

/** Проверка нативной HTML5-валидации поля */
async function validity(locator) {
  return locator.evaluate((el) => ({ valid: el.checkValidity(), message: el.validationMessage }));
}

function textRe(text) {
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\s*$`);
}

function gridRows(page) {
  return page.locator('tr.main-grid-row-body:not([hidden])');
}

function gridRow(page, text) {
  return gridRows(page).filter({ hasText: text });
}

async function waitGrid(page) {
  await page.waitForTimeout(400);
}

async function gridReload(page, action) {
  await Promise.all([
    page.waitForResponse((r) => /grid_id=|internal=true/.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 })
      .catch(() => log('  (ответ грида не дождались)')),
    action(),
  ]);
  await waitGrid(page);
}

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

/** Подтвердить действие: #confirmBox / BX-попап */
async function confirmYes(page) {
  const yes = page.locator(
    '#confirmBox.active #btnYes, .popup__dialog.active #btnYes, #confirmBox #btnYes:visible, ' +
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

/** Установить чек-бокс */
async function setCheckbox(root, selector, checked) {
  const input = root.locator(selector).first();
  if ((await input.isChecked()) === checked) return;
  const id = await input.getAttribute('id');
  const label = id ? root.locator(`label[for="${id}"]`).first() : null;
  if (label && (await label.isVisible().catch(() => false))) await label.click();
  else await input.click({ force: true });
  await input.page().waitForTimeout(250);
  if ((await input.isChecked()) !== checked) {
    await input.setChecked(checked, { force: true });
  }
  await expect(input).toBeChecked({ checked });
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

/** Скачивание по клику */
async function downloadByClick(page, locator, name) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
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
    return { file, name: dl.suggestedFilename() };
  }
  log(`Событие download не пришло — проверяем ответ ${href}`);
  const resp = await page.request.get(`${BASE_URL}${href}`);
  expect(resp.status()).toBe(200);
  expect((await resp.body()).length).toBeGreaterThan(0);
  return null;
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

/** CSV для импорта (UTF-8 с BOM, разделитель «;») */
function writeCsv(rows, prefix = 'units-import') {
  const file = path.join(os.tmpdir(), `${prefix}-${Date.now()}.csv`);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  fs.writeFileSync(file, '\uFEFF' + rows.map((r) => r.map(esc).join(';')).join('\r\n'));
  return file;
}

/** Iframe боковой панели (SIDE_SLIDER) по части URL */
async function sliderFrame(page, urlPart) {
  const frameEl = page.locator(`iframe[src*="${urlPart}"]`).last();
  await expect(frameEl).toBeVisible({ timeout: 15_000 });
  const frame = await (await frameEl.elementHandle()).contentFrame();
  await expect.poll(() => frame.url(), { timeout: 15_000 }).toContain(urlPart);
  await frame.waitForLoadState('load');
  await frame.locator('form, body').first().waitFor();
  await page.waitForTimeout(500);
  return frame;
}

/** Закрыть боковую панель */
async function closeSlider(page) {
  const close = page.locator('.side-panel-label-icon-close:visible, .side-panel-close:visible').first();
  if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) await close.click();
  else await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

/**
 * Заполнить обязательные дополнительные поля участка на форме (в попапе создания или на странице ?edit=y).
 */
async function fillUnitCustomFields(root, commentText = 'Автотест комментарий') {
  const radioYes = root.locator('input[type="radio"][name="PROPERTY_2966"][value="Да"]');
  if ((await radioYes.count()) > 0 && !(await radioYes.isChecked())) {
    const labelYes = root.locator('label[for="PROPERTY_2966Да"]').first();
    if (await labelYes.isVisible().catch(() => false)) await labelYes.click();
    else await radioYes.check({ force: true });
  }

  const multiSelect = root.locator('select[name="PROPERTY_3180[]"]');
  if ((await multiSelect.count()) > 0) {
    await multiSelect.selectOption(['Электроэнергия']);
  }

  const prop3181 = root.locator('input[name="PROPERTY_3181"]');
  if ((await prop3181.count()) > 0) {
    const selectWrap = prop3181.locator('xpath=ancestor::div[contains(@class,"select")][1]');
    if (await selectWrap.isVisible().catch(() => false)) {
      await selectWrap.click();
      const firstItem = selectWrap.locator('.select__item').first();
      if (await firstItem.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await firstItem.click();
      }
    }
    if (!(await prop3181.inputValue())) {
      await prop3181.evaluate((el) => { el.value = 'Параметр 1'; });
    }
  }

  const prop3182 = root.locator('textarea[name="PROPERTY_3182"], input[name="PROPERTY_3182"]');
  if ((await prop3182.count()) > 0) {
    await prop3182.first().fill(commentText);
  }

  // Универсальная обработка любых обязательных кастомных полей стенда (testdev / release / lk)
  await root.evaluate((container, comment) => {
    for (const r of container.querySelectorAll('input[type="radio"][name^="PROPERTY_"][required]')) {
      if (!r.value) r.removeAttribute('required');
    }
    const radioNames = new Set(
      [...container.querySelectorAll('input[type="radio"][name^="PROPERTY_"][required]')].map((el) => el.name)
    );
    for (const name of radioNames) {
      const radios = [...container.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)];
      if (radios.length > 0 && !radios.some((r) => r.checked)) {
        radios[0].checked = true;
        radios[0].dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    for (const sel of container.querySelectorAll('select[name^="PROPERTY_"][required]')) {
      if (!sel.value && sel.options.length > 0) {
        const opt = [...sel.options].find((o) => o.value !== '') || sel.options[0];
        if (opt && opt.value !== '') {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          sel.removeAttribute('required');
        }
      }
    }
  }, commentText);
}

/**
 * Создать тестовый участок через «+ Добавить участок» на /snt/units/.
 * Не использует quickSearch, чтобы не оставлять серверный фильтр Bitrix в сессии!
 */
async function createUnit(page, u) {
  await openGrid(page, '/snt/units/');
  await page.getByRole('button', { name: '+ Добавить участок' }).click();
  const popup = page.locator('#popupContainer');
  await expect(popup.locator('input[name="SECTOR_NUMBER"]')).toBeVisible();

  await popup.locator('input[name="SECTOR_NUMBER"]').fill(u.number);
  await popup.locator('input[name="SECTOR_AREA"]').fill(u.area || '500');
  if (u.kdNumber) await popup.locator('input[name="KD_NUMBER"]').fill(u.kdNumber);
  if (u.street) await popup.locator('input[name="SECTOR_STREET"]').fill(u.street);
  await fillUnitCustomFields(popup, u.comment || 'Автотест комментарий');

  await popup.locator('button[type="submit"]', { hasText: 'Добавить участок' }).click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1200);

  await openGrid(page, '/snt/units/');
  const row = gridRow(page, u.number).first();
  await expect(row, `участок «${u.number}» появился в списке`).toBeVisible({ timeout: 15_000 });
  u.id = await row.getAttribute('data-id');
  log(`Создан тестовый участок id=${u.id} (№=${u.number})`);
  return u;
}

/** Удалить участок по тексту строки без включения серверного фильтра */
async function deleteUnitByNumber(page, number) {
  await openGrid(page, '/snt/units/');
  if ((await gridRow(page, number).count()) > 0) {
    log(`Удаляем участок «${number}»`);
    await gridRowAction(page, number, 'Удалить');
    await confirmYes(page);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1200);
    await openGrid(page, '/snt/units/');
    await expect(gridRow(page, number)).toHaveCount(0, { timeout: 15_000 });
  }
}

/** Изменить площадь участка через боковую панель /snt/units/editArea.php */
async function changeUnitAreaInSlider(page, newArea, dateStr = '01.10.2026') {
  const f = await sliderFrame(page, '/snt/units/editArea.php');
  await expect(f.locator('#new-sector-area')).toBeVisible();
  await f.locator('#new-sector-area').fill(String(newArea));
  await f.locator('#DATE').evaluate((el, val) => {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, dateStr);
  await f.locator('button[type="submit"]', { hasText: 'Сохранить' }).click();
  await page.waitForTimeout(1800);
  await closeSlider(page).catch(() => {});
  await page.waitForTimeout(800);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
}

/** Создать доп. поле для участка на /snt/units/fields/ */
async function createUnitProperty(page, { name, type = 'text', required = false, onlyPred = false, variants = [] }) {
  await open(page, '/snt/units/fields/');
  await page.getByRole('button', { name: 'Добавить поле' }).click();
  const f = await sliderFrame(page, '/snt/property/');
  await f.locator('#property-name').fill(name);
  await f.locator('#selectType').selectOption(type);
  for (let i = 0; i < variants.length; i++) {
    await f.locator('input[name="VALUE[]"]').nth(i).fill(variants[i]);
  }
  await setCheckbox(f, '#required-input', required);
  await setCheckbox(f, '#pred-access-input', onlyPred);
  await f.locator('button, input[type="submit"]').filter({ hasText: 'Добавить' }).last().click();
  await page.waitForTimeout(1800);
  await closeSlider(page).catch(() => {});
  await page.waitForTimeout(600);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await open(page, '/snt/units/fields/');
  await expect(gridRow(page, name).first(), `доп. поле «${name}» создано`).toBeVisible();
}

/** Удалить доп. поле участка по названию на /snt/units/fields/ */
async function deleteUnitProperty(page, name) {
  await open(page, '/snt/units/fields/');
  if ((await gridRow(page, name).count()) === 0) return;
  await gridRowAction(page, name, 'Удалить');
  await confirmYes(page);
  await page.waitForTimeout(1200);
  await open(page, '/snt/units/fields/');
  await expect(gridRow(page, name)).toHaveCount(0, { timeout: 15_000 });
}

/** Удалить группу участков по названию на /snt/regions/group/ */
async function deleteUnitGroup(page, groupName) {
  await open(page, '/snt/regions/group/');
  if ((await gridRow(page, groupName).count()) === 0) return;
  await gridRowAction(page, groupName, 'Удалить');
  await confirmYes(page);
  await page.waitForTimeout(1200);
  await open(page, '/snt/regions/group/');
  await expect(gridRow(page, groupName)).toHaveCount(0, { timeout: 15_000 });
}

/** Отменить незавершённую сессию импорта на /snt/units/import/ или /snt/units/combined/ */
async function cancelImportSessionOn(page, pathUrl) {
  await open(page, pathUrl);
  const cancel = page.locator('#import-preview-area #btn-cancel');
  if (await cancel.isVisible({ timeout: 2_000 }).catch(() => false)) {
    log(`Отменяем незавершённую сессию импорта на ${pathUrl}`);
    await cancel.click();
    await confirmYes(page);
    await expect(page.locator('#import-preview-area #btn-cancel')).toBeHidden({ timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(800);
    await open(page, pathUrl);
  }
}

/** Временно переключить флаг «Обязательное поле» у существующего доп. поля на /snt/units/fields/ */
async function setUnitPropertyRequired(page, name, required) {
  await open(page, '/snt/units/fields/');
  const row = gridRow(page, name).first();
  if ((await row.count()) === 0) return false;
  const reqCellText = (await row.locator('td').nth(3).innerText().catch(() => '')).trim();
  const isCurrentlyReq = reqCellText === 'Да';
  if (isCurrentlyReq === required) return false;
  log(`Временно ставим «Обязательное = ${required ? 'Да' : 'Нет'}» для поля «${name}»`);
  await gridRowAction(page, name, 'Редактировать');
  const f = await sliderFrame(page, '/snt/property/');
  // Убираем пустые поля вариантов (VALUE[]), которые шаблон /snt/property/ рендерит по умолчанию,
  // чтобы при сохранении не создавались пустые radio-варианты
  await f.locator('li.form__input-list-item').evaluateAll((items) => {
    for (const li of items) {
      const inp = li.querySelector('input[name="VALUE[]"]');
      if (inp && !inp.value.trim()) li.remove();
    }
  });
  await setCheckbox(f, '#required-input', required);
  await f.locator('button, input[type="submit"]').filter({ hasText: /Сохранить|Добавить/ }).last().click();
  await page.waitForTimeout(1500);
  await closeSlider(page).catch(() => {});
  await page.waitForTimeout(600);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return true;
}

/** Импорт CSV-файла на /snt/units/import/ или /snt/units/combined/ */
async function runImportOn(page, pathUrl, fileInputSelector, file, expectFields = {}) {
  await cancelImportSessionOn(page, pathUrl);
  await page.locator('#tab-import').click();
  await page.locator(fileInputSelector).setInputFiles(file);
  await expect(page.locator('#btn-upload')).toBeEnabled();
  await page.locator('#btn-upload').click();

  await expect(page.locator('#import-preview-area')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#pimport-tbody tr')).toHaveCount(1, { timeout: 30_000 });
  for (const [field, value] of Object.entries(expectFields)) {
    const input = page.locator(`#pimport-tbody [data-field="${field}"]`).first();
    if ((await input.count()) > 0) {
      await expect(input).toHaveValue(value);
    }
  }
  await expect(page.locator('#pimport-errors-banner')).toBeHidden();
  await expect(page.locator('#btn-apply')).toBeEnabled();
  await page.locator('#btn-apply').click();
  await confirmYes(page);
  await page.waitForTimeout(900);
  await confirmYes(page);
  await page.waitForTimeout(1600);
}

/** Новый контекст с сохранённой авторизацией — для afterAll-очистки */
async function withAuthPage(browser, fn) {
  const ctx = await browser.newContext({ storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined });
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

// ─────────────────────────────────────────────────────────────
// ТЕСТЫ (разбиты по вкладкам как независимые этапы)
// ─────────────────────────────────────────────────────────────

test.describe('Раздел «Участки» (lk.sntclub.ru)', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    page.on('dialog', (d) => d.accept().catch(() => {}));
  });

  // Страховочная очистка по префиксу — на случай, если какой-то тест был прерван извне
  test.afterAll(async ({ browser }) => {
    await withAuthPage(browser, async (page) => {
      await cancelImportSessionOn(page, '/snt/units/import/').catch(() => {});
      await cancelImportSessionOn(page, '/snt/units/combined/').catch(() => {});

      await open(page, '/snt/units/fields/');
      const props = await gridRows(page).filter({ hasText: TEST_PREFIX }).allInnerTexts();
      for (const row of props) {
        const name = row.split('\t').map((x) => x.trim()).find((x) => x.startsWith(TEST_PREFIX));
        if (name) await deleteUnitProperty(page, name).catch(() => {});
      }

      await open(page, '/snt/regions/group/');
      const groups = await gridRows(page).filter({ hasText: TEST_PREFIX }).allInnerTexts();
      for (const row of groups) {
        const name = row.split('\t').map((x) => x.trim()).find((x) => x.startsWith(TEST_PREFIX));
        if (name) await deleteUnitGroup(page, name).catch(() => {});
      }

      for (let i = 0; i < 5; i++) {
        await openGrid(page, '/snt/units/');
        if ((await gridRow(page, TEST_PREFIX).count()) === 0) break;
        await gridRowAction(page, TEST_PREFIX, 'Удалить').catch(() => {});
        await confirmYes(page);
        await page.waitForTimeout(1200);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 0. Навигация по всем 5 вкладкам раздела
  // ═══════════════════════════════════════════════════════════
  test('0. Навигация по 5 вкладкам раздела «Участки»', async ({ page }) => {
    await open(page, '/snt/units/');
    for (const tab of TABS) {
      log(`Вкладка «${tab.name}» (${tab.path})`);
      await page.locator(`a.tabs__link[href="${tab.path}"]`).first().click();
      await page.waitForURL(`${BASE_URL}${tab.path}`);
      await expect(page.locator('li.tabs__item.active a.tabs__link')).toHaveAttribute('href', tab.path);
      await expect(page.locator('body')).not.toContainText(/Fatal error|Страница не найдена/i);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Этап 1. Вкладка «Информация об участках» (/snt/units/)
  // ═══════════════════════════════════════════════════════════
  test.describe('1. Информация об участках', () => {
    const PATH = '/snt/units/';

    test('1.1 Отображение кнопок (+ Добавить участок, + Добавить группу, Скачать), колонок и таблицы', async ({ page }) => {
      await openGrid(page, PATH);
      await expect(page.getByRole('button', { name: '+ Добавить участок' })).toBeVisible();
      await expect(page.getByRole('link', { name: '+ Добавить группу' })).toBeVisible();
      await expect(page.locator('#pageMain a.btn__download', { hasText: 'Скачать' })).toBeVisible();
      await expect(page.locator('input[name="FIND"]')).toBeVisible();

      for (const col of UNITS_COLUMNS) {
        expect(await columnValues(page, col), `колонка «${col}»`).not.toBeNull();
        await expect(page.locator('label', { hasText: textRe(col) }).first()).toBeAttached();
      }

      expect(await gridRows(page).count()).toBeGreaterThan(0);
      const row6 = gridRow(page, UNIT_6.street).first();
      await expect(row6).toBeVisible();
      await expect(row6).toContainText(UNIT_6.ownerFio);
      await expect(row6).toContainText(UNIT_6.kdNumber);
      await expect(row6).toContainText(/\b(600|960)\b/);

      await expect(page.locator('.main-grid-panel-total')).toContainText(/Всего\s*:/i);
      await expect(page.locator('.main-ui-pagination')).toBeVisible();
    });

    test('1.2 Быстрый поиск в строке «Поиск и фильтрация» + сброс', async ({ page }) => {
      await openGrid(page, PATH);
      try {
        log(`Поиск по номеру участка «${UNIT_6.number}»`);
        await quickSearch(page, UNIT_6.number);
        await expect(gridRow(page, UNIT_6.street).first()).toBeVisible();
        await expect(gridRow(page, UNIT_6.ownerFio).first()).toBeVisible();

        log('Поиск по несуществующему значению → пустой список');
        await quickSearch(page, 'НетТакогоУчастка99999');
        await expect(gridRow(page, UNIT_6.street)).toHaveCount(0);
      } finally {
        await resetFilter(page);
      }
      await expect(gridRow(page, UNIT_6.street).first()).toBeVisible();
    });

    test('1.3 Все поля фильтра (Участок, Улица, Кадастровый номер, Площадь участка, Группа) → Найти → Сбросить', async ({ page }) => {
      await openGrid(page, PATH);
      // На lk/testdev площадь участка №6 = 960, а на release = 600 — берём фактическую площадь строки №6
      const row6Text = await gridRow(page, UNIT_6.street).first().innerText();
      const actualArea6 = (row6Text.match(/\b(600|960)\b/) || [])[1] || UNIT_6.area;
      try {
        const textFilters = [
          { name: 'SECTOR_NUMBER', value: UNIT_6.number, column: '№', expect: UNIT_6.number },
          { name: 'SECTOR_STREET', value: UNIT_6.street, column: 'Улица', expect: UNIT_6.street },
          { name: 'KD_NUMBER', value: UNIT_6.kdNumber, column: 'Кадастровый номер', expect: UNIT_6.kdNumber },
          { name: 'SECTOR_AREA_from', value: actualArea6, column: 'Площадь участка', expect: actualArea6 },
        ];
        for (const f of textFilters) {
          log(`Фильтр ${f.name} = «${f.value}»`);
          const popup = await openFilter(page);
          await popup.locator(`input[name="${f.name}"]`).fill(f.value);
          await filterApply(page, popup);
          const vals = await columnValues(page, f.column);
          expect(vals.length, `фильтр ${f.name} нашёл строки`).toBeGreaterThan(0);
          expect(vals.some((v) => v.includes(f.expect)), `в колонке «${f.column}» есть «${f.expect}»`).toBe(true);
          await resetFilter(page);
        }

        log(`Фильтр «Группа» = «${UNIT_6.group}»`);
        const popup = await openFilter(page);
        await filterSelect(page, 'Группа', UNIT_6.group);
        await filterApply(page, popup);
        const groups = await columnValues(page, 'Группа');
        expect(groups.length).toBeGreaterThan(0);
        for (const g of groups) expect(g).toContain(UNIT_6.group);
        await resetFilter(page);
      } finally {
        await resetFilter(page).catch(() => {});
      }
      await expect(gridRow(page, UNIT_6.street).first()).toBeVisible();
    });

    test('1.4 Кнопка «Скачать» — скачивание Excel-файла и проверка его содержимого', async ({ page }) => {
      await openGrid(page, PATH);
      const downloadBtn = page.locator('#pageMain a.btn__download', { hasText: 'Скачать' }).first();
      const { file, name } = await downloadByClick(page, downloadBtn);
      expect(name).toMatch(/\.xlsx$/i);
      expect(fs.statSync(file).size).toBeGreaterThan(0);
      const rows = readXlsx(file);
      log(`Строк в выгруженном реестре участков: ${rows.length}`);
      expect(rows.length).toBeGreaterThan(1);
      const flatText = rows.map((r) => r.join(' ')).join('\n');
      expect(flatText).toContain(UNIT_6.street);
      expect(flatText).toContain(UNIT_6.kdNumber);
    });

    test('1.5 Карточка участка №6: 7 вкладок + выгрузки «Excel» и «PDF»', async ({ page }) => {
      await openGrid(page, PATH);
      log('Ссылка номера участка в списке ведёт на карточку');
      const link = gridRow(page, UNIT_6.street).first().locator(`a[href="/snt/regions/${UNIT_6.id}/"]`).first();
      await expect(link).toBeVisible();
      const [card] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 10_000 }).catch(() => null),
        link.click(),
      ]);
      if (card) {
        await card.waitForLoadState('domcontentloaded');
        await expect(card.locator('#sites-street')).toHaveValue(UNIT_6.street);
        await card.close();
      }
      await open(page, `/snt/regions/${UNIT_6.id}/`);

      log('Проверяем поля на вкладке «Участок»');
      await expect(page.locator('#sites-number')).toHaveValue(UNIT_6.number);
      await expect(page.locator('#sites-street')).toHaveValue(UNIT_6.street);
      await expect(page.locator('#sites-square')).toHaveValue(/^(600|960)$/);
      await expect(page.locator('#sites-address')).toHaveValue(UNIT_6.kdNumber);

      log('Проверяем скачивание «Excel» и «PDF» в шапке карточки');
      await checkDownloadLink(page, page.locator('#pageMain a', { hasText: 'Excel' }).first());
      await checkDownloadLink(page, page.locator('#pageMain a', { hasText: 'PDF' }).first());

      const cardTabs = [
        { name: 'Участок', path: `/snt/regions/${UNIT_6.id}/` },
        { name: 'Люди', path: `/snt/regions/${UNIT_6.id}/people/` },
        { name: 'Электроэнергия', path: `/snt/regions/${UNIT_6.id}/energy/` },
        { name: 'Взносы', path: `/snt/regions/${UNIT_6.id}/fee/` },
        { name: 'История оплат', path: `/snt/regions/${UNIT_6.id}/debet/` },
        { name: 'Документы', path: `/snt/regions/${UNIT_6.id}/docs/` },
        { name: 'История оповещений', path: `/snt/regions/${UNIT_6.id}/send/` },
      ];
      for (const t of cardTabs) {
        log(`Вкладка карточки «${t.name}» (${t.path})`);
        await page.locator(`#pageMain a.tabs__link[href="${t.path}"]`).first().click();
        await page.waitForURL(`${BASE_URL}${t.path}`);
        await expect(page.locator('#pageMain')).toBeVisible();
        await expect(page.locator('body')).not.toContainText(/Fatal error|Страница не найдена/i);
        if (t.name === 'Люди') {
          await expect(page.locator('#pageMain')).toContainText(UNIT_6.ownerLastName);
        }
      }
    });

    test('1.6 Редактирование существующего участка №6 (Улица, Кадастровый номер, «Изменить площадь») → вернуть', async ({ page }) => {
      const newStreet = `${UNIT_6.street} Автотест`;
      const newKd = '77:659413:99';
      let origArea = UNIT_6.area;

      try {
        log('Открываем редактирование участка №6 (/snt/regions/197332/?edit=y)');
        await open(page, `/snt/regions/${UNIT_6.id}/?edit=y`);
        origArea = (await page.locator('#sites-square').inputValue().catch(() => '')) || UNIT_6.area;
        const newArea = String((Number(origArea) || 960) + 5);

        await page.locator('#sites-street').fill(newStreet);
        await page.locator('#sites-address').fill(newKd);
        await fillUnitCustomFields(page.locator('#pageMain'), 'Автотест карточка №6');
        await page.locator('#pageMain button.js-save-form, #pageMain button[type="submit"]').first().click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1200);

        await open(page, `/snt/regions/${UNIT_6.id}/`);
        await expect(page.locator('#sites-street')).toHaveValue(newStreet);
        await expect(page.locator('#sites-address')).toHaveValue(newKd);

        log('Меняем площадь участка №6 через «Изменить площадь»');
        await page.getByRole('button', { name: 'Изменить площадь' }).click();
        await changeUnitAreaInSlider(page, newArea);

        await open(page, `/snt/regions/${UNIT_6.id}/`);
        await expect(page.locator('#sites-square')).toHaveValue(newArea);
      } finally {
        log('Возвращаем исходные Улицу, Кадастровый номер и Площадь участка №6');
        await open(page, `/snt/regions/${UNIT_6.id}/?edit=y`);
        await page.locator('#sites-street').fill(UNIT_6.street);
        await page.locator('#sites-address').fill(UNIT_6.kdNumber);
        await fillUnitCustomFields(page.locator('#pageMain'), 'Автотест');
        await page.locator('#pageMain button.js-save-form, #pageMain button[type="submit"]').first().click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1200);

        await open(page, `/snt/regions/${UNIT_6.id}/`);
        if ((await page.locator('#sites-square').inputValue()) !== origArea) {
          await page.getByRole('button', { name: 'Изменить площадь' }).click();
          await changeUnitAreaInSlider(page, origArea);
        }

        // Форма ?edit=y сбрасывает привязку участка к группе — возвращаем участок №6 в группу «Улицы с растительностью»
        await openGrid(page, PATH);
        const r6 = gridRow(page, UNIT_6.street).first();
        if (!(await r6.innerText()).includes(UNIT_6.group)) {
          await selectGridRow(page, UNIT_6.street);
          await page.locator('#set-type_control').click();
          await page.locator('.menu-popup-item:visible', { hasText: 'Добавить в группу' }).first().click();
          await page.locator('#group_list_control').click();
          await page.locator('.menu-popup-item:visible', { hasText: UNIT_6.group }).first().click();
          await page.locator('#apply_button_control, #apply_button').first().click();
          await confirmYes(page);
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await page.waitForTimeout(1200);
        }
      }

      await open(page, `/snt/regions/${UNIT_6.id}/`);
      await expect(page.locator('#sites-street')).toHaveValue(UNIT_6.street);
      await expect(page.locator('#sites-address')).toHaveValue(UNIT_6.kdNumber);
      await expect(page.locator('#sites-square')).toHaveValue(origArea);
    });

    test('1.7 Валидация пустой формы «+ Добавить участок» и закрытие попапа', async ({ page }) => {
      await openGrid(page, PATH);
      await page.getByRole('button', { name: '+ Добавить участок' }).click();
      const popup = page.locator('#popupContainer');
      await expect(popup.locator('input[name="SECTOR_NUMBER"]')).toBeVisible();

      log('Пустая форма не отправляется (HTML5 required на № участка и Площади)');
      await popup.locator('button[type="submit"]', { hasText: 'Добавить участок' }).click();
      expect((await validity(popup.locator('input[name="SECTOR_NUMBER"]'))).valid).toBe(false);
      expect((await validity(popup.locator('input[name="SECTOR_AREA"]'))).valid).toBe(false);

      log('Закрытие попапа крестиком');
      await popup.locator('button.popup__close').click();
      await expect(page.locator('#popup')).not.toHaveClass(/active/);
    });

    test('1.8 Полный цикл тестового участка: создание → меню «☰» (Редактировать, Изменить площадь, Копировать) → групповые действия → удаление', async ({ page }) => {
      const s = stamp();
      const unitNumber = `${TEST_PREFIX}-${s}`;
      const copyNumber = `${unitNumber}-копия`;
      let unit = null;

      try {
        log('1) Создание тестового участка со всеми полями');
        unit = await createUnit(page, {
          number: unitNumber,
          area: '550',
          kdNumber: '50:01:000000:550',
          street: 'Автотестовая аллея',
          comment: 'Создан автотестом 1.8',
        });
        const row = gridRow(page, unit.number).first();
        await expect(row).toContainText(unit.street);
        await expect(row).toContainText(unit.kdNumber);
        await expect(row).toContainText(unit.area);

        log('2) Меню строки «☰»: проверяем все пункты и переходим в «Редактировать»');
        await row.locator('.main-grid-row-action-button').click();
        for (const item of ['Редактировать', 'Изменить площадь', 'Копировать участок', 'Удалить']) {
          await expect(page.locator('.menu-popup-item:visible', { hasText: item }).first()).toBeVisible();
        }
        await page.locator('.menu-popup-item:visible', { hasText: 'Редактировать' }).first().click();
        await page.waitForURL(new RegExp(`/snt/regions/${unit.id}/\\?edit=y`));
        unit.street = 'Автотестовая аллея (изм.)';
        unit.kdNumber = '50:01:000000:551';
        await page.locator('#sites-street').fill(unit.street);
        await page.locator('#sites-address').fill(unit.kdNumber);
        await fillUnitCustomFields(page.locator('#pageMain'), 'Отредактирован 1.8');
        await page.locator('#pageMain button.js-save-form, #pageMain button[type="submit"]').first().click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1200);

        log('3) Меню строки «☰» → «Изменить площадь»');
        await openGrid(page, PATH);
        await gridRowAction(page, unit.number, 'Изменить площадь');
        unit.area = '575';
        await changeUnitAreaInSlider(page, unit.area);
        await openGrid(page, PATH);
        await expect(gridRow(page, unit.number).first()).toContainText(unit.area);

        log('4) Меню строки «☰» → «Копировать участок» и удаление копии');
        await gridRowAction(page, unit.number, 'Копировать участок');
        await expect(page.locator('#copy-sector-area-input')).toBeVisible();
        await page.locator('#copy-sector-area-input').fill('610');
        await confirmYes(page);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(1500);
        await openGrid(page, PATH);
        await expect(gridRow(page, copyNumber).first()).toBeVisible({ timeout: 15_000 });
        await deleteUnitByNumber(page, copyNumber);

        log('5) Групповое действие «Редактировать» (инлайн в гриде)');
        await selectGridRow(page, unit.number);
        await page.locator('#set-type_control').click();
        for (const a of ['Редактировать', 'Добавить в группу', 'Удалить']) {
          await expect(page.locator('.menu-popup-item:visible', { hasText: a }).first()).toBeVisible();
        }
        await page.locator('.menu-popup-item:visible', { hasText: /^\s*Редактировать\s*$/ }).first().click();
        await page.locator('#edit_apply_button_control, #edit_apply_button').first().click();
        const streetInput = page.locator(`input[name="FIELDS[${unit.id}][SECTOR_STREET]"]`);
        await expect(streetInput, 'строка участка перешла в инлайн-редактирование').toBeVisible({ timeout: 15_000 });
        unit.street = 'Автотестовая инлайн-улица';
        await streetInput.fill(unit.street);
        await page.locator('.snt-units-save-cancel-bar button', { hasText: 'Сохранить' }).click();
        await expect(streetInput).toBeHidden({ timeout: 15_000 });
        await waitGrid(page);
        await expect(gridRow(page, unit.number).first()).toContainText(unit.street);

        log(`6) Групповое действие «Добавить в группу» → «${UNIT_6.group}»`);
        await selectGridRow(page, unit.number);
        await page.locator('#set-type_control').click();
        await page.locator('.menu-popup-item:visible', { hasText: 'Добавить в группу' }).first().click();
        await page.locator('#group_list_control').click();
        await page.locator('.menu-popup-item:visible', { hasText: UNIT_6.group }).first().click();
        await page.locator('#apply_button_control, #apply_button').first().click();
        await confirmYes(page);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(1200);
        await openGrid(page, PATH);
        await expect(gridRow(page, unit.number).first()).toContainText(UNIT_6.group);

        log('7) Групповое действие «Удалить»');
        await selectGridRow(page, unit.number);
        await page.locator('#set-type_control').click();
        await page.locator('.menu-popup-item:visible', { hasText: /^\s*Удалить\s*$/ }).first().click();
        await page.locator('#apply_button_control, #apply_button').first().click();
        await confirmYes(page);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(1200);
        await openGrid(page, PATH);
        await expect(gridRow(page, unit.number)).toHaveCount(0, { timeout: 15_000 });
        unit = null;
      } finally {
        await deleteUnitByNumber(page, copyNumber).catch(() => {});
        if (unit) await deleteUnitByNumber(page, unit.number).catch(() => {});
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Этап 2. Вкладка «Группы участков» (/snt/regions/group/)
  // ═══════════════════════════════════════════════════════════
  test.describe('2. Группы участков', () => {
    const PATH = '/snt/regions/group/';

    test('2.1 Отображение кнопки «Добавить новую группу», колонок, существующих групп и меню строки', async ({ page }) => {
      await open(page, PATH);
      await expect(page.locator('#pageMain a', { hasText: 'Добавить новую группу' })).toBeVisible();
      for (const col of GROUPS_COLUMNS) {
        expect(await columnValues(page, col), `колонка «${col}»`).not.toBeNull();
        await expect(page.locator('label', { hasText: textRe(col) }).first()).toBeAttached();
      }
      await expect(gridRow(page, 'Реальные email-ы').first()).toBeVisible();
      const row = gridRow(page, UNIT_6.group).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText(/№5|№6/);

      await row.locator('.main-grid-row-action-button').click();
      for (const item of ['Редактировать', 'Удалить']) {
        await expect(page.locator('.menu-popup-item:visible', { hasText: item }).first()).toBeVisible();
      }
      await page.keyboard.press('Escape');
    });

    test('2.2 Полный цикл: создание группы → добавление в неё участка → редактирование названия → удаление группы', async ({ page }) => {
      const s = stamp();
      let groupName = `${TEST_PREFIX} группа ${s}`;
      let testUnit = null;

      try {
        log('Валидация пустого названия группы на /snt/regions/group/add/');
        await open(page, '/snt/regions/group/add/');
        await page.locator('#group-add-form button[type="submit"]').click();
        expect((await validity(page.locator('#name'))).valid).toBe(false);

        log(`Создаём группу «${groupName}»`);
        await page.locator('#name').fill(groupName);
        await page.locator('#group-add-form button[type="submit"]').click();
        await page.waitForLoadState('domcontentloaded');
        await open(page, PATH);
        await expect(gridRow(page, groupName).first()).toBeVisible();

        log('Создаём тестовый участок и добавляем его в новую группу');
        testUnit = await createUnit(page, {
          number: `${TEST_PREFIX}-ГР-${s}`,
          area: '400',
          street: 'Групповая улица',
        });
        await selectGridRow(page, testUnit.number);
        await page.locator('#set-type_control').click();
        await page.locator('.menu-popup-item:visible', { hasText: 'Добавить в группу' }).first().click();
        await page.locator('#group_list_control').click();
        await page.locator('.menu-popup-item:visible', { hasText: groupName }).first().click();
        await page.locator('#apply_button_control, #apply_button').first().click();
        await confirmYes(page);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(1200);

        log('Проверяем, что участок отображается в колонке «Участки» у созданной группы');
        await open(page, PATH);
        const groupRow = gridRow(page, groupName).first();
        await expect(groupRow).toBeVisible();
        await expect(groupRow).toContainText(testUnit.number);

        log('Редактируем название группы через меню строки «Редактировать»');
        await gridRowAction(page, groupName, 'Редактировать');
        await page.waitForURL(/\/snt\/regions\/group\/add\/\?id=\d+/);
        await expect(page.locator('#name')).toHaveValue(groupName);
        const renamed = `${groupName} (изм.)`;
        await page.locator('#name').fill(renamed);
        await page.locator('#group-add-form button[type="submit"]').click();
        await page.waitForLoadState('domcontentloaded');
        groupName = renamed;

        await open(page, PATH);
        await expect(gridRow(page, groupName).first()).toBeVisible();
        await expect(gridRow(page, groupName).first()).toContainText(testUnit.number);
      } finally {
        log(`Удаляем тестовую группу «${groupName}» и тестовый участок`);
        await deleteUnitGroup(page, groupName).catch((e) => console.warn(`  ⚠ ${e.message}`));
        if (testUnit) await deleteUnitByNumber(page, testUnit.number).catch((e) => console.warn(`  ⚠ ${e.message}`));
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Этап 3. Вкладка «Настройка дополнительных полей» (/snt/units/fields/)
  // ═══════════════════════════════════════════════════════════
  test.describe('3. Настройка дополнительных полей', () => {
    const PATH = '/snt/units/fields/';

    test('3.1 Отображение кнопки «Добавить поле», колонок, существующих полей и меню строки', async ({ page }) => {
      await open(page, PATH);
      await expect(page.getByRole('button', { name: 'Добавить поле' })).toBeVisible();
      for (const col of FIELDS_COLUMNS) {
        expect(await columnValues(page, col), `колонка «${col}»`).not.toBeNull();
        await expect(page.locator('label', { hasText: textRe(col) }).first()).toBeAttached();
      }
      expect(await gridRows(page).count(), 'в таблице доп. полей есть строки').toBeGreaterThan(0);
      const row = gridRows(page).first();
      await expect(row).toBeVisible();
      await row.locator('.main-grid-row-action-button').click();
      for (const item of ['Редактировать', 'Удалить']) {
        await expect(page.locator('.menu-popup-item:visible', { hasText: item }).first()).toBeVisible();
      }
      await page.keyboard.press('Escape');
    });

    test('3.2 Связка «Участок + обязательное доп. поле»: создание поля → проверка в карточке тестового участка → сохранение → удаление обоих', async ({ page }) => {
      const s = stamp();
      const propName = `${TEST_PREFIX} поле ${s}`;
      let testUnit = null;
      let propCreated = false;

      try {
        testUnit = await createUnit(page, {
          number: `${TEST_PREFIX}-ДОП-${s}`,
          area: '450',
          street: 'Полевая улица',
        });

        log(`Создаём обязательное текстовое доп. поле «${propName}»`);
        await createUnitProperty(page, { name: propName, type: 'text', required: true, onlyPred: true });
        propCreated = true;

        log('Открываем карточку тестового участка в режиме редактирования');
        await open(page, `/snt/regions/${testUnit.id}/?edit=y`);
        const label = page.locator('#pageMain label', { hasText: propName }).first();
        await expect(label, `доп. поле «${propName}» появилось в карточке участка`).toBeVisible();
        const fieldInput = label.locator('xpath=following::textarea[1] | following::input[1]').first();

        log('Пустое обязательное доп. поле не даёт сохранить форму');
        await fillUnitCustomFields(page.locator('#pageMain'), 'Автотест');
        await fieldInput.fill('');
        await page.locator('#pageMain button.js-save-form, #pageMain button[type="submit"]').first().click();
        await page.waitForTimeout(500);
        const v = await validity(fieldInput);
        expect(v.valid, 'пустое обязательное доп. поле невалидно').toBe(false);

        log('Заполняем доп. поле и сохраняем карточку участка');
        const propValue = `Значение доп. поля ${s}`;
        await fieldInput.fill(propValue);
        await page.locator('#pageMain button.js-save-form, #pageMain button[type="submit"]').first().click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1200);

        await open(page, `/snt/regions/${testUnit.id}/?edit=y`);
        const savedInput = page.locator('#pageMain label', { hasText: propName }).first()
          .locator('xpath=following::textarea[1] | following::input[1]').first();
        await expect(savedInput).toHaveValue(propValue);
      } finally {
        if (propCreated) {
          log(`Удаляем доп. поле «${propName}»`);
          await deleteUnitProperty(page, propName).catch((e) => console.warn(`  ⚠ ${e.message}`));
        }
        if (testUnit) {
          await deleteUnitByNumber(page, testUnit.number).catch((e) => console.warn(`  ⚠ ${e.message}`));
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Этап 4. Вкладка «Импорт/экспорт участков» (/snt/units/import/)
  //         Порядок: сначала «Экспорт», затем «Импорт»
  // ═══════════════════════════════════════════════════════════
  test.describe('4. Импорт/экспорт участков', () => {
    const PATH = '/snt/units/import/';

    test('4.1 Сначала «Экспорт»: скачивание Excel и проверка заголовков + участка №6', async ({ page }) => {
      await cancelImportSessionOn(page, PATH);
      await page.locator('#tab-export').click();
      await expect(page.locator('#panel-export')).toBeVisible();
      await expect(page.locator('#btn-export')).toBeVisible();

      const { file, name } = await downloadByClick(page, page.locator('#btn-export'));
      expect(name).toMatch(/\.xlsx$/i);
      const rows = readXlsx(file);
      log(`Строк в экспорте участков: ${rows.length}`);
      expect(rows[0]).toEqual(expect.arrayContaining([
        'ID',
        'Номер участка',
        'Улица',
        'Кадастровый номер',
        'Площадь участка',
        'Группа',
      ]));
      const u6 = rows.find((r) => r[0] === UNIT_6.id);
      expect(u6, 'участок №6 (ID 197332) присутствует в выгрузке').toBeTruthy();
      expect(u6[1]).toBe(UNIT_6.number);
      expect(u6[2]).toBe(UNIT_6.street);
      expect(u6[3]).toBe(UNIT_6.kdNumber);
    });

    test('4.2 Затем «Импорт»: обновление Улицы участка №6 через CSV → проверка в карточке → возврат вторым импортом', async ({ page }) => {
      // На testdev/release есть поле «Цвет забора» (Один из многих, Обязательное=Да) с пустыми вариантами,
      // которое блокирует любой CSV-импорт на /snt/units/import/. Временно снимаем с него обязательность.
      let fenceReqChanged = false;
      try {
        fenceReqChanged = await setUnitPropertyRequired(page, 'Цвет забора', false);

        await cancelImportSessionOn(page, PATH);
        await page.locator('#tab-export').click();
        const { file } = await downloadByClick(page, page.locator('#btn-export'));
        const rows = readXlsx(file);
        const header = rows[0];
        const orig = rows.find((r) => r[0] === UNIT_6.id);
        expect(orig).toBeTruthy();

        const fillDefaults = (row) => {
          const copy = [...row];
          const setIfEmpty = (colName, defVal) => {
            const idx = header.indexOf(colName);
            if (idx >= 0 && !copy[idx]) copy[idx] = defVal;
          };
          setIfEmpty('Проверен', 'Да');
          setIfEmpty('Подключения к сети', 'Электроэнергия');
          setIfEmpty('Список параметров', 'Параметр 1');
          setIfEmpty('Комментарий', 'Автотест');
          return copy;
        };

        const iStreet = header.indexOf('Улица');
        const originalRow = fillDefaults(orig);
        originalRow[iStreet] = UNIT_6.street;
        const changedRow = fillDefaults(orig);
        changedRow[iStreet] = `${UNIT_6.street} Импорт`;

        try {
          log(`Импортируем изменённую улицу «${changedRow[iStreet]}»`);
          await runImportOn(page, PATH, '#units-import-file', writeCsv([header, changedRow], 'uimport'), {
            SECTOR_ID: UNIT_6.id,
            SECTOR_STREET: changedRow[iStreet],
          });
          await open(page, `/snt/regions/${UNIT_6.id}/`);
          await expect(page.locator('#sites-street')).toHaveValue(changedRow[iStreet]);
        } finally {
          log('Возвращаем исходную улицу вторым импортом');
          await runImportOn(page, PATH, '#units-import-file', writeCsv([header, originalRow], 'uimport-restore'), {
            SECTOR_ID: UNIT_6.id,
            SECTOR_STREET: UNIT_6.street,
          });
        }

        await open(page, `/snt/regions/${UNIT_6.id}/`);
        await expect(page.locator('#sites-street')).toHaveValue(UNIT_6.street);
      } finally {
        if (fenceReqChanged) {
          await setUnitPropertyRequired(page, 'Цвет забора', true).catch((e) => console.warn(`  ⚠ ${e.message}`));
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Этап 5. Вкладка «Комплексный импорт/экспорт» (/snt/units/combined/)
  //         Порядок: сначала «Экспорт», затем «Импорт»
  // ═══════════════════════════════════════════════════════════
  test.describe('5. Комплексный импорт/экспорт', () => {
    const PATH = '/snt/units/combined/';

    test('5.1 Сначала «Экспорт»: проверка всех чек-боксов выбора колонок и скачивание .xlsx', async ({ page }) => {
      await cancelImportSessionOn(page, PATH);
      await page.locator('#tab-export').click();
      await expect(page.locator('#panel-export')).toBeVisible();

      log('Проверяем чек-боксы выбора колонок на вкладке «Экспорт»');
      const colChecks = [
        'SECTOR_STREET', 'KD_NUMBER', 'SECTOR_AREA', 'GROUP_STR',
        'EMAIL', 'PHONE', 'LIVING_ADDRESS', 'POST_ADDRESS',
        'IS_MEMBER', 'VOTE_ACCESS', 'VOTE_ONLINE', 'VOTE_WEIGHT', 'OWNERS_SHARE',
      ];
      for (const val of colChecks) {
        const cb = page.locator(`.cimport-col-check[value="${val}"]`);
        await expect(cb).toBeVisible();
        await expect(cb).toBeChecked();
      }
      const firstCb = page.locator('.cimport-col-check[value="SECTOR_STREET"]');
      await firstCb.uncheck();
      await expect(firstCb).not.toBeChecked();
      await firstCb.check();
      await expect(firstCb).toBeChecked();

      log('Скачиваем комплексный Excel-файл и проверяем двухстрочную шапку и участок №6');
      const { file, name } = await downloadByClick(page, page.locator('#btn-export'));
      expect(name).toMatch(/\.xlsx$/i);
      const rows = readXlsx(file);
      expect(rows[0]).toEqual(expect.arrayContaining(['Информация об участке', 'Информация о собственнике']));
      expect(rows[1]).toEqual(expect.arrayContaining([
        'ID участка', 'Номер участка', 'Улица', 'ID собственника', 'Фамилия', 'Имя', 'Отчество', 'Email',
      ]));
      const ownerIdIdx = rows[1].indexOf('ID собственника');
      expect(ownerIdIdx).toBeGreaterThan(0);
      const u6Row = rows.find((r) => r[0] === UNIT_6.id && r[ownerIdIdx] === UNIT_6.ownerId);
      expect(u6Row, 'строка участка №6 + Соснов Е.П. есть в выгрузке').toBeTruthy();
    });

    test('5.2 Затем «Импорт»: комплексное обновление участка №6 и собственника Соснова через CSV → проверка → возврат', async ({ page }) => {
      const groupRow = ['Информация об участке', '', '', 'Информация о собственнике', '', '', '', ''];
      const colRow = ['ID участка', 'Номер участка', 'Улица', 'ID собственника', 'Фамилия', 'Имя', 'Отчество', 'Email'];
      const changedStreet = `${UNIT_6.street} КомплИмпорт`;
      const changedSecond = `${UNIT_6.ownerSecondName}Компл`;

      const changedData = [
        UNIT_6.id, UNIT_6.number, changedStreet,
        UNIT_6.ownerId, UNIT_6.ownerLastName, UNIT_6.ownerName, changedSecond, UNIT_6.ownerEmail,
      ];
      const originalData = [
        UNIT_6.id, UNIT_6.number, UNIT_6.street,
        UNIT_6.ownerId, UNIT_6.ownerLastName, UNIT_6.ownerName, UNIT_6.ownerSecondName, UNIT_6.ownerEmail,
      ];

      try {
        log('Комплексный импорт изменённой Улицы участка №6 и Отчества Соснова');
        await runImportOn(page, PATH, '#cimport-file', writeCsv([groupRow, colRow, changedData], 'cimport'), {
          SECTOR_ID: UNIT_6.id,
          SECTOR_STREET: changedStreet,
          USER_ID: UNIT_6.ownerId,
          SECOND_NAME: changedSecond,
        });

        await open(page, `/snt/regions/${UNIT_6.id}/`);
        await expect(page.locator('#sites-street')).toHaveValue(changedStreet);
        await open(page, `/snt/people/detail/?id=${UNIT_6.ownerId}`);
        await expect(page.locator('input[name="SECOND_NAME"]')).toHaveValue(changedSecond);
      } finally {
        log('Возвращаем исходные данные участка №6 и Соснова вторым комплексным импортом');
        await runImportOn(page, PATH, '#cimport-file', writeCsv([groupRow, colRow, originalData], 'cimport-restore'), {
          SECTOR_ID: UNIT_6.id,
          SECTOR_STREET: UNIT_6.street,
          USER_ID: UNIT_6.ownerId,
          SECOND_NAME: UNIT_6.ownerSecondName,
        });
      }

      await open(page, `/snt/regions/${UNIT_6.id}/`);
      await expect(page.locator('#sites-street')).toHaveValue(UNIT_6.street);
      await open(page, `/snt/people/detail/?id=${UNIT_6.ownerId}`);
      await expect(page.locator('input[name="SECOND_NAME"]')).toHaveValue(UNIT_6.ownerSecondName);
    });
  });
});
