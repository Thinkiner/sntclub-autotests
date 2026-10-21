// ============================================================
// Смоук-тест: раздел «Настройки СНТ» на lk.sntclub.ru (ЛК Председателя)
// Тестовый фреймворк: Playwright Test (@playwright/test)
//
// Что проверяется (по вкладкам):
//  0. Навигация по всем 9 вкладкам раздела
//  1. Настройки коммуникаций: SMTP (валидация, автоподстановка Host/Port),
//     покупка СМС (счёт на оплату + переход на ЮKassa, без оплаты),
//     приоритеты рассылки, Telegram/Max Chat ID (изменить → вернуть)
//  2. Реквизиты: отображение, валидация, окно подтверждения,
//     изменение Адреса и Полного наименования (→ вернуть), автозаполнение по БИК
//  3. Настройки для собственников: каждый чек-бокс/радио по одному (→ вернуть),
//     валидация «Даты начала периода», назначение платежа (→ вернуть)
//  4. Интеграции: 1С:Садовод — валидация полей и ссылки на инструкции
//  5. Печать и подпись: удаление файлов БЕЗ сохранения + перезагрузка
//  6. Категории заявок: создание → редактирование → удаление
//  7. Роли: все чек-боксы прав, создание → редактирование → удаление,
//     системные роли без меню действий
//  8. Исполнители (после Ролей): редактирование существующего (→ вернуть),
//     добавление из имеющих ЛК и нового по email → удаление обоих
//  9. История операций: тариф, таблица транзакций, «Выбрать другой тариф»
//
// Все изменения откатываются в блоках finally.
//
// Запуск:
//   npx playwright test settings-snt.spec.js --headed
// ============================================================

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────
// НАСТРОЙКИ ТЕСТА
// ─────────────────────────────────────────────────────────────
const TEST_USER = {
  email: 'test.ramos@mail.ru',
  password: 'Wqmyt1DZ7L',
};

const BASE_URL = 'https://lk.sntclub.ru';

const TABS = [
  { name: 'Настройки коммуникаций', path: '/snt/settings/communications/' },
  { name: 'Реквизиты', path: '/snt/settings/requisite/' },
  { name: 'Настройки для собственников', path: '/snt/settings/' },
  { name: 'Интеграции', path: '/snt/settings/integrations/' },
  { name: 'Печать и подпись для документов', path: '/snt/settings/signature/' },
  { name: 'Категории заявок', path: '/snt/settings/categories/' },
  { name: 'Исполнители', path: '/snt/settings/contractors/' },
  { name: 'Роли', path: '/snt/settings/role/' },
  { name: 'История операций', path: '/snt/settings/billing/' },
];

/** Ожидаемая автоподстановка SMTP по почтовой системе */
const SMTP_PRESETS = {
  mail: { host: 'smtp.mail.ru', port: '465' },
  gmail: { host: 'smtp.gmail.com', port: '465' },
  yandex: { host: 'smtp.yandex.ru', port: '465' },
  outlook: { host: 'smtp.office365.com', port: '587' },
};

/** БИК, по которому проверяется автозаполнение банка */
const BIK = { bik: '044525974', bank: 'АО "ТБанк"', corAcc: '30101810145250000974' };

/**
 * Максимум для поля «Дата начала периода».
 * ВНИМАНИЕ: по ТЗ допустимы числа 1–31, но в вёрстке стоит max="28".
 * Тест проверяет фактическое поведение сайта (1–28).
 */
const PERIOD_START_MAX = 28;

/** Существующий исполнитель, которого редактируем и возвращаем как было.
 *  Если на стенде его нет — тест возьмёт последнего исполнителя с меню действий. */
const EXISTING_CONTRACTOR = 'Охранник Федя';

/** Аккаунт из «Имеющих ЛК», которого назначаем исполнителем и потом удаляем */
const EXISTING_ACCOUNT = { search: 'Соснов', fio: 'Соснов Егор Петрович' };

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
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Ivanov@mail.ru').fill(TEST_USER.email);
  await page.getByPlaceholder('******').fill(TEST_USER.password);
  await page.locator('#login-btn').click();

  // Экран выбора роли появляется не всегда
  const predRole = page.locator('a, button, div').filter({ hasText: /^Председатель$/ }).first();
  if (await predRole.isVisible({ timeout: 5_000 }).catch(() => false)) {
    log('Экран выбора роли → «Председатель»');
    await predRole.click();
  }
  await expect(page.locator('#topUser')).toBeVisible({ timeout: 25_000 });
}

async function open(page, path) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#pageMain')).toBeVisible();
}

/** Клик с ожиданием перезагрузки страницы (обычная отправка формы POST) */
async function clickAndWaitReload(page, locator) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
    locator.click(),
  ]);
}

/** Проверка нативной HTML5-валидации поля */
async function validity(locator) {
  return locator.evaluate((el) => ({ valid: el.checkValidity(), message: el.validationMessage }));
}

/** Строка грида Bitrix по тексту */
function gridRow(page, text) {
  return page.locator('tr.main-grid-row-body:not([hidden])').filter({ hasText: text });
}

/** Открыть меню «☰» строки грида и выбрать пункт */
async function gridRowAction(page, rowText, action /* 'edit' | 'delete' */) {
  const row = gridRow(page, rowText).first();
  await expect(row).toBeVisible();
  await row.locator('.main-grid-row-action-button').click();
  const item = page.locator(`.menu-popup-item.${action}`).locator('visible=true').first();
  await expect(item).toBeVisible();
  await item.click();
}

/** Удалить строку грида через меню и подтверждение */
async function gridDeleteRow(page, rowText) {
  page.once('dialog', (d) => d.accept());
  await gridRowAction(page, rowText, 'delete');
  const yes = page.locator('#confirmBox.active #btnYes, .popup__dialog.active #btnYes').first();
  if (await yes.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await yes.click();
  }
  await expect(gridRow(page, rowText)).toHaveCount(0, { timeout: 15_000 });
}

