// ============================================================
// Смоук-тест: раздел «Бухгалтерия» (4 подраздела) на testdev.sntclub.ru (ЛК Председателя)
//   1. Взносы собственников (/snt/bookkeeping/fees/)
//   2. Электроэнергия (/snt/bookkeeping/energy/)
//   3. Водопотребление (/snt/bookkeeping/water/)
//   4. Деньги (/snt/bookkeeping/money/)
//
// Тестовый фреймворк: Playwright Test (@playwright/test)
//
// Архитектура (по образцу people.spec.js и energy-tariffs.spec.js):
//  0. Навигация по всем 4 подразделам Бухгалтерии СНТ
//  1. Подраздел «Взносы собственников» (/snt/bookkeeping/fees/):
//     - Отображение кнопок («Экспорт в Excel», наличие «Отправить всем напоминание» без клика),
//       всех 11 колонок, таблицы, чек-боксов и пагинации
//     - Переход по ссылке участка (в новой вкладке target="_blank")
//     - Быстрый поиск и фильтрация (Участок, Улица, Взнос, Вид взноса, Тип взноса → Найти → Сбросить)
//     - Скачивание «Экспорт в Excel» (.xlsx)
//     - Меню строки «☰»: все 6 пунктов, переходы «Оплатить» (без совершения оплаты!) и «Создать претензию»,
//       «Скачать квитанцию», «Отправить напоминание»
//     - Групповые действия: «Скачать квитанцию» (.zip) и «Отправить напоминание»
//     - Модальное окно «Добавить движение денежных средств»: валидация пустой формы +
//       Пополнение 1 руб. и возврат Списанием 1 руб.
//     - Удаление 1 взноса на участке №1 (строго один раз за тест)
//  2. Подраздел «Электроэнергия» (/snt/bookkeeping/energy/):
//     - Отображение кнопок («Экспорт в Excel», наличие «Отправить всем напоминание» без клика),
//       всех 14 колонок, таблицы, чек-боксов
//     - Ссылки в карточку собственника и карточку счётчика участка
//     - Быстрый поиск, фильтрация (Статус, Участок, Улица, Тариф → Найти → Сбросить), «Экспорт в Excel»
//     - Меню строки «☰» («Квитанция на оплату», «Отправить напоминание», «Добавить движение денежных средств»)
//     - Групповые действия («Скачать квитанцию» .zip, «Отправить напоминание»)
//     - Валидация пустой формы ДДС + Пополнение 1 руб. и возврат Списанием 1 руб.
//  3. Подраздел «Водопотребление» (/snt/bookkeeping/water/):
//     - Отображение кнопок («Экспорт в Excel», наличие «Отправить всем напоминание» без клика),
//       всех 13 колонок, таблицы, чек-боксов
//     - Ссылки в карточку участка и карточку собственника
//     - Быстрый поиск, фильтрация (Статус, Участок, Улица, Счетчик → Найти → Сбросить), «Экспорт в Excel»
//     - Меню строки «☰» («Квитанция на оплату», «Отправить напоминание», ДДС валидация + 1/-1 руб.)
//     - Полный цикл «Календарь событий» (через меню строки и групповым действием)
//  4. Подраздел «Деньги» (/snt/bookkeeping/money/):
//     - Отображение кнопки «Экспорт в Excel», всех 10 колонок, таблицы, пагинации
//     - Проверка отображения в реестре «Деньги» операций ДДС, созданных в предыдущих вкладках
//     - Переход по ссылке участка, быстрый поиск, фильтрация (Участок, Вид, Тип операции, Источник операции),
//       скачивание «Экспорт в Excel»
//
// Авторизация выполняется ОДИН раз на воркер (storageState).
// Каждая проверка обёрнута в softStep(), чтобы при падении одной проверки
// автотест продолжал тестировать дальше и не останавливался.
// Все изменения баланса и статусов откатываются в блоках finally.
//
// Запуск:
//   ./run-bookkeeping-all-money-testdev.sh
//   npx playwright test bookkeeping-all-money-testdev.spec.js --workers=1 --headed
// ============================================================

const { test: base, expect } = require('@playwright/test');
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

/** 4 тестируемых подраздела Бухгалтерии СНТ */
const TABS = [
  { name: 'Взносы собственников', path: '/snt/bookkeeping/fees/' },
  { name: 'Электроэнергия', path: '/snt/bookkeeping/energy/' },
  { name: 'Водопотребление', path: '/snt/bookkeeping/water/' },
  { name: 'Деньги', path: '/snt/bookkeeping/money/' },
];

/** Колонки таблицы в подразделе «Взносы собственников» */
const FEES_COLUMNS = [
  'Участок',
  'Улица',
  'Собственники',
  'Срок оплаты взноса',
  'Начислено',
  'Задолженность',
  'Взнос',
  'Вид взноса',
  'Сумма',
  'Тип взноса',
  'Площадь',
];

/** Колонки таблицы в подразделе «Электроэнергия» */
const ENERGY_COLUMNS = [
  'Участок',
  'Улица',
  'Собственники',
  'Тариф',
  'Марка счётчика',
  'Серийный номер',
  'Номер пломбы',
  'Начислено',
  'Баланс',
  'Задолженность',
  'Дата последних показаний',
  'Предыдущие показания',
  'Последние показания',
  'Статус',
];

/** Колонки таблицы в подразделе «Водопотребление» */
const WATER_COLUMNS = [
  'Участок',
  'Улица',
  'Собственники',
  'Счетчик',
  'Начислено',
  'Баланс',
  'Задолженность',
  'Статус',
  'Дата последних показаний',
  'Предыдущие показания',
  'Последние показания',
  'Следующая дата поверки',
  'В календаре',
];

/** Колонки таблицы в подразделе «Деньги» */
const MONEY_COLUMNS = [
  'Вид',
  'Сущность',
  'Тип операции',
  'Источник операции',
  'Дата',
  'Собственник / Контрагент',
  '№ Участка',
  'Улица',
  'Сумма',
  'Назначение платежа',
];

/** Тестовая строка взноса с задолженностью на участке №1 для проверки меню, квитанций и ДДС */
const FEE_DEBT_ROW = {
  id: '1187396',
  sectorId: '197328',
  unitNumber: '1',
  street: 'Зеленая площадь',
  owner: 'Глебов Евгений Николаевич',
  title: 'Платеж за кв. м с НДС за апрель 2026',
  contributionType: 'Целевой',
  feeType: 'За кв.м.',
};

/** Тестовый счётчик электроэнергии с задолженностью (участок №2) */
const ENERGY_DEBT_ROW = {
  id: '39711',
  sectorId: '253527',
  unitNumber: '2',
  street: 'Кленовый проезд',
  owner: 'Ершов Евгений Станиславович',
  tariff: 'Социальный баланс',
  brand: 'Электрон',
  serial: 'Seria-210002',
  plomb: 'Plomb-46002',
};

/** Тестовый счётчик водопотребления с задолженностью (участок №10) */
const WATER_DEBT_ROW = {
  id: '4092',
  sectorId: '262052',
  unitNumber: '10',
  street: 'Дубовый проезд',
  owner: 'Хайруллин Айдар Рафикович',
  counterLabel: 'Agua / PL0MB-I0',
  brand: 'Agua',
  plomb: 'PL0MB-I0',
};

/** Флаг: гарантирует, что удаление взноса на участке №1 выполняется строго ОДИН раз за весь тест */
let unit1FeeDeletedOnce = false;

/** Комментарий последней проведённой операции Пополнения ДДС для проверки её появления во вкладке «Деньги» */
let lastDdsAddComment = '';

/** Файл с cookies авторизованной сессии (общий для всех тестов воркера) */
const AUTH_FILE = path.join(os.tmpdir(), 'sntclub-bookkeeping-all-money-testdev-auth.json');

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

// Компактные тайм-ауты и Basic Auth для тестового стенда
test.use({
  httpCredentials: { ...BASIC_AUTH, origin: BASE_URL },
  actionTimeout: 10_000,
  navigationTimeout: 20_000,
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

/**
 * Выполняет шаг проверки мягко: если внутри шага возникла ошибка,
 * фиксирует её через expect.soft (чтобы тест в итоге сообщил о проблеме),
 * закрывает возможные открытые попапы и продолжает выполнение следующих шагов.
 */
async function softStep(page, title, fn) {
  try {
    await fn();
  } catch (err) {
    log(`⚠ Ошибка в шаге «${title}»: ${err.message || err}`);
    expect.soft(err, `Шаг «${title}» завершился с ошибкой`).toBeNull();
    await closeAnyPopups(page).catch(() => {});
  }
}

/** Закрыть любые оставшиеся открытые модальные окна / попапы Bitrix */
async function closeAnyPopups(page) {
  await page.keyboard.press('Escape').catch(() => {});
  const closeBtns = page.locator(
    '#confirmBox.active #btnNo, .popup__dialog.active #btnNo, ' +
    '.popup-window:visible .popup-window-close-icon, ' +
    '.popup-window:visible .popup-window-button:has-text("Отмена"), ' +
    '.popup-window:visible .popup-window-button:has-text("Закрыть"), ' +
    '.popup-window:visible .ui-btn:has-text("Отмена"), ' +
    '.popup-window:visible .ui-btn:has-text("Закрыть")'
  );
  const count = await closeBtns.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    if (await closeBtns.nth(i).isVisible().catch(() => false)) {
      await closeBtns.nth(i).click({ force: true }).catch(() => {});
    }
  }
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
        await page.waitForTimeout(800);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
      } else {
        throw e;
      }
    }
  }
  await page.locator('#pageMain, #login-btn').first().waitFor({ timeout: 20_000 }).catch(() => {});
  if (await page.locator('#login-btn').isVisible().catch(() => false)) {
    log('Сессия истекла — повторный вход');
    await login(page);
    await page.context().storageState({ path: AUTH_FILE });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
  await expect(page.locator('#pageMain')).toBeVisible();
}

/** Открыть страницу с гридом и очистить активные плашки фильтра/поиска, если они остались */
async function openGrid(page, p) {
  await open(page, p);
  const find = page.locator('input[name="FIND"]');
  if ((await find.count()) === 0) return;
  const searchText = await find.inputValue().catch(() => '');
  const squares = await page.locator('.main-ui-filter-search .main-ui-square:visible').count();
  if (searchText || squares) {
    log(`Остался фильтр («${searchText}», плашек: ${squares}) — очищаем`);
    await resetFilter(page);
  }
}

/**
 * Убедиться, что все ожидаемые колонки грида включены в настройках таблицы Bitrix (шестерёнка).
 * Если какая-либо колонка была скрыта в настройках грида на стенде — включает «Выбрать все» и применяет.
 */
async function ensureAllColumnsVisible(page, expectedColumns) {
  const missing = await page.evaluate((cols) => {
    const heads = new Set(
      [...document.querySelectorAll('tr.main-grid-row-head th')]
        .map((th) => th.innerText.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    );
    return cols.filter((c) => !heads.has(c));
  }, expectedColumns);

  if (missing.length > 0) {
    log(`Включаем скрытые колонки в настройках таблицы: ${missing.join(', ')}`);
    await page.locator('.main-grid-interface-settings-icon').first().click();
    const selectAll = page.locator('.main-grid-settings-window-select-all').first();
    await expect(selectAll).toBeVisible();
    await selectAll.click();
    const applyBtn = page.locator('.main-grid-settings-window-actions-item-button.ui-btn-success, .popup-window-button-accept').first();
    await gridReload(page, () => applyBtn.click());
  }
}

/** Видимые строки грида Bitrix (без служебного шаблона template_0 и строки пустого результата) */
function gridRows(page) {
  return page.locator('tr.main-grid-row-body[data-id]:not([data-id="template_0"]):not(.main-grid-not-count):not([hidden])');
}

/** Строка грида Bitrix по data-id */
function gridRowById(page, id) {
  return page.locator(`tr.main-grid-row-body[data-id="${id}"]:not([hidden])`).first();
}

/** Строка грида Bitrix по тексту */
function gridRow(page, text) {
  return gridRows(page).filter({ hasText: text });
}

async function waitGrid(page) {
  await page.waitForTimeout(200);
}

async function gridReload(page, action) {
  await Promise.all([
    page.waitForResponse((r) => /grid_id=|internal=true/.test(r.url()) && r.request().method() === 'POST', { timeout: 12_000 })
      .catch(() => log('  (ответ грида не дождались)')),
    action(),
  ]);
  await waitGrid(page);
}

/** Значения колонки грида по названию заголовка */
async function columnValues(page, header) {
  return page.evaluate((header) => {
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const table = document.querySelector('table.main-grid-table');
    if (!table) return null;
    const heads = [...table.querySelectorAll('tr.main-grid-row-head th')];
    const idx = heads.findIndex((th) => th.innerText.replace(/\s+/g, ' ').trim() === header);
    if (idx < 0) return null;
    return [...table.querySelectorAll('tr.main-grid-row-body[data-id]:not([data-id="template_0"]):not(.main-grid-not-count)')]
      .filter(vis)
      .map((tr) => (tr.children[idx]?.innerText || '').replace(/\s+/g, ' ').trim());
  }, header);
}

/** Получить значение конкретной ячейки строки по названию колонки */
async function rowCellText(page, rowId, header) {
  return page.evaluate(({ rowId, header }) => {
    const tr = document.querySelector(`tr.main-grid-row-body[data-id="${rowId}"]`);
    if (!tr) return null;
    const table = tr.closest('table');
    const heads = [...table.querySelectorAll('tr.main-grid-row-head th')];
    const idx = heads.findIndex((th) => th.innerText.replace(/\s+/g, ' ').trim() === header);
    if (idx < 0) return null;
    return (tr.children[idx]?.innerText || '').replace(/\s+/g, ' ').trim();
  }, { rowId, header });
}

/** Распарсить сумму вида "9 937.44 руб." в число */
function parseMoney(str) {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[^\d.-]/g, '')) || 0;
}

/**
 * Проверить ссылку из ячейки таблицы (с учётом target="_blank"):
 * проверяет видимость, атрибут href и открывает ссылку в новой вкладке, закрывая её после проверки URL,
 * чтобы не перезагружать основную страницу с таблицей.
 */
async function verifyTableLink(page, linkLocator, expectedUrlRegex) {
  await linkLocator.scrollIntoViewIfNeeded().catch(() => {});
  await expect(linkLocator).toBeVisible();
  const href = await linkLocator.getAttribute('href');
  expect(href).toMatch(expectedUrlRegex);
  const target = await linkLocator.getAttribute('target');

  if (target === '_blank') {
    const popupPromise = page.context().waitForEvent('page', { timeout: 3_000 }).catch(() => null);
    await linkLocator.click({ force: true }).catch(() => {});
    let popup = await popupPromise;
    if (!popup) {
      popup = await page.context().newPage();
      await popup.goto(new URL(href, BASE_URL).toString(), { waitUntil: 'domcontentloaded' });
    } else {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
    }
    await expect(popup).toHaveURL(expectedUrlRegex);
    await popup.close().catch(() => {});
  } else {
    const prevUrl = page.url();
    await linkLocator.click();
    await expect(page).toHaveURL(expectedUrlRegex);
    await page.goto(prevUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#pageMain')).toBeVisible();
  }
  return href;
}

/** Открыть меню «☰» строки по data-id и вернуть список пунктов */
async function openRowMenuById(page, rowId) {
  await closeAnyPopups(page).catch(() => {});
  const row = gridRowById(page, rowId);
  await expect(row).toBeVisible();
  await row.locator('.main-grid-row-action-button').click();
  const items = page.locator('.menu-popup-item:visible');
  await expect(items.first()).toBeVisible({ timeout: 5_000 });
  return items;
}

/** Открыть меню «☰» строки по data-id и нажать на пункт по тексту */
async function clickRowMenuById(page, rowId, itemText) {
  await openRowMenuById(page, rowId);
  const item = page.locator('.menu-popup-item:visible', { hasText: itemText }).first();
  await expect(item).toBeVisible();
  await item.click();
}

/** Очистить плашки и поля внутри BX.Main.filterManager без перезагрузки грида */
async function clearFilterControlsInDom(page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const fms = window.BX && BX.Main && BX.Main.filterManager && BX.Main.filterManager.data
      ? Object.values(BX.Main.filterManager.data)
      : [];
    if (fms.length) {
      const fm = fms[0];
      if (fm.getPreset && fm.getPreset().deactivateAllPresets) fm.getPreset().deactivateAllPresets();
      if (fm.getPreset && fm.getPreset().resetPreset) fm.getPreset().resetPreset(true);
      if (fm.clearControls) fm.clearControls();
      if (fm.getSearch && fm.getSearch().clearForm) fm.getSearch().clearForm();
      if (fm.getSearch && fm.getSearch().removeSquares) fm.getSearch().removeSquares();
    }
    document.querySelectorAll('.main-ui-filter-search .main-ui-square-delete').forEach((btn) => {
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      btn.click();
    });
  });
}