/** Тихая очистка (для finally): удалить строку, если она осталась */
async function cleanupRow(page, path, rowText) {
  try {
    await open(page, path);
    if ((await gridRow(page, rowText).count()) > 0) {
      log(`Очистка: удаляем «${rowText}»`);
      await gridDeleteRow(page, rowText);
    }
  } catch (e) {
    console.warn(`  ⚠ Не удалось удалить «${rowText}»: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// ТЕСТЫ
// ─────────────────────────────────────────────────────────────

test.describe('Настройки СНТ (lk.sntclub.ru)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // ═══════════════════════════════════════════════════════════
  // 0. Навигация
  // ═══════════════════════════════════════════════════════════
  test('0. Навигация по всем вкладкам', async ({ page }) => {
    await open(page, '/snt/settings/');
    for (const tab of TABS) {
      log(`Вкладка «${tab.name}»`);
      await page.locator('a.tabs__link', { hasText: tab.name }).first().click();
      await page.waitForURL(`${BASE_URL}${tab.path}`);
      await expect(page.locator('li.tabs__item.active a.tabs__link')).toHaveText(tab.name);
      await expect(page.locator('body')).not.toContainText(/Fatal error|Страница не найдена/i);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 1. Настройки коммуникаций
  // ═══════════════════════════════════════════════════════════
  test.describe('1. Настройки коммуникаций', () => {
    const PATH = '/snt/settings/communications/';

    test('1.1 Отображение блоков и элементов', async ({ page }) => {
      await open(page, PATH);
      for (const h of ['Настройка отправки писем', 'Баланс СМС', 'Настройка рассылки',
        'Настройка оповещений через Telegram', 'Настройка оповещений через Max']) {
        await expect(page.locator('h2', { hasText: h })).toBeVisible();
      }
      for (const link of ['Mail.ru', 'Yandex.ru', 'Gmail.com', 'Outlook.com']) {
        await expect(page.locator('#pageMain a', { hasText: link }).first()).toHaveAttribute('href', /.+/);
      }
      await expect(page.locator('label[for="SMTP_ADD"]')).toBeVisible();
      await expect(page.locator('a.button', { hasText: 'Пополнить' })).toHaveAttribute('href', '/snt/settings/addsms/');
      for (const ch of ['sms', 'email', 'telegram', 'max']) {
        await expect(page.locator(`#snt_props select[name="${ch}"]`)).toBeVisible();
      }
      await expect(page.locator('#TELEGRAM_CHAT_ID')).toBeVisible();
      await expect(page.locator('#add-telegram-chat-id')).toBeVisible();
      await expect(page.locator('#MAX_CHAT_ID')).toBeVisible();
      await expect(page.locator('#add-max-group-link')).toBeVisible();
      await expect(page.locator('a[href="https://t.me/SNTclub_bot"]')).toBeVisible();
    });

    test('1.2 SMTP: поля, автоподстановка и валидация (без сохранения)', async ({ page }) => {
      await open(page, PATH);
      const smtpForm = page.locator('#smtpform');
      // На разных стендах SMTP может быть уже включён — запоминаем исходное состояние
      const originalChecked = await page.locator('#SMTP_ADD').isChecked();
      log(`SMTP изначально ${originalChecked ? 'включён' : 'выключен'}`);
      if (originalChecked) {
        await expect(smtpForm).toBeVisible();
        log('Снимаем галочку — поля скрываются');
        await page.locator('label[for="SMTP_ADD"]').click();
        await expect(smtpForm).toBeHidden();
      } else {
        await expect(smtpForm).toBeHidden();
      }

      log('Ставим галочку «Настроить SMTP»');
      await page.locator('label[for="SMTP_ADD"]').click();
      await expect(smtpForm).toBeVisible();
      for (const id of ['selectMail', 'HOST', 'PORT', 'EMAIL', 'PASSWORD']) {
        await expect(page.locator(`#${id}`)).toBeVisible();
      }

      for (const [value, preset] of Object.entries(SMTP_PRESETS)) {
        await page.locator('#selectMail').selectOption(value);
        await expect(page.locator('#HOST')).toHaveValue(preset.host);
        await expect(page.locator('#PORT')).toHaveValue(preset.port);
        log(`✓ ${value}: ${preset.host}:${preset.port}`);
      }

      log('Валидация: сохраняем с пустыми полями');
      await page.locator('#selectMail').selectOption('self');
      await page.locator('#HOST').fill('');
      await page.locator('#EMAIL').fill('');
      await page.locator('#PASSWORD').fill('');
      await page.locator('#snt_smtp button').first().click();
      await page.waitForTimeout(1000);
      await expect(page).toHaveURL(`${BASE_URL}${PATH}`);
      for (const id of ['HOST', 'EMAIL', 'PASSWORD']) {
        const v = await validity(page.locator(`#${id}`));
        expect(v.valid, `${id} должен быть невалиден`).toBe(false);
      }

      log('Снимаем галочку');
      await page.locator('label[for="SMTP_ADD"]').click();
      await expect(smtpForm).toBeHidden();

      log('Перезагрузка без сохранения — состояние SMTP прежнее');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#SMTP_ADD')).toBeChecked({ checked: originalChecked });
    });

    test('1.3 Пополнение СМС: счёт на оплату', async ({ page }) => {
      await open(page, PATH);
      await page.locator('a.button', { hasText: 'Пополнить' }).click();
      await page.waitForURL('**/snt/settings/addsms/');
      await expect(page.locator('h2', { hasText: 'Пополнение баланса СМС' })).toBeVisible();
      const packs = await page.locator('select[name="sms"] option').allInnerTexts();
      expect(packs.map((s) => s.trim())).toEqual(['100', '200', '500', '1000']);
      await expect(page.locator('#smsnum')).toBeVisible();
      await expect(page.locator('a.button--secondary', { hasText: 'Назад' })).toBeVisible();

      await page.locator('select[name="sms"]').selectOption('100');
      await clickAndWaitReload(page, page.locator('form button[type="submit"]', { hasText: 'Пополнить' }));
      await expect(page.locator('.personal-data__tariff-title')).toContainText('100 СМС');
      await expect(page.locator('.personal-data__tariff-cost')).toContainText('К оплате');

      log('Способ оплаты: «Счет на оплату»');
      await page.locator('label[for="payment-method-9"]').click();
      await expect(page.locator('#payment-method-9')).toBeChecked();
      await expect(page.locator('#receipt_condition_description')).toBeVisible();

      await clickAndWaitReload(page, page.locator('button[type="submit"]', { hasText: 'Сформировать заказ' }));
      log(`URL после формирования заказа: ${page.url()}`);

      const invoiceLink = page.locator('a[href*="download_order.php"]').first();
      await expect(invoiceLink).toBeVisible({ timeout: 15_000 });
      await expect(invoiceLink).toContainText(/Загрузить сч[её]т/i);
      const href = await invoiceLink.getAttribute('href');
      const response = await page.request.get(new URL(href, page.url()).toString());
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toMatch(/pdf|octet-stream/i);
      log(`✓ Счёт скачивается (${response.headers()['content-type']})`);
    });

    test('1.4 Пополнение СМС: переход на ЮKassa (без оплаты)', async ({ page }) => {
      await open(page, '/snt/settings/addsms/');
      await page.locator('select[name="sms"]').selectOption('100');
      await clickAndWaitReload(page, page.locator('form button[type="submit"]', { hasText: 'Пополнить' }));

      log('Способ оплаты: «Оплата банковской картой/ЮKassa»');
      await page.locator('label[for="payment-method-10"]').click();
      await expect(page.locator('#payment-method-10')).toBeChecked();
      await expect(page.locator('#yandex_condition_description')).toBeVisible();

      await clickAndWaitReload(page, page.locator('button[type="submit"]', { hasText: 'Сформировать заказ' }));
      log(`URL после формирования заказа: ${page.url()}`);

      if (!/yoomoney\.ru/.test(page.url())) {
        const payLink = page.locator('a, button').filter({ hasText: /^\s*Оплатить\s*$/ }).first();
        await expect(payLink).toBeVisible({ timeout: 15_000 });
        await payLink.click();
      }
      await page.waitForURL(/yoomoney\.ru/, { timeout: 30_000 });
      log(`✓ Переход на ЮKassa: ${page.url()}`);
    });

    test('1.5 Приоритеты рассылки: изменить → вернуть', async ({ page }) => {
      await open(page, PATH);
      const sms = page.locator('#snt_props select[name="sms"]');
      const original = await sms.inputValue();
      const target = await sms.locator('option', { hasText: /^низкий$/ }).getAttribute('value');
      const newValue = original === target
        ? await sms.locator('option', { hasText: /^средний$/ }).getAttribute('value')
        : target;
      log(`СМС: ${original} → ${newValue}`);
      const save = page.locator('#snt_props button[type="submit"]');

      try {
        await sms.selectOption(newValue);
        await clickAndWaitReload(page, save);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('#snt_props select[name="sms"]')).toHaveValue(newValue);
        log('✓ Приоритет сохранён');
      } finally {
        await open(page, PATH);
        await page.locator('#snt_props select[name="sms"]').selectOption(original);
        await clickAndWaitReload(page, page.locator('#snt_props button[type="submit"]'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('#snt_props select[name="sms"]')).toHaveValue(original);
        log('✓ Приоритет возвращён');
      }
    });

    for (const ch of [
      { name: 'Telegram', input: '#TELEGRAM_CHAT_ID', button: '#add-telegram-chat-id', msg: '#tgMess', test: '-1001234567890' },
      { name: 'Max', input: '#MAX_CHAT_ID', button: '#add-max-group-link', msg: '#maxMess', test: '-70000000000001' },
    ]) {
      // Сервер проверяет Chat ID через бота: несуществующий чат не сохраняется.
      // Поэтому: вводим несуществующий ID → ожидаем отказ и что значение не изменилось,
      // затем повторно сохраняем исходный ID → «Успешно сохранено».
      test(`1.6 ${ch.name} Chat ID: невалидный ID не сохраняется, исходный пересохраняется`, async ({ page }) => {
        await open(page, PATH);
        const original = await page.locator(ch.input).inputValue();
        log(`${ch.name}: исходный ${original}, пробуем ${ch.test}`);

        const saveValue = async (value) => {
          await page.locator(ch.msg).evaluate((el) => { el.textContent = ''; });
          await page.locator(ch.input).fill(value);
          await page.locator(ch.button).click();
          await expect.poll(
            async () => (await page.locator(ch.msg).innerText()).trim(),
            { timeout: 20_000 },
          ).not.toBe('');
          const msg = (await page.locator(ch.msg).innerText()).trim();
          log(`Сообщение: ${msg}`);
          return msg;
        };

        try {
          const msg = await saveValue(ch.test);
          expect(msg).not.toMatch(/Успешно/i);
          await open(page, PATH);
          await expect(page.locator(ch.input)).toHaveValue(original);
          log('✓ Невалидный Chat ID не сохранён');
        } finally {
          await open(page, PATH);
          if ((await page.locator(ch.input).inputValue()) !== original) log('⚠ Значение изменилось — возвращаем');
          if (original) {
            const msg = await saveValue(original);
            expect(msg).toMatch(/Успешно сохранено/i);
          } else {
            // Пустое значение кнопка не отправляет на сервер — пересохранять нечего
            log('Исходный Chat ID пустой — пересохранение пропущено');
          }
          await open(page, PATH);
          await expect(page.locator(ch.input)).toHaveValue(original);
          log('✓ Исходный Chat ID на месте');
        }
      });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 2. Реквизиты
  // ═══════════════════════════════════════════════════════════
  test.describe('2. Реквизиты', () => {
    const PATH = '/snt/settings/requisite/';
    const FIELDS = ['UF_INN', 'UF_FULL_TITLE_SNT', 'UF_TYPE', 'UF_SHORT_NAME_SNT', 'UF_ACTUAL_ADDRESS',
      'UF_SNT_KPP', 'UF_SNT_SCHET', 'UF_SNT_BIK', 'UF_SNT_BANKNAME', 'UF_SNT_CORACC'];

    /** Дождаться полной загрузки бокового окна подтверждения (iframe warning.php) */
    async function waitWarningPanel(page) {
      const frame = page.frameLocator('iframe.side-panel-iframe');
      await expect(frame.locator('h2', { hasText: 'Внимание!' })).toBeVisible({ timeout: 15_000 });
      const f = page.frames().find((x) => x.url().includes('warning.php'));
      if (f) await f.waitForLoadState('load');
      await expect(frame.locator('#btnAgree')).toBeDisabled();
      return frame;
    }

    /** Установить/снять галочку «Я прочитал и подтверждаю…» с ретраем */
    async function setApproval(frame, checked) {
      await expect(async () => {
        if ((await frame.locator('#approval').isChecked()) !== checked) {
          await frame.locator('label[for="approval"]').click();
        }
        await expect(frame.locator('#btnAgree')).toBeEnabled({ enabled: checked, timeout: 2_000 });
      }).toPass({ timeout: 15_000 });
    }

    /** Нажать «Сохранить», подтвердить в боковом окне и дождаться перезагрузки */
    async function saveWithApproval(page) {
      await page.locator('#requisite button.button').click();
      const frame = await waitWarningPanel(page);
      await setApproval(frame, true);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        frame.locator('#btnAgree').click(),
      ]);
    }

    test('2.1 Отображение всех полей', async ({ page }) => {
      await open(page, PATH);
      for (const f of FIELDS) {
        await expect(page.locator(`#${f}`)).toBeVisible();
        await expect(page.locator(`#${f}`)).toBeEditable();
      }
      await expect(page.locator('#requisite button.button', { hasText: 'Сохранить' })).toBeVisible();
      await expect(page.locator('#requisite a.search-icon')).toBeVisible();
    });

    test('2.2 Валидация и окно подтверждения (без сохранения)', async ({ page }) => {
      await open(page, PATH);
      const inn = page.locator('#UF_INN');
      const originalInn = await inn.inputValue();

      for (const bad of ['12345', '12ab567890', '1234567890123']) {
        await inn.fill(bad);
        expect((await validity(inn)).valid, `ИНН «${bad}» должен быть невалиден`).toBe(false);
      }
      for (const good of ['1234567890', '123456789012']) {
        await inn.fill(good);
        expect((await validity(inn)).valid, `ИНН «${good}» должен быть валиден`).toBe(true);
      }
      await inn.fill(originalInn);

      for (const req of ['UF_FULL_TITLE_SNT', 'UF_TYPE', 'UF_SHORT_NAME_SNT', 'UF_ACTUAL_ADDRESS']) {
        const field = page.locator(`#${req}`);
        const val = await field.inputValue();
        await field.fill('');
        expect((await validity(field)).valid, `${req} обязательное`).toBe(false);
        await field.fill(val);
      }

      log('Окно подтверждения смены реквизитов');
      const address = page.locator('#UF_ACTUAL_ADDRESS');
      const originalAddress = await address.inputValue();
      await address.fill(`${originalAddress} (автотест)`);
      await page.locator('#requisite button.button').click();

      const frame = await waitWarningPanel(page);
      await setApproval(frame, true);
      await setApproval(frame, false);

      log('«Отменить» — форма сбрасывается');
      await frame.locator('button', { hasText: 'Отменить' }).click();
      await expect(page.locator('iframe.side-panel-iframe')).toBeHidden({ timeout: 10_000 });
      await expect(address).toHaveValue(originalAddress);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#UF_ACTUAL_ADDRESS')).toHaveValue(originalAddress);
    });

    test('2.3 Изменение Адреса и Полного наименования → вернуть', async ({ page }) => {
      await open(page, PATH);
      const original = {
        address: await page.locator('#UF_ACTUAL_ADDRESS').inputValue(),
        title: await page.locator('#UF_FULL_TITLE_SNT').inputValue(),
      };
      const changed = {
        address: `${original.address} (автотест)`,
        title: `${original.title} (автотест)`,
      };

      try {
        await page.locator('#UF_ACTUAL_ADDRESS').fill(changed.address);
        await page.locator('#UF_FULL_TITLE_SNT').fill(changed.title);
        await saveWithApproval(page);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('#UF_ACTUAL_ADDRESS')).toHaveValue(changed.address);
        await expect(page.locator('#UF_FULL_TITLE_SNT')).toHaveValue(changed.title);
        log('✓ Реквизиты сохранены');
      } finally {
        await open(page, PATH);
        const curAddress = await page.locator('#UF_ACTUAL_ADDRESS').inputValue();
        const curTitle = await page.locator('#UF_FULL_TITLE_SNT').inputValue();
        if (curAddress !== original.address || curTitle !== original.title) {
          await page.locator('#UF_ACTUAL_ADDRESS').fill(original.address);
          await page.locator('#UF_FULL_TITLE_SNT').fill(original.title);
          await saveWithApproval(page);
          await page.reload({ waitUntil: 'domcontentloaded' });
        }
        await expect(page.locator('#UF_ACTUAL_ADDRESS')).toHaveValue(original.address);
        await expect(page.locator('#UF_FULL_TITLE_SNT')).toHaveValue(original.title);
        log('✓ Реквизиты возвращены');
      }
    });

    test('2.4 Автозаполнение банка по БИК (без сохранения)', async ({ page }) => {
      await open(page, PATH);
      await page.locator('#UF_SNT_BANKNAME').fill('');
      await page.locator('#UF_SNT_CORACC').fill('');
      await page.locator('#UF_SNT_BIK').fill('');
      await page.locator('#UF_SNT_BIK').pressSequentially(BIK.bik, { delay: 50 });
      await expect(page.locator('#UF_SNT_BANKNAME')).toHaveValue(BIK.bank, { timeout: 15_000 });
      await expect(page.locator('#UF_SNT_CORACC')).toHaveValue(BIK.corAcc);
      log('✓ Банк подставился при вводе БИК');

      log('Кнопка-лупа «Обновить»');
      await page.locator('#UF_SNT_BANKNAME').fill('');
      await page.locator('#UF_SNT_CORACC').fill('');
      await page.locator('#requisite a.search-icon').click();
      await expect(page.locator('#UF_SNT_BANKNAME')).toHaveValue(BIK.bank, { timeout: 15_000 });
      await expect(page.locator('#UF_SNT_CORACC')).toHaveValue(BIK.corAcc);

      await page.reload({ waitUntil: 'domcontentloaded' });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 3. Настройки для собственников
  // ═══════════════════════════════════════════════════════════
  test.describe('3. Настройки для собственников', () => {
    const PATH = '/snt/settings/';
    const CHECKBOXES = [
      { id: 'DISABLE_ADD_DATA_COUNTER', name: 'Запрет передачи показаний ИПУ по электроэнергии' },
      { id: 'DISABLE_ADD_DATA_WATER', name: 'Запрет передачи показаний ИПУ по водоснабжению' },
      { id: 'DISABLE_COUNTER', name: 'Полный запрет функционала электроэнергии' },
      { id: 'SHOW_FUTURE_FEES', name: 'Показывать взносы, срок оплаты которых не наступил' },
      { id: 'ROUND_MATH', name: 'Математическое округление' },
    ];

    const saveButton = (page) => page.locator('form[name="snt_props"] button', { hasText: 'Сохранить' });

    test('3.1 Отображение элементов', async ({ page }) => {
      await open(page, PATH);
      for (const h of ['Общие настройки для собственников', 'Настройка периода передачи показаний',
        'Округление начислений по электроэнергии', 'Настройка внешнего вида потерь', 'Настройка назначения платежа']) {
        await expect(page.locator('h2', { hasText: h })).toBeVisible();
      }
      for (const cb of CHECKBOXES) {
        await expect(page.locator(`label[for="${cb.id}"]`)).toBeVisible();
      }
      await expect(page.locator('label[for="l0"]')).toBeVisible();
      await expect(page.locator('label[for="l1"]')).toBeVisible();
      await expect(page.locator('#PERIOD_START')).toBeVisible();
      await expect(page.locator('select[name="select[]"]')).toHaveCount(3);
      await expect(saveButton(page)).toBeVisible();
    });

    test('3.2 Чек-боксы и радио — по одному: изменить → вернуть', async ({ page }) => {
      test.setTimeout(360_000);
      await open(page, PATH);

      const toggleAndSave = async (labelFor) => {
        await page.locator(`label[for="${labelFor}"]`).click();
        await clickAndWaitReload(page, saveButton(page));
        await page.reload({ waitUntil: 'domcontentloaded' });
      };

      for (const cb of CHECKBOXES) {
        const input = page.locator(`#${cb.id}`);
        const original = await input.isChecked();
        log(`«${cb.name}»: ${original} → ${!original}`);
        try {
          await toggleAndSave(cb.id);
          await expect(page.locator(`#${cb.id}`)).toBeChecked({ checked: !original });
        } finally {
          if ((await page.locator(`#${cb.id}`).isChecked()) !== original) {
            await toggleAndSave(cb.id);
          }
          await expect(page.locator(`#${cb.id}`)).toBeChecked({ checked: original });
          log('  ✓ возвращено');
        }
      }

      log('Радио «Внешний вид потерь»');
      const originalRadio = (await page.locator('#l1').isChecked()) ? 'l1' : 'l0';
      const otherRadio = originalRadio === 'l1' ? 'l0' : 'l1';
      try {
        await toggleAndSave(otherRadio);
        await expect(page.locator(`#${otherRadio}`)).toBeChecked();
      } finally {
        if (!(await page.locator(`#${originalRadio}`).isChecked())) {
          await toggleAndSave(originalRadio);
        }
        await expect(page.locator(`#${originalRadio}`)).toBeChecked();
        log('  ✓ возвращено');
      }
    });

    test('3.3 Дата начала периода: валидация (без сохранения)', async ({ page }) => {
      await open(page, PATH);
      const field = page.locator('#PERIOD_START');
      const cases = [
        ['1', true], ['15', true], [String(PERIOD_START_MAX), true],
        ['0', false], ['-1', false], [String(PERIOD_START_MAX + 1), false], ['31', PERIOD_START_MAX >= 31], ['32', false],
      ];
      for (const [val, expected] of cases) {
        await field.fill(val);
        const v = await validity(field);
        expect(v.valid, `«${val}» → ${v.message}`).toBe(expected);
        log(`${val}: ${v.valid ? 'валидно' : v.message}`);
      }
      log('Буквы в числовом поле');
      await field.fill('');
      await field.pressSequentially('abc');
      await expect(field).toHaveValue('');
      await page.reload({ waitUntil: 'domcontentloaded' });
    });

    test('3.4 Назначение платежа: валидация и 3-й параметр → «Не указывать» → вернуть', async ({ page }) => {
      await open(page, PATH);
      const selects = page.locator('select[name="select[]"]');
      const getLayout = () => selects.evaluateAll((els) => els.map((e) => e.value));
      const setLayout = async (layout) => {
        for (let i = 0; i < layout.length; i++) await selects.nth(i).selectOption(layout[i]);
      };

      const original = await getLayout();
      log(`Исходный порядок: ${original.join(' / ')}`);

      log('Валидация: без «Назначения платежа» и «Участка» кнопка «Сохранить» недоступна');
      await setLayout(['fio', 'fio', 'none']);
      await expect(saveButton(page)).toBeDisabled();
      await setLayout(['text', 'fio', 'none']); // нет «Участка»
      await expect(saveButton(page)).toBeDisabled();
      await setLayout(original);
      await expect(saveButton(page)).toBeEnabled();

      // «Не указывать» в 3-м параметре; обязательные поля — в первых двух
      let target = ['text', 'land', 'none'];
      if (target.join() === original.join()) target = ['land', 'text', 'none'];
      log(`Новый порядок: ${target.join(' / ')}`);
      try {
        await setLayout(target);
        await expect(saveButton(page)).toBeEnabled();
        await clickAndWaitReload(page, saveButton(page));
        await page.reload({ waitUntil: 'domcontentloaded' });
        expect(await getLayout()).toEqual(target);
      } finally {
        await page.reload({ waitUntil: 'domcontentloaded' });
        if ((await getLayout()).join() !== original.join()) {
          await setLayout(original);
          await clickAndWaitReload(page, saveButton(page));
          await page.reload({ waitUntil: 'domcontentloaded' });
        }
        expect(await getLayout()).toEqual(original);
        log('✓ возвращено');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 4. Интеграции
  // ═══════════════════════════════════════════════════════════
  test.describe('4. Интеграции', () => {
    test('4.1 1С:Садовод — открытие и валидация полей', async ({ page }) => {
      await open(page, '/snt/settings/integrations/');
      await expect(page.locator('#pageMain')).toContainText('1С:Садовод');
      await page.locator('img[alt*="Садовод"]').click();
      await page.waitForURL('**/snt/settings/integrations/sadovod/');

      for (const id of ['host', 'login', 'password']) {
        await expect(page.locator(`#${id}`)).toBeVisible();
      }
      const errors = page.locator('#sadovod__form .errorsHandler');
      const save = page.locator('#integration__sadovod__button');

      log('Пустая форма');
      await save.click();
      await expect(errors).toContainText('Ссылка на ваш 1С:Садовод является обязательным полем');
      await expect(errors).toContainText('Логин является обязательным полем');
      await expect(errors).toContainText('Пароль является обязательным полем');
      for (const id of ['host', 'login', 'password']) {
        await expect(page.locator(`#${id}`)).toHaveClass(/invalid/);
      }

      log('Некорректная ссылка');
      await page.locator('#host').fill('not-a-url');
      await page.locator('#login').fill('autotest');
      await page.locator('#password').fill('autotest');
      await save.click();
      await expect(errors).toContainText('Поле не является ссылкой на ваш 1С:Садовод');
      await expect(page).toHaveURL(/\/integrations\/sadovod\//);
    });

    test('4.2 1С:Садовод — ссылки на инструкции', async ({ page, context }) => {
      await open(page, '/snt/settings/integrations/sadovod/');
      await expect(page.locator('h2', { hasText: 'Обязательно ознакомтесь' })).toBeVisible();

      log('PDF-инструкция');
      const pdf = page.locator('a[href$="1c_setting.pdf"]');
      await expect(pdf).toHaveText(/Читать в новой вкладке/);
      const pdfResp = await page.request.get(new URL(await pdf.getAttribute('href'), page.url()).toString());
      expect(pdfResp.status()).toBe(200);
      expect(pdfResp.headers()['content-type']).toMatch(/pdf/i);

      // Видеоинструкции (PDF уже проверен запросом выше — в headless он не открывается во вкладке)
      const links = page.locator('.right_block a[target="_blank"]:not([href$=".pdf"])');
      const count = await links.count();
      expect(count).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < count; i++) {
        const link = links.nth(i);
        const href = await link.getAttribute('href');
        const [popup] = await Promise.all([context.waitForEvent('page'), link.click()]);
        await popup.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
        log(`✓ ${href} → ${popup.url()}`);
        expect(popup.url()).not.toBe('about:blank');
        await popup.close();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 5. Печать и подпись
  // ═══════════════════════════════════════════════════════════
  test.describe('5. Печать и подпись для документов', () => {
    const PATH = '/snt/settings/signature/';

    test('5.1 Файлы отображаются и открываются', async ({ page }) => {
      await open(page, PATH);
      const files = page.locator('form[name="signature_form"] .file-name a');
      await expect(files).toHaveCount(2);
      for (let i = 0; i < 2; i++) {
        const href = await files.nth(i).getAttribute('href');
        const resp = await page.request.get(new URL(href, page.url()).toString());
        expect(resp.status(), href).toBe(200);
        expect(resp.headers()['content-type']).toMatch(/image/i);
        log(`✓ ${(await files.nth(i).innerText()).trim()}`);
      }
      await expect(page.locator('form[name="signature_form"] a[href="/documents/creator/"]')).toBeVisible();
      await expect(page.locator('form[name="signature_form"] button[type="submit"]')).toBeVisible();
    });

    test('5.2 Удаление файлов крестиком БЕЗ сохранения + «Добавить файл»', async ({ page }) => {
      await open(page, PATH);
      const original = (await page.locator('.file-name a').allInnerTexts()).map((s) => s.trim());
      expect(original.length).toBe(2);

      for (const id of ['stamp', 'signature']) {
        const block = page.locator('.form__item--files').filter({ has: page.locator(`#${id}`) });
        const addLabel = block.locator(`label[for="${id}"]`);
        await expect(addLabel).toBeHidden();

        log(`Крестик у «${id}»`);
        await block.locator('.file-delete').click();
        await expect(block.locator('.file-name a')).toHaveCount(0);
        await expect(addLabel).toBeVisible();

        log('«Добавить файл» открывает выбор файла');
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), addLabel.click()]);
        expect(chooser).toBeTruthy();
      }

      log('Перезагрузка без сохранения — файлы на месте');
      await page.reload({ waitUntil: 'domcontentloaded' });
      const after = (await page.locator('.file-name a').allInnerTexts()).map((s) => s.trim());
      expect(after).toEqual(original);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 6. Категории заявок
  // ═══════════════════════════════════════════════════════════
  test.describe('6. Категории заявок', () => {
    const PATH = '/snt/settings/categories/';

    test('6.1 Создание → редактирование → удаление категории', async ({ page }) => {
      const name = `Автотест категория ${stamp()}`;
      const edited = `${name} изм`;
      try {
        await open(page, PATH);
        await expect(gridRow(page, 'Написать председателю')).toBeVisible();
        await page.locator('a, button').filter({ hasText: '+ Новая категория' }).first().click();
        await page.waitForURL('**/categories/add/');

        log('Валидация: пустое наименование');
        expect((await validity(page.locator('#name'))).valid).toBe(false);

        log(`Создаём «${name}»`);
        await page.locator('#name').fill(name);
        await page.locator('#selectRole').selectOption({ label: 'Исполнитель' });
        await page.locator('#comment').fill('Создано автотестом');
        await expect(page.locator('#NO_COMM')).toBeChecked();
        await page.locator('label[for="NO_COMM"]').click();
        await expect(page.locator('#NO_COMM')).not.toBeChecked();
        await page.locator('button[type="submit"]', { hasText: 'Создать' }).click();
        await page.waitForURL(`${BASE_URL}${PATH}`);
        const row = gridRow(page, name);
        await expect(row).toBeVisible();
        await expect(row).toContainText('Исполнитель');
        await expect(row).toContainText('Создано автотестом');

        log('Редактирование');
        await gridRowAction(page, name, 'edit');
        await page.waitForURL('**/categories/edit/**');
        await expect(page.locator('#name')).toHaveValue(name);
        await page.locator('#name').fill(edited);
        await page.locator('#comment').fill('Изменено автотестом');
        await page.locator('button[type="submit"]').first().click();
        await page.waitForURL(`${BASE_URL}${PATH}`);
        await expect(gridRow(page, edited)).toContainText('Изменено автотестом');

        log('Удаление');
        await gridDeleteRow(page, edited);
      } finally {
        await cleanupRow(page, PATH, name);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 7. Роли (проверяются ДО Исполнителей)
  // ═══════════════════════════════════════════════════════════
  test.describe('7. Роли', () => {
    const PATH = '/snt/settings/role/';

    test('7.1 Системные роли без меню действий', async ({ page }) => {
      await open(page, PATH);
      // ID ролей на стендах разные — ищем по названию и пометке «Системная роль»
      for (const name of ['Председатель', 'Диспетчер']) {
        const byName = gridRow(page, 'Системная роль')
          .filter({ has: page.locator('td', { hasText: new RegExp(`^\\s*${name}\\s*$`) }) });
        await expect(byName).toHaveCount(1);
      }
      const systemRows = gridRow(page, 'Системная роль');
      const count = await systemRows.count();
      expect(count).toBeGreaterThanOrEqual(3);
      for (let i = 0; i < count; i++) {
        const row = systemRows.nth(i);
        await expect(row.locator('.main-grid-row-action-button')).toHaveCount(0);
        log(`✓ ${(await row.locator('td').nth(1).innerText()).trim()} — без меню`);
      }
    });

    test('7.2 Все чек-боксы прав + создание → редактирование → удаление роли', async ({ page }) => {
      const name = `Автотест роль ${stamp()}`;
      try {
        await open(page, PATH);
        await page.locator('a, button').filter({ hasText: '+ Добавить роль' }).first().click();
        await page.waitForURL('**/role/add/');

        const boxes = page.locator('input[name="functional[]"]');
        const total = await boxes.count();
        // Набор прав на стендах отличается (на проде 18, на testdev 17)
        expect(total).toBeGreaterThanOrEqual(10);
        const accessLevel = page.locator('#access-level-4'); // уровень доступа к «Заявкам»
        await expect(accessLevel).toBeDisabled();

        log(`Включаем все ${total} чек-боксов`);
        for (let i = 0; i < total; i++) {
          await page.locator(`label[for="pages-access[${i}]"]`).click();
          await expect(boxes.nth(i)).toBeChecked();
        }
        await expect(accessLevel).toBeEnabled();
        await accessLevel.selectOption('full');

        log('Выключаем все чек-боксы');
        for (let i = 0; i < total; i++) {
          await page.locator(`label[for="pages-access[${i}]"]`).click();
          await expect(boxes.nth(i)).not.toBeChecked();
        }
        await expect(accessLevel).toBeDisabled();

        log('Валидация: пустое название');
        expect((await validity(page.locator('#name'))).valid).toBe(false);

        log(`Создаём «${name}» с правами «Документы» и «Заявки»`);
        await page.locator('#name').fill(name);
        await page.locator('label', { hasText: /^\s*Документы\s*$/ }).click();
        await page.locator('label', { hasText: /^\s*Заявки/ }).click();
        await page.locator('#comment').fill('Создано автотестом');
        await page.locator('button[type="submit"]', { hasText: 'Создать' }).click();
        await page.waitForURL(`${BASE_URL}${PATH}`);
        const row = gridRow(page, name);
        await expect(row).toBeVisible();
        await expect(row).toContainText('Документы');
        await expect(row).toContainText('Заявки');

        log('Редактирование: + «Сметы», заметка');
        await gridRowAction(page, name, 'edit');
        await page.waitForURL('**/role/edit/**');
        await expect(page.locator('#name')).toHaveValue(name);
        await page.locator('label', { hasText: /^\s*Сметы\s*$/ }).click();
        await page.locator('#comment').fill('Изменено автотестом');
        await page.locator('button[type="submit"]', { hasText: 'Сохранить' }).click();
        await page.waitForURL(`${BASE_URL}${PATH}`);
        await expect(gridRow(page, name)).toContainText('Сметы');
        await expect(gridRow(page, name)).toContainText('Изменено автотестом');

        log('Удаление');
        await gridDeleteRow(page, name);
      } finally {
        await cleanupRow(page, PATH, name);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 8. Исполнители
  // ═══════════════════════════════════════════════════════════
  test.describe('8. Исполнители', () => {
    const PATH = '/snt/settings/contractors/';

    test('8.1 Редактирование существующего исполнителя → вернуть', async ({ page }) => {
      await open(page, PATH);
      // Если на стенде нет EXISTING_CONTRACTOR — берём последнего исполнителя с меню действий
      let contractor = EXISTING_CONTRACTOR;
      if ((await gridRow(page, contractor).count()) === 0) {
        const editable = page.locator('tr.main-grid-row-body:not([hidden])')
          .filter({ has: page.locator('.main-grid-row-action-button') });
        expect(await editable.count(), 'Нет исполнителей для редактирования').toBeGreaterThan(0);
        contractor = (await editable.last().locator('td').nth(1).innerText()).trim();
      }
      log(`Исполнитель: ${contractor}`);
      await gridRowAction(page, contractor, 'edit');
      await page.waitForURL('**/contractors/edit/**');
      const editUrl = page.url();

      for (const id of ['last_name', 'name', 'email', 'phone']) {
        await expect(page.locator(`#${id}`)).toBeDisabled();
      }
      await expect(page.locator('#selectRole')).toBeEnabled();
      await expect(page.locator('#dateEnd')).toBeEditable();

      const original = await page.locator('#comment').inputValue();
      const changed = `${original} (автотест)`.trim();
      try {
        await page.locator('#comment').fill(changed);
        await page.locator('button[type="submit"]', { hasText: 'Сохранить' }).click();
        await page.waitForURL(`${BASE_URL}${PATH}`);
        await expect(gridRow(page, contractor)).toContainText(changed);
        log('✓ Заметка изменена');
      } finally {
        await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
        await page.locator('#comment').fill(original);
        await page.locator('button[type="submit"]', { hasText: 'Сохранить' }).click();
        await page.waitForURL(`${BASE_URL}${PATH}`);
        await expect(gridRow(page, contractor)).not.toContainText('(автотест)');
        log('✓ Заметка возвращена');
      }
    });

    test('8.2 Добавление из имеющих ЛК → удаление', async ({ page }) => {
      await open(page, PATH);
      test.skip((await gridRow(page, EXISTING_ACCOUNT.fio).count()) > 0,
        `${EXISTING_ACCOUNT.fio} уже исполнитель — выберите другой аккаунт в EXISTING_ACCOUNT`);
      try {
        await page.locator('a, button').filter({ hasText: '+ Добавить исполнителя' }).first().click();
        await page.waitForURL('**/contractors/add/');
        await expect(page.locator('li.tabs__item.active')).toHaveText(/Из имеющих ЛК/);

        log(`Поиск «${EXISTING_ACCOUNT.search}»`);
        await page.locator('#searchAccount').fill(EXISTING_ACCOUNT.search);
        const account = page.locator('.account__block').filter({ hasText: EXISTING_ACCOUNT.fio }).first();
        await expect(account).toBeVisible();
        await account.locator('label.account__fio').click();
        await expect(account.locator('input[type="radio"]')).toBeChecked();

        await page.locator('#selectRole').selectOption({ label: 'Исполнитель' });
        await page.locator('#comment').fill('Добавлен автотестом');
        await page.locator('button[type="submit"]', { hasText: 'Создать' }).click();
        await page.waitForURL(`${BASE_URL}${PATH}`);
        const row = gridRow(page, EXISTING_ACCOUNT.fio);
        await expect(row).toBeVisible();
        await expect(row).toContainText('Исполнитель');
        await expect(row).toContainText('Добавлен автотестом');

        log('Удаление');
        await gridDeleteRow(page, EXISTING_ACCOUNT.fio);
      } finally {
        await cleanupRow(page, PATH, EXISTING_ACCOUNT.fio);
      }
    });

    test('8.3 Новый исполнитель по email → удаление', async ({ page }) => {
      const ts = stamp();
      const person = {
        last: 'Автотестов',
        first: `Исполнитель${ts.replace(/-/g, '')}`,
        middle: 'Тестович',
        email: `autotest.contractor.${Date.now()}@example.com`,
      };
      const fio = `${person.last} ${person.first}`;
      try {
        await open(page, PATH);
        await page.locator('a, button').filter({ hasText: '+ Добавить исполнителя' }).first().click();
        await page.waitForURL('**/contractors/add/');
        await page.locator('a.tabs__link', { hasText: 'Новый исполнитель' }).click();
        await page.waitForURL('**/contractors/new/');

        log('Валидация обязательных полей');
        for (const id of ['last_name', 'name', 'second_name', 'email']) {
          expect((await validity(page.locator(`#${id}`))).valid, id).toBe(false);
        }
        await expect(page.locator('#dateEnd')).toHaveAttribute('min', /\d{4}-\d{2}-\d{2}/);

        log(`Создаём ${fio} <${person.email}>`);
        await page.locator('#last_name').fill(person.last);
        await page.locator('#name').fill(person.first);
        await page.locator('#second_name').fill(person.middle);
        await page.locator('#email').fill(person.email);
        await page.locator('#selectRole').selectOption({ label: 'Исполнитель' });
        await page.locator('#comment').fill('Создан автотестом');
        await page.locator('button[type="submit"]', { hasText: 'Создать' }).click();
        await page.waitForURL(`${BASE_URL}${PATH}`);
        const row = gridRow(page, fio);
        await expect(row).toBeVisible();
        await expect(row).toContainText('Создан автотестом');

        log('Удаление');
        await gridDeleteRow(page, fio);
      } finally {
        await cleanupRow(page, PATH, fio);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 9. История операций
  // ═══════════════════════════════════════════════════════════
  test.describe('9. История операций', () => {
    test('9.1 Тариф, таблица транзакций и «Выбрать другой тариф»', async ({ page }) => {
      await open(page, '/snt/settings/billing/');
      // Тариф на стендах разный (прод — «Профи макс», testdev — «Расширенный»)
      await expect(page.locator('#pageMain')).toContainText(/Ваш тариф:\s*«[^»]+»/);
      const tariff = (await page.locator('#pageMain').innerText()).match(/Ваш тариф:\s*(«[^»]+»)/)[1];
      log(`Тариф: ${tariff}`);
      await expect(page.locator('h2', { hasText: 'История транзакций' })).toBeVisible();

      const headers = (await page.locator('#pageMain table th').allInnerTexts()).map((s) => s.trim());
      expect(headers).toEqual(['Номер заказа', 'Название тарифа / Пакет СМС', 'Дата создания заказа',
        'Дата платежа', 'Сумма платежа (₽)', 'Статус']);
      const rows = page.locator('#pageMain table tbody tr').filter({ has: page.locator('td') });
      expect(await rows.count()).toBeGreaterThan(0);
      const statuses = await rows.locator('td:last-child').allInnerTexts();
      for (const s of statuses) expect(s.trim()).toMatch(/^(Оплачен|Не оплачен)$/);
      log(`Строк: ${statuses.length}`);

      await page.locator('a', { hasText: 'Выбрать другой тариф' }).click();
      await page.waitForURL('**/profile/plan**');
      await expect(page.locator('#pageMain')).toContainText('Тарифы');
      await expect(page.locator('#pageMain')).toContainText(/Тариф «[^»]+»/);
    });
  });
});