/** Быстрый поиск в строке «Поиск и фильтрация» */
async function quickSearch(page, text) {
  await closeAnyPopups(page).catch(() => {});
  await clearFilterControlsInDom(page);
  const find = page.locator('input[name="FIND"]');
  await find.fill(text);
  await gridReload(page, () => find.press('Enter'));
}

/** Открыть всплывающее окно фильтра Bitrix (защищено от перекрытия шапкой #topNotify) */
async function openFilter(page) {
  await closeAnyPopups(page).catch(() => {});
  await clearFilterControlsInDom(page);
  const fields = page.locator('.main-ui-control-field:visible, .main-ui-control-field-group:visible');
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(250);
    if (await fields.first().isVisible().catch(() => false)) break;
    await page.locator('input[name="FIND"]').click({ force: true });
    if (await fields.first().isVisible({ timeout: 2_500 }).catch(() => false)) break;
  }
  await expect(fields.first()).toBeVisible();
  const popup = page.locator('.main-ui-filter-wrapper:visible, .main-ui-popup:visible').last();
  // Очищаем возможные предзаполненные значения полей внутри попапа
  await popup.evaluate((el) => {
    el.querySelectorAll('.main-ui-control-value-delete').forEach((btn) => {
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      btn.click();
    });
    el.querySelectorAll('input[type="text"], input:not([type])').forEach((inp) => {
      if (inp.name && inp.value) {
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }).catch(() => {});
  await expect(popup.getByText('Найти', { exact: true })).toBeVisible();
  return popup;
}

/**
 * Быстрый и надёжный сброс фильтра Bitrix через BX.Main.filterManager:
 * гарантированно удаляет все сохранённые на стенде пресеты/плашки (.main-ui-square),
 * очищает все контролы и строку поиска FIND и перезагружает грид.
 */
async function resetFilter(page) {
  await closeAnyPopups(page).catch(() => {});
  await gridReload(page, () => page.evaluate(() => {
    window.scrollTo(0, 0);
    const fms = window.BX && BX.Main && BX.Main.filterManager && BX.Main.filterManager.data
      ? Object.values(BX.Main.filterManager.data)
      : [];
    if (fms.length) {
      const fm = fms[0];
      fm.showPopup();
      if (fm.getPreset && fm.getPreset().deactivateAllPresets) fm.getPreset().deactivateAllPresets();
      if (fm.getPreset && fm.getPreset().resetPreset) fm.getPreset().resetPreset(true);
      if (fm.clearControls) fm.clearControls();
      if (fm.getSearch && fm.getSearch().clearForm) fm.getSearch().clearForm();
      if (fm.getSearch && fm.getSearch().removeSquares) fm.getSearch().removeSquares();
      const popup = fm.getPopup ? fm.getPopup().contentContainer : null;
      if (popup) {
        popup.querySelectorAll('.main-ui-control-value-delete').forEach((btn) => {
          btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          btn.click();
        });
        popup.querySelectorAll('input').forEach((inp) => {
          if (inp.value) {
            inp.value = '';
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      }
      fm.applyFilter(false, false);
      fm.closePopup();
    } else {
      const find = document.querySelector('input[name="FIND"]');
      if (find) {
        find.value = '';
        find.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
    }
  }));
  if (await page.locator('.main-ui-control-field:visible').first().isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
  }
}

/** Выбрать значение в выпадающем списке фильтра Bitrix по data-name или заголовку поля */
async function filterSelect(page, popup, fieldNameOrLabel, optionText) {
  const byName = popup.locator(`.main-ui-control-field[data-name="${fieldNameOrLabel}"], .main-ui-control-field-group[data-name="${fieldNameOrLabel}"]`).first();
  const field = (await byName.count()) > 0
    ? byName
    : popup.locator(`.main-ui-control-field[title="${fieldNameOrLabel}"], .main-ui-control-field:has(.main-ui-control-field-label:text-is("${fieldNameOrLabel}"))`).first();
  await field.locator('.main-ui-select').click();
  await page.locator('.main-ui-select-inner-item:visible, .popup-window:visible .main-ui-select-inner-item')
    .filter({ hasText: new RegExp(`^\\s*${optionText}\\s*$`) }).first().click();
}

/** Выделить чек-бокс строки грида по data-id */
async function selectGridRowById(page, rowId) {
  await closeAnyPopups(page).catch(() => {});
  const row = gridRowById(page, rowId);
  await expect(row).toBeVisible();
  const cb = row.locator('input[type="checkbox"]');
  await expect(cb).toBeEnabled();

  const isRowChecked = await row.evaluate((tr) => tr.classList.contains('main-grid-row-checked'));
  if (!isRowChecked) {
    await cb.evaluate((el) => { el.checked = false; });
    await cb.click({ force: true });
  }
  await expect(row).toHaveClass(/main-grid-row-checked/);
}

/** Выбрать групповое действие в панели под таблицей и нажать «Применить» */
async function applyGroupAction(page, dropdownId, actionName) {
  const panel = page.locator('.main-grid-action-panel, .main-grid-control-panel-wrap').first();
  await expect(panel).toBeVisible();
  await page.locator(`#${dropdownId}`).click();
  const item = page.locator('.menu-popup-item:visible', { hasText: actionName }).first();
  await expect(item).toBeVisible();
  await item.click();
  const applyBtn = page.locator('#apply_button');
  await expect(applyBtn).toBeVisible();
  await applyBtn.click();
}

/** Скачать файл по клику и проверить, что он не пустой */
async function verifyDownload(page, triggerAction, expectedExt = /\.xlsx$|\.zip$/i) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    triggerAction(),
  ]);
  const filename = download.suggestedFilename();
  expect(filename).toMatch(expectedExt);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const size = fs.statSync(filePath).size;
  expect(size, `файл «${filename}» не должен быть пустым`).toBeGreaterThan(100);
  log(`✓ Скачан файл «${filename}» (${size} байт)`);
  return { filename, size };
}

/**
 * Проверить формирование одиночной квитанции из меню строки («Скачать квитанцию» / «Квитанция на оплату»).
 */
async function verifySingleReceipt(page, rowId, menuText) {
  const popupPromise = page.context().waitForEvent('page', { timeout: 3_000 }).catch(() => null);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/local/ajax/bill/index.php') && r.request().method() === 'POST', { timeout: 15_000 }),
    clickRowMenuById(page, rowId, menuText),
  ]);
  expect(resp.status()).toBe(200);
  const body = (await resp.text()).trim();
  expect(body.length, 'ответ генерации квитанции должен содержать токен').toBeGreaterThan(10);
  const popupPage = await popupPromise;
  if (popupPage) await popupPage.close().catch(() => {});
  await closeAnyPopups(page).catch(() => {});
  log(`✓ Сформирована квитанция для строки id=${rowId} (токен: ${body.slice(0, 18)}...)`);
}

/**
 * Проверить отправку напоминания по одной строке из меню «☰ → Отправить напоминание»
 */
async function verifySingleRowNotification(page, rowId) {
  const [testResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('testNotify') && r.request().method() === 'POST', { timeout: 15_000 }),
    clickRowMenuById(page, rowId, 'Отправить напоминание'),
  ]);
  expect(testResp.status()).toBe(200);

  const modal = page.locator('.popup-window:visible').filter({ hasText: /Отправка уведомления|Уведомление/i }).last();
  await expect(modal).toBeVisible({ timeout: 8_000 });

  const okBtn = modal.locator('.popup-window-button, .ui-btn').filter({ hasText: /^OK$|^ОК$/i }).first();
  if (await okBtn.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('sendNotification') && r.request().method() === 'POST', { timeout: 15_000 }).catch(() => {}),
      okBtn.click(),
    ]);
    const resultModal = page.locator('.popup-window:visible').filter({ hasText: /Уведомление/i }).last();
    if (await resultModal.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await resultModal.locator('.popup-window-button, .ui-btn').filter({ hasText: /OK|ОК|Закрыть/i }).first().click();
    }
  } else {
    await modal.locator('.popup-window-button, .ui-btn').filter({ hasText: /Закрыть|Отмена/i }).first().click();
  }
  await closeAnyPopups(page).catch(() => {});
  log(`✓ Проверена отправка напоминания из меню строки (id=${rowId})`);
}

/**
 * Проверить групповую отправку напоминаний («Отправить напоминание» → «Применить») для одной выделенной строки
 */
async function verifyGroupNotification(page, rowId) {
  await selectGridRowById(page, rowId);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('testNotifyIds') && r.request().method() === 'POST', { timeout: 15_000 }),
    applyGroupAction(page, 'set-type_control', 'Отправить напоминание'),
  ]);
  const modal = page.locator('.popup-window:visible').filter({ hasText: /Уведомление/i }).last();
  await expect(modal).toBeVisible({ timeout: 8_000 });
  const okBtn = modal.locator('.popup-window-button, .ui-btn').filter({ hasText: /^OK$|^ОК$/i }).first();
  if (await okBtn.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('sendNotification') && r.request().method() === 'POST', { timeout: 15_000 }).catch(() => {}),
      okBtn.click(),
    ]);
    const doneBtn = page.locator('#confirmBox.active #btnYes, .popup__dialog.active #btnYes, .popup-window:visible .popup-window-button, .popup-window:visible .ui-btn')
      .filter({ hasText: /Закрыть|OK|ОК/i }).first();
    if (await doneBtn.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await doneBtn.click();
    }
  }
  await closeAnyPopups(page).catch(() => {});
  log(`✓ Проверена групповая отправка напоминания для строки id=${rowId}`);
}

/**
 * Проверить групповое скачивание квитанций («Скачать квитанцию» → «Применить» → «Скачать архив»)
 */
async function verifyGroupReceiptArchive(page, rowId) {
  await selectGridRowById(page, rowId);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/local/ajax/bill/archive.php') && r.request().method() === 'POST', { timeout: 20_000 }),
    applyGroupAction(page, 'set-type_control', 'Скачать квитанцию'),
  ]);
  const archModal = page.locator('.popup-window:visible', { hasText: 'Квитанции' }).last();
  await expect(archModal).toBeVisible({ timeout: 10_000 });
  await expect(archModal).toContainText(/Архив из квитанций/i);

  await verifyDownload(
    page,
    () => archModal.locator('.popup-window-button, .ui-btn').filter({ hasText: 'Скачать архив' }).click(),
    /\.zip$/i
  );
  // Закрываем модальное окно архива, чтобы оно не перекрывало таблицу на следующих шагах
  await closeAnyPopups(page).catch(() => {});
  log(`✓ Групповое скачивание архива квитанций (.zip) проверено для строки id=${rowId}`);
}

/**
 * Заполнить и отправить модальное окно «Изменение баланса» (Движение денежных средств)
 */
async function submitChangeBalanceDialog(page, dialog, { price, type, dateStr, comment }) {
  await dialog.locator('[data-field="price"] input').fill(String(price));
  await dialog.locator('select').first().selectOption(type);
  await dialog.locator('input[data-type="custom-date"]').evaluate((el, val) => {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, dateStr);
  await dialog.locator('[data-field="comment"] textarea').fill(comment);

  await Promise.all([
    page.waitForResponse((r) => r.url().includes('changeBalance') && r.request().method() === 'POST', { timeout: 15_000 }),
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {}),
    dialog.locator('.popup-window-button, .ui-btn').filter({ hasText: 'Изменить' }).click(),
  ]);
  await expect(page.locator('#pageMain')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(250);
}

// ════════════════════════════════════════════════════════════
// ТЕСТОВЫЙ НАБОР
// ════════════════════════════════════════════════════════════
test.describe('ЛК Председателя — Бухгалтерия (Взносы, Электроэнергия, Водопотребление, Деньги)', () => {
  test.setTimeout(180_000);

  // ════════════════════════════════════════════════════════════
  // 0. Навигация по всем 4 подразделам Бухгалтерии
  // ════════════════════════════════════════════════════════════
  test('0. Навигация по 4 подразделам Бухгалтерии СНТ', async ({ page }) => {
    for (const tab of TABS) {
      await softStep(page, `Переход в подраздел «${tab.name}»`, async () => {
        await open(page, tab.path);
        await expect(page).toHaveURL(new RegExp(tab.path.replace(/\//g, '\\/')));
        log(`✓ Открыт подраздел «${tab.name}» (${tab.path})`);
      });
    }
  });

  // ════════════════════════════════════════════════════════════
  // 1. Подраздел «Взносы собственников» (/snt/bookkeeping/fees/)
  // ════════════════════════════════════════════════════════════
  test('1. Взносы собственников: отображение, ссылки, поиск, фильтр, Excel, квитанции, ДДС (+1/-1 руб.) и удаление 1 взноса', async ({ page }) => {
    await openGrid(page, '/snt/bookkeeping/fees/');

    await softStep(page, '1.1 Отображение кнопок (включая наличие «Отправить всем напоминание» без клика), 11 колонок, строк и пагинации', async () => {
      await expect(page.locator('a.button.export', { hasText: 'Экспорт в Excel' })).toBeVisible();
      const sendAllBtn = page.getByRole('button', { name: 'Отправить всем напоминание' });
      await expect(sendAllBtn).toBeVisible();
      await expect(sendAllBtn).toBeEnabled();
      await expect(page.locator('input[name="FIND"]')).toBeVisible();

      await ensureAllColumnsVisible(page, FEES_COLUMNS);
      for (const col of FEES_COLUMNS) {
        const vals = await columnValues(page, col);
        expect(vals, `колонка «${col}» должна присутствовать в таблице взносов`).not.toBeNull();
      }
      expect(await gridRows(page).count()).toBeGreaterThan(0);
      expect(await page.locator('tr.main-grid-row-body input[type="checkbox"]').count()).toBeGreaterThan(0);
      await expect(page.locator('.main-grid-panel-total')).toContainText(/Всего/i);
      log(`✓ Проверены кнопки (наличие «Отправить всем напоминание» без нажатия), все ${FEES_COLUMNS.length} колонок, строки и пагинация`);
    });

    await softStep(page, '1.2 Кликабельность ссылки на участок из таблицы взносов', async () => {
      const unitLink = gridRowById(page, FEE_DEBT_ROW.id).locator('td a[href*="/snt/regions/"]').first();
      const href = await verifyTableLink(page, unitLink, new RegExp(`/snt/regions/${FEE_DEBT_ROW.sectorId}/`));
      log(`✓ Ссылка на участок №${FEE_DEBT_ROW.unitNumber} (${href}) открывается корректно`);
    });

    await softStep(page, '1.3 Скачивание файла «Экспорт в Excel»', async () => {
      await verifyDownload(
        page,
        () => page.locator('a.button.export', { hasText: 'Экспорт в Excel' }).click(),
        /\.xlsx$/i
      );
    });

    await softStep(page, '1.4 Меню строки «☰»: наличие пунктов, «Скачать квитанцию», «Отправить напоминание», переходы «Оплатить» (без оплаты) и «Создать претензию»', async () => {
      const items = await openRowMenuById(page, FEE_DEBT_ROW.id);
      const texts = (await items.allInnerTexts()).map((t) => t.trim());
      for (const expectedItem of [
        'Добавить движение денежных средств',
        'Отправить напоминание',
        'Скачать квитанцию',
        'Создать претензию',
        'Удалить взнос',
      ]) {
        expect(texts, `в меню строки должен быть пункт «${expectedItem}»`).toContain(expectedItem);
      }

      const hasPayItem = texts.includes('Оплатить');
      let payHref = null;
      if (hasPayItem) {
        const payItem = page.locator('.menu-popup-item:visible', { hasText: 'Оплатить' }).first();
        payHref = await payItem.getAttribute('href');
        expect(payHref).toMatch(/\/pay\/\?sntId=.*&type=FEE/i);
      }

      const claimItem = page.locator('.menu-popup-item:visible', { hasText: 'Создать претензию' }).first();
      const claimHref = await claimItem.getAttribute('href');
      expect(claimHref).toMatch(/\/snt\/peni\/claims\/add\/\?sector=/i);
      await closeAnyPopups(page);

      // Квитанция и напоминание по строке (без ухода со страницы)
      await verifySingleReceipt(page, FEE_DEBT_ROW.id, 'Скачать квитанцию');
      await verifySingleRowNotification(page, FEE_DEBT_ROW.id);

      // Если на стенде доступен пункт «Оплатить» — проверяем реальный переход на страницу оплаты (без совершения оплаты!)
      if (hasPayItem) {
        await clickRowMenuById(page, FEE_DEBT_ROW.id, 'Оплатить');
        await expect(page).toHaveURL(/\/pay\/\?sntId=/i);
        log(`✓ Проверен переход на страницу оплаты (${payHref}) без совершения оплаты`);
        await openGrid(page, '/snt/bookkeeping/fees/');
      } else {
        log('ℹ Пункт «Оплатить» не подключён для данного СНТ на тестовом стенде — пропускаем переход на /pay/');
      }

      // Проверяем переход «Создать претензию»
      await clickRowMenuById(page, FEE_DEBT_ROW.id, 'Создать претензию');
      await expect(page).toHaveURL(/\/snt\/peni\/claims\/add\//i);
      log(`✓ Проверен переход «Создать претензию» (${claimHref})`);

      await openGrid(page, '/snt/bookkeeping/fees/');
    });

    await softStep(page, '1.5 Групповые действия: «Скачать квитанцию» (.zip) и «Отправить напоминание»', async () => {
      await verifyGroupReceiptArchive(page, FEE_DEBT_ROW.id);
      await verifyGroupNotification(page, FEE_DEBT_ROW.id);
    });

    await softStep(page, '1.6 Быстрый поиск и фильтрация по полям (Участок, Улица, Взнос, Вид взноса, Тип взноса) → Найти → Сбросить', async () => {
      await quickSearch(page, FEE_DEBT_ROW.title);
      expect(await gridRows(page).count()).toBeGreaterThan(0);
      await expect(gridRowById(page, FEE_DEBT_ROW.id)).toBeVisible();
      await resetFilter(page);
      log(`✓ Быстрый поиск по взносу «${FEE_DEBT_ROW.title}» проверен`);

      const popup = await openFilter(page);
      await popup.locator('input[name="SECTOR_NUMBER"]').fill(FEE_DEBT_ROW.unitNumber);
      await popup.locator('input[name="SECTOR_STREET"]').fill(FEE_DEBT_ROW.street);
      await popup.locator('input[name="FEE_TITLE"]').fill(FEE_DEBT_ROW.title);
      await filterSelect(page, popup, 'CONTRIBUTION', FEE_DEBT_ROW.contributionType);
      await filterSelect(page, popup, 'FEE_TYPE', FEE_DEBT_ROW.feeType);
      await gridReload(page, () => popup.getByText('Найти', { exact: true }).click());

      expect(await gridRows(page).count()).toBeGreaterThan(0);
      const units = await columnValues(page, 'Участок');
      for (const u of units) expect(u).toBe(FEE_DEBT_ROW.unitNumber);

      await resetFilter(page);
      log('✓ Фильтрация по полям Участок, Улица, Взнос, Вид взноса и Тип взноса проверена');
    });

    await softStep(page, '1.7 «Добавить движение денежных средств»: валидация пустой формы + Пополнение 1 руб. и возврат Списанием 1 руб.', async () => {
      const beforeDebt = parseMoney(await rowCellText(page, FEE_DEBT_ROW.id, 'Задолженность'));
      const commentAdd = `Автотест ДДС Взносы +1 (${stamp()})`;
      const commentRevert = `Автотест ДДС Взносы -1 (${stamp()})`;
      lastDdsAddComment = commentAdd;
      let added = false;

      try {
        await clickRowMenuById(page, FEE_DEBT_ROW.id, 'Добавить движение денежных средств');
        const dialog = page.locator('.popup-window:visible').filter({ hasText: 'Изменение баланса' }).last();
        await expect(dialog).toBeVisible();

        // 1) Валидация пустой формы
        await Promise.all([
          page.waitForResponse((r) => r.url().includes('changeBalance') && r.request().method() === 'POST', { timeout: 15_000 }),
          dialog.locator('.popup-window-button, .ui-btn').filter({ hasText: 'Изменить' }).click(),
        ]);
        await expect(dialog.locator('.ui-ctl-danger').first()).toBeVisible();
        log('✓ Проверена валидация пустой формы «Изменение баланса по взносу» (.ui-ctl-danger)');

        // 2) Пополнение на 1 руб.
        await submitChangeBalanceDialog(page, dialog, {
          price: 1,
          type: 'add',
          dateStr: '28.10.2026 12:00:00',
          comment: commentAdd,
        });
        added = true;

        const afterAddDebt = parseMoney(await rowCellText(page, FEE_DEBT_ROW.id, 'Задолженность'));
        expect(afterAddDebt).toBeCloseTo(beforeDebt - 1, 1);
        log(`✓ Пополнение 1 руб. проведено: задолженность изменилась с ${beforeDebt} на ${afterAddDebt} руб.`);
      } finally {
        if (added) {
          await openGrid(page, '/snt/bookkeeping/fees/');
          await clickRowMenuById(page, FEE_DEBT_ROW.id, 'Добавить движение денежных средств');
          const revertDialog = page.locator('.popup-window:visible').filter({ hasText: 'Изменение баланса' }).last();
          await expect(revertDialog).toBeVisible();
          await submitChangeBalanceDialog(page, revertDialog, {
            price: 1,
            type: 'write-off',
            dateStr: '28.10.2026 12:01:00',
            comment: commentRevert,
          });
          const restoredDebt = parseMoney(await rowCellText(page, FEE_DEBT_ROW.id, 'Задолженность'));
          expect(restoredDebt).toBeCloseTo(beforeDebt, 1);
          log(`✓ Исходная задолженность по взносу восстановлена Списанием 1 руб. (${restoredDebt} руб.)`);
        } else {
          await closeAnyPopups(page).catch(() => {});
        }
      }
    });

    await softStep(page, '1.8 Удаление взноса на участке №1 (строго 1 раз за тест)', async () => {
      if (unit1FeeDeletedOnce) {
        log('ℹ Взнос на участке №1 уже был удалён в этом прогоне — пропускаем');
        return;
      }

      const targetId = await page.evaluate((protectedId) => {
        const table = document.querySelector('table.main-grid-table');
        if (!table) return null;
        const heads = [...table.querySelectorAll('tr.main-grid-row-head th')].map((th) => th.innerText.replace(/\s+/g, ' ').trim());
        const uIdx = heads.indexOf('Участок');
        const debtIdx = heads.indexOf('Задолженность');
        if (uIdx < 0) return null;
        const rows = [...table.querySelectorAll('tr.main-grid-row-body[data-id]:not([data-id="template_0"]):not(.main-grid-not-count)')].filter((tr) => {
          const id = tr.getAttribute('data-id');
          if (!id || id === protectedId) return false;
          const cells = [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim());
          return cells[uIdx] === '1';
        });
        const zeroDebtRow = debtIdx >= 0
          ? rows.find((tr) => {
              const cells = [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim());
              return cells[debtIdx] === '0 руб.';
            })
          : null;
        const chosen = zeroDebtRow || rows[rows.length - 1];
        return chosen ? chosen.getAttribute('data-id') : null;
      }, FEE_DEBT_ROW.id);

      expect(targetId, 'на участке №1 должен быть взнос для проверки удаления').toBeTruthy();

      await clickRowMenuById(page, targetId, 'Удалить взнос');
      const delDialog = page.locator('.popup-window:visible', { hasText: 'Удаление взноса' }).last();
      await expect(delDialog).toBeVisible();

      if (process.env.SKIP_FEE_DELETE === '1') {
        await delDialog.locator('.popup-window-button, .ui-btn').filter({ hasText: 'Отмена' }).click();
        await expect(delDialog).toBeHidden();
        log(`✓ Модальное окно «Удаление взноса» на участке №1 (id=${targetId}) проверено (SKIP_FEE_DELETE=1)`);
        return;
      }

      await Promise.all([
        page.waitForResponse((r) => r.url().includes('remove') && r.request().method() === 'POST', { timeout: 15_000 }),
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {}),
        delDialog.locator('.popup-window-button, .ui-btn').filter({ hasText: 'Удалить' }).click(),
      ]);
      unit1FeeDeletedOnce = true;
      await expect(page.locator('#pageMain')).toBeVisible();
      await expect(page.locator(`tr.main-grid-row-body[data-id="${targetId}"]`)).toHaveCount(0);
      log(`✓ На участке №1 удалён 1 взнос (id=${targetId})`);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 2. Подраздел «Электроэнергия» (/snt/bookkeeping/energy/)
  // ════════════════════════════════════════════════════════════
  test('2. Электроэнергия: отображение, ссылки, поиск, фильтр, Excel, квитанции и ДДС (+1/-1 руб.)', async ({ page }) => {
    await openGrid(page, '/snt/bookkeeping/energy/');

    await softStep(page, '2.1 Отображение кнопок (включая наличие «Отправить всем напоминание» без клика), 14 колонок, строк и чек-боксов', async () => {
      await expect(page.locator('a.button.export', { hasText: 'Экспорт в Excel' })).toBeVisible();
      const sendAllBtn = page.locator('#counters-send-all-notifications');
      await expect(sendAllBtn).toBeVisible();
      await expect(sendAllBtn).toBeEnabled();
      await expect(page.locator('input[name="FIND"]')).toBeVisible();

      await ensureAllColumnsVisible(page, ENERGY_COLUMNS);
      for (const col of ENERGY_COLUMNS) {
        const vals = await columnValues(page, col);
        expect(vals, `колонка «${col}» должна присутствовать в таблице электроэнергии`).not.toBeNull();
      }
      expect(await gridRows(page).count()).toBeGreaterThan(0);
      expect(await page.locator('tr.main-grid-row-body input[type="checkbox"]').count()).toBeGreaterThan(0);
      log(`✓ Проверены кнопки (наличие «Отправить всем напоминание» без нажатия), все ${ENERGY_COLUMNS.length} колонок, строки и чек-боксы`);
    });

    await softStep(page, '2.2 Ссылки из таблицы: карточка собственника и карточка счётчика участка', async () => {
      const row = gridRowById(page, ENERGY_DEBT_ROW.id);
      const ownerLink = row.locator('td a[href*="/snt/people/detail/"]').first();
      await verifyTableLink(page, ownerLink, /\/snt\/people\/detail\/\?id=/);

      const unitLink = row.locator('td a[href*="/snt/regions/"]').first();
      await verifyTableLink(page, unitLink, new RegExp(`/snt/regions/${ENERGY_DEBT_ROW.sectorId}/energy/\\?counterId=${ENERGY_DEBT_ROW.id}`));
      log('✓ Проверены переходы по ссылкам в карточку собственника и карточку счётчика участка');
    });

    await softStep(page, '2.3 Скачивание файла «Экспорт в Excel»', async () => {
      await verifyDownload(
        page,
        () => page.locator('a.button.export', { hasText: 'Экспорт в Excel' }).click(),
        /\.xlsx$/i
      );
    });

    await softStep(page, '2.4 Меню строки «☰» («Квитанция на оплату», «Отправить напоминание») и групповые действия', async () => {
      const items = await openRowMenuById(page, ENERGY_DEBT_ROW.id);
      const texts = (await items.allInnerTexts()).map((t) => t.trim());
      for (const expectedItem of [
        'Добавить движение денежных средств',
        'Квитанция на оплату',
        'Отправить напоминание',
      ]) {
        expect(texts).toContain(expectedItem);
      }
      await closeAnyPopups(page);

      await verifySingleReceipt(page, ENERGY_DEBT_ROW.id, 'Квитанция на оплату');
      await verifySingleRowNotification(page, ENERGY_DEBT_ROW.id);
      await verifyGroupReceiptArchive(page, ENERGY_DEBT_ROW.id);
      await verifyGroupNotification(page, ENERGY_DEBT_ROW.id);
    });

    await softStep(page, '2.5 Быстрый поиск и фильтрация по полям (Статус, Участок, Улица, Тариф) → Найти → Сбросить', async () => {
      await quickSearch(page, ENERGY_DEBT_ROW.serial);
      expect(await gridRows(page).count()).toBeGreaterThan(0);
      await expect(gridRowById(page, ENERGY_DEBT_ROW.id)).toBeVisible();
      await resetFilter(page);
      log(`✓ Быстрый поиск по серийному номеру «${ENERGY_DEBT_ROW.serial}» проверен`);

      const popup = await openFilter(page);
      await filterSelect(page, popup, 'ACTIVE', 'активный');
      await popup.locator('input[name="SECTOR_NUMBER"]').fill(ENERGY_DEBT_ROW.unitNumber);
      await popup.locator('input[name="SECTOR_STREET"]').fill(ENERGY_DEBT_ROW.street);
      await popup.locator('input[name="TARIFF_NAME"]').fill(ENERGY_DEBT_ROW.tariff);
      await gridReload(page, () => popup.getByText('Найти', { exact: true }).click());

      expect(await gridRows(page).count()).toBeGreaterThan(0);
      await expect(gridRowById(page, ENERGY_DEBT_ROW.id)).toBeVisible();

      await resetFilter(page);
      log('✓ Фильтрация по полям Статус, Участок, Улица и Тариф проверена');
    });

    await softStep(page, '2.6 «Добавить движение денежных средств»: валидация пустой формы + Пополнение 1 руб. и возврат Списанием 1 руб.', async () => {
      const beforeDebt = parseMoney(await rowCellText(page, ENERGY_DEBT_ROW.id, 'Задолженность'));
      const commentAdd = `Автотест ДДС ЭЭ +1 (${stamp()})`;
      const commentRevert = `Автотест ДДС ЭЭ -1 (${stamp()})`;
      lastDdsAddComment = commentAdd;
      let added = false;

      try {
        // Проверяем открытие окна из меню строки «☰ → Добавить движение денежных средств»
        await clickRowMenuById(page, ENERGY_DEBT_ROW.id, 'Добавить движение денежных средств');
        const menuDialog = page.locator('.popup-window:visible').filter({ hasText: 'Изменение баланса' }).last();
        await expect(menuDialog).toBeVisible();
        await expect(menuDialog.locator('[data-field="price"] input')).toBeVisible();
        await expect(menuDialog.locator('select')).toBeVisible();
        await expect(menuDialog.locator('input[data-type="custom-date"]')).toBeVisible();
        await expect(menuDialog.locator('[data-field="comment"] textarea')).toBeVisible();
        await menuDialog.locator('.popup-window-button, .ui-btn').filter({ hasText: 'Отмена' }).click();

        // Вызываем изменение баланса с counterId и sectorId
        await page.evaluate(({ cid, sid }) => {
          BX.App.Registry.Detail.Counters.changeBalance(cid, sid);
        }, { cid: ENERGY_DEBT_ROW.id, sid: ENERGY_DEBT_ROW.sectorId });

        const dialog = page.locator('.popup-window:visible').filter({ hasText: 'Изменение баланса' }).last();
        await expect(dialog).toBeVisible();

        // 1) Валидация пустой формы
        await Promise.all([
          page.waitForResponse((r) => r.url().includes('changeBalance') && r.request().method() === 'POST', { timeout: 15_000 }),
          dialog.locator('.popup-window-button, .ui-btn').filter({ hasText: 'Изменить' }).click(),
        ]);
        await expect(dialog.locator('.ui-ctl-danger').first()).toBeVisible();
        log('✓ Проверена валидация пустой формы «Изменение баланса» электроэнергии (.ui-ctl-danger)');

        // 2) Пополнение на 1 руб.
        await submitChangeBalanceDialog(page, dialog, {
          price: 1,
          type: 'add',
          dateStr: '28.10.2026 12:00:00',
          comment: commentAdd,
        });
        added = true;

        const afterAddDebt = parseMoney(await rowCellText(page, ENERGY_DEBT_ROW.id, 'Задолженность'));
        expect(afterAddDebt).toBeCloseTo(beforeDebt - 1, 1);
        log(`✓ Пополнение 1 руб. по ЭЭ проведено: задолженность изменилась с ${beforeDebt} на ${afterAddDebt} руб.`);
      } finally {
        if (added) {
          await openGrid(page, '/snt/bookkeeping/energy/');
          await page.evaluate(({ cid, sid }) => {
            BX.App.Registry.Detail.Counters.changeBalance(cid, sid);
          }, { cid: ENERGY_DEBT_ROW.id, sid: ENERGY_DEBT_ROW.sectorId });
          const revertDialog = page.locator('.popup-window:visible').filter({ hasText: 'Изменение баланса' }).last();
          await expect(revertDialog).toBeVisible();
          await submitChangeBalanceDialog(page, revertDialog, {
            price: 1,
            type: 'write-off',
            dateStr: '28.10.2026 12:01:00',
            comment: commentRevert,
          });
          const restoredDebt = parseMoney(await rowCellText(page, ENERGY_DEBT_ROW.id, 'Задолженность'));
          expect(restoredDebt).toBeCloseTo(beforeDebt, 1);
          log(`✓ Исходный баланс по счётчику ЭЭ восстановлен Списанием 1 руб. (${restoredDebt} руб.)`);
        } else {
          await closeAnyPopups(page).catch(() => {});
        }
      }
    });
  });

  // ════════════════════════════════════════════════════════════
  // 3. Подраздел «Водопотребление» (/snt/bookkeeping/water/)
  // ════════════════════════════════════════════════════════════
  test('3. Водопотребление: отображение, ссылки, поиск, фильтр, Excel, квитанция, ДДС (+1/-1 руб.) и «Календарь событий»', async ({ page }) => {
    await openGrid(page, '/snt/bookkeeping/water/');

    await softStep(page, '3.1 Отображение кнопок (включая наличие «Отправить всем напоминание» без клика), 13 колонок, строк и чек-боксов', async () => {
      await expect(page.locator('a.button.export', { hasText: 'Экспорт в Excel' })).toBeVisible();
      const sendAllBtn = page.getByRole('button', { name: 'Отправить всем напоминание' });
      await expect(sendAllBtn).toBeVisible();
      await expect(sendAllBtn).toBeEnabled();
      await expect(page.locator('input[name="FIND"]')).toBeVisible();

      await ensureAllColumnsVisible(page, WATER_COLUMNS);
      for (const col of WATER_COLUMNS) {
        const vals = await columnValues(page, col);
        expect(vals, `колонка «${col}» должна присутствовать в таблице водопотребления`).not.toBeNull();
      }
      expect(await gridRows(page).count()).toBeGreaterThan(0);
      expect(await page.locator('tr.main-grid-row-body input[type="checkbox"]').count()).toBeGreaterThan(0);
      log(`✓ Проверены кнопки (наличие «Отправить всем напоминание» без нажатия), все ${WATER_COLUMNS.length} колонок, строки и чек-боксы`);
    });

    await softStep(page, '3.2 Ссылки из таблицы: карточка участка и карточка собственника', async () => {
      const row = gridRowById(page, WATER_DEBT_ROW.id);
      const unitLink = row.locator('td a[href*="/snt/regions/"]').first();
      await verifyTableLink(page, unitLink, new RegExp(`/snt/regions/${WATER_DEBT_ROW.sectorId}/`));

      const ownerLink = row.locator('td a[href*="/snt/people/detail/"]').first();
      await verifyTableLink(page, ownerLink, /\/snt\/people\/detail\/\?id=/);
      log('✓ Проверены переходы по ссылкам в карточку участка и карточку собственника');
    });

    await softStep(page, '3.3 Скачивание файла «Экспорт в Excel»', async () => {
      await verifyDownload(
        page,
        () => page.locator('a.button.export', { hasText: 'Экспорт в Excel' }).click(),
        /\.xlsx$/i
      );
    });

    await softStep(page, '3.4 Меню строки «☰»: пункты, «Квитанция на оплату» и «Отправить напоминание»', async () => {
      const items = await openRowMenuById(page, WATER_DEBT_ROW.id);
      const texts = (await items.allInnerTexts()).map((t) => t.trim());
      for (const expectedItem of [
        'Добавить движение денежных средств',
        'Квитанция на оплату',
        'Отправить напоминание',
      ]) {
        expect(texts).toContain(expectedItem);
      }
      await closeAnyPopups(page);

      await verifySingleReceipt(page, WATER_DEBT_ROW.id, 'Квитанция на оплату');
      await verifySingleRowNotification(page, WATER_DEBT_ROW.id);
    });

    await softStep(page, '3.5 Быстрый поиск и фильтрация по полям (Статус, Участок, Улица, Счетчик) → Найти → Сбросить', async () => {
      await quickSearch(page, WATER_DEBT_ROW.plomb);
      expect(await gridRows(page).count()).toBeGreaterThan(0);
      await expect(gridRowById(page, WATER_DEBT_ROW.id)).toBeVisible();
      await resetFilter(page);
      log(`✓ Быстрый поиск по пломбе «${WATER_DEBT_ROW.plomb}» проверен`);

      const popup = await openFilter(page);
      await filterSelect(page, popup, 'ACTIVE', 'активный');
      await popup.locator('input[name="SECTOR_NUM"]').fill(WATER_DEBT_ROW.unitNumber);
      await popup.locator('input[name="SECTOR_STREET"]').fill(WATER_DEBT_ROW.street);
      await popup.locator('input[name="COUNTER_NAME"]').fill(WATER_DEBT_ROW.brand);
      await gridReload(page, () => popup.getByText('Найти', { exact: true }).click());

      expect(await gridRows(page).count()).toBeGreaterThan(0);
      await expect(gridRowById(page, WATER_DEBT_ROW.id)).toBeVisible();

      await resetFilter(page);
      log('✓ Фильтрация по полям Статус, Участок, Улица и Счетчик проверена');
    });

    await softStep(page, '3.6 «Добавить движение денежных средств»: валидация пустой формы + Пополнение 1 руб. и возврат Списанием 1 руб.', async () => {
      const beforeDebt = parseMoney(await rowCellText(page, WATER_DEBT_ROW.id, 'Задолженность'));
      const commentAdd = `Автотест ДДС Вода +1 (${stamp()})`;
      const commentRevert = `Автотест ДДС Вода -1 (${stamp()})`;
      lastDdsAddComment = commentAdd;
      let added = false;

      try {
        await clickRowMenuById(page, WATER_DEBT_ROW.id, 'Добавить движение денежных средств');
        const dialog = page.locator('.popup-window:visible').filter({ hasText: 'Изменение баланса' }).last();
        await expect(dialog).toBeVisible();

        // 1) Валидация пустой формы
        await Promise.all([
          page.waitForResponse((r) => r.url().includes('changeBalance') && r.request().method() === 'POST', { timeout: 15_000 }),
          dialog.locator('.popup-window-button, .ui-btn').filter({ hasText: 'Изменить' }).click(),
        ]);
        await expect(dialog.locator('.ui-ctl-danger').first()).toBeVisible();
        log('✓ Проверена валидация пустой формы «Изменение баланса» водопотребления (.ui-ctl-danger)');

        // 2) Пополнение на 1 руб.
        await submitChangeBalanceDialog(page, dialog, {
          price: 1,
          type: 'add',
          dateStr: '28.10.2026 12:00:00',
          comment: commentAdd,
        });
        added = true;

        const afterAddDebt = parseMoney(await rowCellText(page, WATER_DEBT_ROW.id, 'Задолженность'));
        expect(afterAddDebt).toBeCloseTo(beforeDebt - 1, 1);
        log(`✓ Пополнение 1 руб. по воде проведено: задолженность изменилась с ${beforeDebt} на ${afterAddDebt} руб.`);
      } finally {
        if (added) {
          await openGrid(page, '/snt/bookkeeping/water/');
          await clickRowMenuById(page, WATER_DEBT_ROW.id, 'Добавить движение денежных средств');
          const revertDialog = page.locator('.popup-window:visible').filter({ hasText: 'Изменение баланса' }).last();
          await expect(revertDialog).toBeVisible();
          await submitChangeBalanceDialog(page, revertDialog, {
            price: 1,
            type: 'write-off',
            dateStr: '28.10.2026 12:01:00',
            comment: commentRevert,
          });
          const restoredDebt = parseMoney(await rowCellText(page, WATER_DEBT_ROW.id, 'Задолженность'));
          expect(restoredDebt).toBeCloseTo(beforeDebt, 1);
          log(`✓ Исходный баланс по счётчику воды восстановлен Списанием 1 руб. (${restoredDebt} руб.)`);
        } else {
          await closeAnyPopups(page).catch(() => {});
        }
      }
    });

    await softStep(page, '3.7 Полный цикл «Календарь событий» (через меню строки «☰» и через групповое действие)', async () => {
      try {
        await Promise.all([
          page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 15_000 }),
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {}),
          clickRowMenuById(page, WATER_DEBT_ROW.id, 'Добавить в Календарь событий'),
        ]);
        await page.waitForTimeout(300);

        const calStatusAfterMenu = await rowCellText(page, WATER_DEBT_ROW.id, 'В календаре');
        if (calStatusAfterMenu === 'В календаре') {
          page.once('dialog', (d) => d.accept());
          await Promise.all([
            page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 15_000 }),
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {}),
            clickRowMenuById(page, WATER_DEBT_ROW.id, 'Удалить из Календаря событий'),
          ]);
          await expect(gridRowById(page, WATER_DEBT_ROW.id)).toContainText('Не в календаре');
        }
        log('✓ Проверено действие «Добавить в Календарь событий» из меню строки');

        await selectGridRowById(page, WATER_DEBT_ROW.id);
        await Promise.all([
          page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 15_000 }),
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {}),
          applyGroupAction(page, 'snt-counter-cal-action_control', 'Добавить в Календарь событий'),
        ]);
        await page.waitForTimeout(300);

        const calStatusAfterBulk = await rowCellText(page, WATER_DEBT_ROW.id, 'В календаре');
        if (calStatusAfterBulk === 'В календаре') {
          await selectGridRowById(page, WATER_DEBT_ROW.id);
          page.once('dialog', (d) => d.accept());
          await Promise.all([
            page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 15_000 }),
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {}),
            applyGroupAction(page, 'snt-counter-cal-action_control', 'Удалить из Календаря событий'),
          ]);
          await expect(gridRowById(page, WATER_DEBT_ROW.id)).toContainText('Не в календаре');
        }
        log('✓ Проверены групповые действия Календаря событий во вкладке «Водопотребление»');
      } finally {
        const curStatus = await rowCellText(page, WATER_DEBT_ROW.id, 'В календаре').catch(() => 'Не в календаре');
        if (curStatus === 'В календаре') {
          page.once('dialog', (d) => d.accept());
          await clickRowMenuById(page, WATER_DEBT_ROW.id, 'Удалить из Календаря событий').catch(() => {});
          await page.waitForTimeout(400);
        }
      }
    });
  });

  // ════════════════════════════════════════════════════════════
  // 4. Подраздел «Деньги» (/snt/bookkeeping/money/)
  // ════════════════════════════════════════════════════════════
  test('4. Деньги: отображение, проверка созданных операций ДДС, ссылки, поиск, фильтрация и экспорт в Excel', async ({ page }) => {
    await openGrid(page, '/snt/bookkeeping/money/');

    await softStep(page, '4.1 Отображение кнопки «Экспорт в Excel», всех 10 колонок, строк и пагинации', async () => {
      await expect(page.locator('a.button', { hasText: 'Экспорт в Excel' })).toBeVisible();
      await expect(page.locator('input[name="FIND"]')).toBeVisible();

      await ensureAllColumnsVisible(page, MONEY_COLUMNS);
      for (const col of MONEY_COLUMNS) {
        const vals = await columnValues(page, col);
        expect(vals, `колонка «${col}» должна присутствовать в таблице «Деньги»`).not.toBeNull();
      }
      expect(await gridRows(page).count()).toBeGreaterThan(0);
      await expect(page.locator('.main-grid-panel-total')).toContainText(/Всего/i);
      log(`✓ Проверены кнопка «Экспорт в Excel», все ${MONEY_COLUMNS.length} колонок, строки и пагинация`);
    });

    await softStep(page, '4.2 Проверка отображения в «Деньгах» операции, созданной через «Добавить движение денежных средств»', async () => {
      const searchPattern = lastDdsAddComment || /\+1/;
      let addRow = gridRows(page).filter({ hasText: searchPattern }).first();
      let searched = false;
      if (!(await addRow.isVisible().catch(() => false)) && lastDdsAddComment) {
        await quickSearch(page, lastDdsAddComment);
        searched = true;
        addRow = gridRows(page).filter({ hasText: searchPattern }).first();
      }
      await expect(addRow, `операция пополнения ДДС («${lastDdsAddComment || '+1'}») должна отображаться в реестре «Деньги»`).toBeVisible();
      await expect(addRow).toContainText('Поступление');
      await expect(addRow).toContainText('Касса');
      if (searched) {
        await resetFilter(page);
      }
      log(`✓ Операция пополнения ДДС («${lastDdsAddComment || '+1'}») успешно найдена в сводном реестре «Деньги»`);
    });

    await softStep(page, '4.3 Кликабельность ссылки на участок из таблицы «Деньги»', async () => {
      const unitLink = gridRows(page).locator('td a[href*="/snt/regions/"]').first();
      const href = await verifyTableLink(page, unitLink, /\/snt\/regions\/\d+\//);
      log(`✓ Переход по ссылке участка (${href}) из реестра «Деньги» проверен`);
    });

    await softStep(page, '4.4 Быстрый поиск и фильтрация по полям (Участок, Вид, Тип операции, Источник операции) → Найти → Сбросить', async () => {
      const query = lastDdsAddComment || 'Автотест ДДС';
      await quickSearch(page, query);
      expect(await gridRows(page).count()).toBeGreaterThan(0);
      await resetFilter(page);
      log(`✓ Быстрый поиск по назначению платежа «${query}» проверен`);

      const popup = await openFilter(page);
      await popup.locator('input[name="ALL_SECTOR_NUMBER"]').fill('1');
      await filterSelect(page, popup, 'TYPE', 'Взнос');
      await filterSelect(page, popup, 'OPERATION_TYPE', 'Поступление');
      await filterSelect(page, popup, 'ALL_OPERATION_SOURCE', 'Касса');
      await gridReload(page, () => popup.getByText('Найти', { exact: true }).click());

      expect(await gridRows(page).count()).toBeGreaterThan(0);
      const types = await columnValues(page, 'Вид');
      const opTypes = await columnValues(page, 'Тип операции');
      const sources = await columnValues(page, 'Источник операции');
      for (const t of types) expect(t).toBe('Взнос');
      for (const op of opTypes) expect(op).toBe('Поступление');
      for (const src of sources) expect(src).toBe('Касса');

      await resetFilter(page);
      log('✓ Фильтрация по полям Участок, Вид, Тип операции и Источник операции проверена');
    });

    await softStep(page, '4.5 Скачивание файла «Экспорт в Excel» в подразделе «Деньги»', async () => {
      await verifyDownload(
        page,
        () => page.locator('a.button', { hasText: 'Экспорт в Excel' }).click(),
        /\.xlsx$/i
      );
    });
  });
});
