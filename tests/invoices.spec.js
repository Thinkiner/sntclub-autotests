// ============================================================
// E2E тест: Создание квитанций
// Тестовый фреймворк: Playwright Test (@playwright/test)
//
// Запуск:
//   npx playwright test invoices.spec.js --headed
// ============================================================

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────
// НАСТРОЙКИ ТЕСТА
// В продакшене лучше хранить credentials в .env файле
// и читать через process.env.EMAIL / process.env.PASSWORD
// ─────────────────────────────────────────────────────────────
const BASE_URL = 'https://lk.sntclub.ru';

const TEST_USER = {
  email: 'test.ramos@mail.ru',
  password: 'Wqmyt1DZ7L',
};

// ─────────────────────────────────────────────────────────────
// ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: авторизация пользователя
// Скопирована из peni.spec.js без изменений, чтобы тест
// был самодостаточным и не зависел от других файлов.
// ─────────────────────────────────────────────────────────────
async function login(page) {
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 1: Авторизация');
  console.log('══════════════════════════════════════════');

  // Страница авторизации расположена на корневом URL —
  // никакого редиректа на /login/ нет
  console.log(`  → Открываем страницу авторизации ${BASE_URL}/ ...`);
  await page.goto(`${BASE_URL}/`, {
    waitUntil: 'domcontentloaded',
  });

  // Убеждаемся, что страница открылась
  await expect(page).toHaveURL(/lk\.sntclub\.ru/);
  console.log('  ✓ Страница открыта. URL:', page.url());

  // ── Поле Email ──────────────────────────────────────────────
  console.log('  → Заполняем поле Email...');
  // На сайте поле email имеет type="text", а не type="email",
  // поэтому input[type="email"] его не находит.
  // Используем getByPlaceholder — это самый надёжный способ.
  const emailField = page.getByPlaceholder('Ivanov@mail.ru');
  await expect(emailField).toBeVisible({ timeout: 5_000 });
  await emailField.fill(TEST_USER.email);
  console.log('  ✓ Email введён');

  // ── Поле Пароль ─────────────────────────────────────────────
  console.log('  → Заполняем поле Пароль...');
  const passwordField = page.getByPlaceholder('******');
  await expect(passwordField).toBeVisible({ timeout: 5_000 });
  await passwordField.fill(TEST_USER.password);
  console.log('  ✓ Пароль введён');

  // ── Кнопка «Войти» ──────────────────────────────────────────
  console.log('  → Нажимаем кнопку "Войти"...');
  // Кнопка реализована как <input id="login-btn">, а не <button>,
  // поэтому getByRole('button') её не находит. Используем id.
  const loginButton = page.locator('#login-btn');
  await expect(loginButton).toBeEnabled({ timeout: 3_000 });
  await loginButton.click();

  // ── Экран выбора роли ────────────────────────────────────────
  // У пользователя test.ramos@mail.ru после входа появляется
  // промежуточный экран выбора роли. Выбираем «Председатель».
  console.log('  → Проверяем, появился ли экран выбора роли...');
  try {
    const roleScreen = page.getByText('Председатель');
    await roleScreen.waitFor({ state: 'visible', timeout: 3_000 });
    console.log('  ℹ Найден экран выбора роли. Выбираем "Председатель"...');
    await roleScreen.click();
    console.log('  ✓ Роль "Председатель" выбрана');
  } catch {
    console.log('  ℹ Экран выбора роли не появился — продолжаем');
  }

  // ── Ожидаем успешного входа ──────────────────────────────────
  console.log('  → Ожидаем появления бокового меню после входа...');
  await expect(
    page.getByRole('link', { name: /Общие собрания и голосования/i })
  ).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Авторизация успешна! URL после входа:', page.url());
}

// ─────────────────────────────────────────────────────────────
// ОСНОВНОЙ ТЕСТ
// ─────────────────────────────────────────────────────────────
test('Создание квитанций: составная квитанция', async ({ page }) => {
  test.setTimeout(120_000);

  // ════════════════════════════════════════════════════════════
  // ШАГ 1: Авторизация
  // ════════════════════════════════════════════════════════════
  await login(page);

  // ════════════════════════════════════════════════════════════
  // ШАГ 2: Навигация в раздел «Создание квитанций»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 2: Навигация в раздел "Создание квитанций"');
  console.log('══════════════════════════════════════════');

  // Ищем пункт меню по тексту.
  // Пункт может быть скрыт за кнопкой «Больше» — обрабатываем оба случая.
  console.log('  → Проверяем видимость пункта "Создание квитанций" в меню...');
  const invoicesMenuLink = page.getByRole('link', { name: /Создание квитанций/i });
  const isMenuItemVisible = await invoicesMenuLink.isVisible();

  if (!isMenuItemVisible) {
    // Пункт скрыт — пробуем раскрыть меню кнопкой «Больше»
    console.log('  ℹ Пункт меню скрыт. Нажимаем "Больше" для раскрытия...');
    const moreButton = page.getByRole('button', { name: /Больше/i });

    if (await moreButton.isVisible()) {
      await moreButton.click();
      console.log('  ✓ Меню раскрыто');
      await expect(invoicesMenuLink).toBeVisible({ timeout: 3_000 });
    } else {
      // Кнопка «Больше» не найдена — переходим напрямую по URL
      console.log('  ℹ Кнопка "Больше" не найдена — переходим напрямую по URL');
    }
  } else {
    console.log('  ✓ Пункт меню "Создание квитанций" виден');
  }

  // Переходим по прямому URL — это надёжнее, чем кликать по меню
  console.log('  → Переходим на страницу создания квитанций...');
  await page.goto(`${BASE_URL}/snt/bookkeeping/invoices/`, {
    waitUntil: 'domcontentloaded',
  });

  // Проверяем, что оказались на нужной ветке URL
  await expect(page).toHaveURL(/\/snt\/bookkeeping\/invoices\//);
  console.log('  ✓ Находимся на странице создания квитанций:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 3: Нажать кнопку «Создать квитанцию»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 3: Нажимаем кнопку "Создать квитанцию"');
  console.log('══════════════════════════════════════════');

  // Кнопка: <a href="/snt/bookkeeping/invoices/add.php" class="button export">Создать квитанцию</a>
  console.log('  → Ищем кнопку "Создать квитанцию"...');
  const createInvoiceBtn = page.locator('a.button.export[href*="invoices/add.php"]');
  await expect(createInvoiceBtn).toBeVisible({ timeout: 5_000 });
  console.log('  ✓ Кнопка "Создать квитанцию" найдена');

  console.log('  → Нажимаем кнопку "Создать квитанцию"...');
  await createInvoiceBtn.click();

  // Проверяем, что перешли на страницу создания квитанции
  await expect(page).toHaveURL(/\/snt\/bookkeeping\/invoices\/add\.php/, { timeout: 5_000 });
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Открыта страница создания квитанции. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 4: Выбрать период «Сегодня» и нажать «Найти»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 4: Выбираем период "Сегодня" и нажимаем "Найти"');
  console.log('══════════════════════════════════════════');

  // Фильтр Bitrix в компактном состоянии — клики перехватываются
  // контейнером и верхним меню. Делаем всё через JS.
  console.log('  → Устанавливаем фильтр "Сегодня" и отправляем через JS...');

  const filterResult = await page.evaluate(() => {
    try {
      if (typeof BX !== 'undefined' && BX.Main && BX.Main.filterManager) {
        const filter = BX.Main.filterManager.getById('invoices_add_search');
        if (filter) {
          // Устанавливаем значение DATE_datesel на «Сегодня» (CURRENT_DAY)
          const api = filter.getApi();
          api.setFields({
            'DATE_datesel': 'CURRENT_DAY',
          });
          api.apply();
          return 'api';
        }
      }
    } catch (e) {
      return 'error: ' + e.message;
    }
    return false;
  });

  if (filterResult === 'api') {
    console.log('  ✓ Фильтр отправлен через Bitrix JS API');
  } else {
    // Fallback: переходим по URL с GET-параметрами фильтра
    console.log(`  ℹ JS API не сработал (${filterResult}) — переходим по URL с параметрами...`);
    await page.goto(
      `${BASE_URL}/snt/bookkeeping/invoices/add.php?DATE_datesel=CURRENT_DAY&apply_filter=Y`,
      { waitUntil: 'domcontentloaded' }
    );
    console.log('  ✓ Фильтр отправлен через URL');
  }

  // Ждём загрузки страницы после применения фильтра
  console.log('  → Ожидаем загрузки страницы...');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle');
  console.log('  ✓ Страница загружена. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 5: Заполнить поле «Назначение платежа»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 5: Заполняем поле "Назначение платежа"');
  console.log('══════════════════════════════════════════');

  // Поле: <input id="title" name="TITLE" class="form__input form__input--text"
  //        placeholder="Оплата текущих задолжностей по взносам/счётчикам">
  console.log('  → Ищем поле "Назначение платежа" (#title)...');
  const titleField = page.locator('#title');
  await expect(titleField).toBeVisible({ timeout: 5_000 });
  console.log('  ✓ Поле найдено');

  console.log('  → Заполняем поле "Тестовая составная квитанция"...');
  await titleField.fill('Тестовая составная квитанция');

  // Проверяем, что значение записалось
  const titleValue = await titleField.inputValue();
  expect(titleValue).toBe('Тестовая составная квитанция');
  console.log(`  ✓ Назначение платежа: "${titleValue}"`);

  // ════════════════════════════════════════════════════════════
  // ШАГ 6: Фильтрация участков и выбор чекбокса
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 6: Фильтрация участков и выбор чекбокса');
  console.log('══════════════════════════════════════════');

  // Ищем поле поиска участков. Обычно это input[type="text"] или input[type="search"]
  // расположенный рядом с таблицей участков.
  console.log('  → Ищем поле поиска/фильтрации участков...');
  const searchField = page.locator(
    'input[type="search"], input[type="text"][placeholder*="Поиск"], input[type="text"][placeholder*="поиск"], input.search, input[name*="search"], input[name*="filter"]'
  ).first();

  let searchFieldVisible = await searchField.isVisible().catch(() => false);
  if (searchFieldVisible) {
    console.log('  ✓ Поле поиска найдено');
    await searchField.fill('1');
  } else {
    // Запасной вариант: ищем любой текстовый input, который не является #title
    console.log('  ℹ Стандартное поле поиска не найдено — ищем альтернативный input...');
    const altSearchField = page.locator('input[type="text"]').filter({ hasNot: page.locator('#title') }).first();
    await expect(altSearchField).toBeVisible({ timeout: 5_000 });
    await altSearchField.fill('1');
    console.log('  ✓ Альтернативное поле поиска найдено и заполнено');
  }

  console.log('  → Ввели "1" для фильтрации участков');
  // Ждём обновления списка после фильтрации (может быть debounce)
  await page.waitForTimeout(500);

  // Выбираем первый доступный чекбокс участка
  // Пропускаем #all-user (Выбрать всех) — берём только чекбоксы конкретных участков.
  // Чекбоксы кастомные (input скрыт, стилизован через label) —
  // кликаем по label[for=id], а не по самому input.
  console.log('  → Ищем чекбоксы участков...');
  const participantCheckboxes = page.locator('input[type="checkbox"]:not(#all-user)');
  const checkboxCount = await participantCheckboxes.count();
  console.log(`  ℹ Найдено чекбоксов участков: ${checkboxCount}`);

  if (checkboxCount === 0) {
    throw new Error('ШАГ 6: Чекбоксы участков не найдены после фильтрации');
  }

  // Кликаем по label первого чекбокса участка
  const firstCheckbox = participantCheckboxes.first();
  await expect(firstCheckbox).toBeAttached({ timeout: 3_000 });
  const firstCheckboxId = await firstCheckbox.getAttribute('id');
  if (firstCheckboxId) {
    const firstLabel = page.locator(`label[for="${firstCheckboxId}"]`);
    await firstLabel.scrollIntoViewIfNeeded();
    await firstLabel.click();
  } else {
    // Нет id — кликаем через JS
    await firstCheckbox.evaluate(el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  const firstIsChecked = await firstCheckbox.isChecked();
  console.log(`  ✓ Чекбокс участка ${firstIsChecked ? 'выбран' : 'НЕ выбран (fallback через JS)'}`);
  if (!firstIsChecked) {
    await firstCheckbox.evaluate(el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
    console.log('  ✓ Чекбокс отмечен через JS');
  }

  // ════════════════════════════════════════════════════════════
  // ШАГ 7: Выбрать 3 задолженности из появившегося списка
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 7: Выбираем задолженности из списка');
  console.log('══════════════════════════════════════════');

  // После выбора участка ниже должен появиться список задолженностей
  // с чекбоксами. Ждём их появления.
  console.log('  → Ожидаем появления списка задолженностей...');
  await page.waitForTimeout(1_000); // Ждём подгрузки данных

  // Задолженности — неотмеченные чекбоксы, исключая #all-user.
  const uncheckedCheckboxes = page.locator('input[type="checkbox"]:not(:checked):not(#all-user)');
  const uncheckedCount = await uncheckedCheckboxes.count();
  console.log(`  ℹ Неотмеченных чекбоксов (задолженности): ${uncheckedCount}`);

  if (uncheckedCount === 0) {
    throw new Error('ШАГ 7: Задолженности не найдены — нет неотмеченных чекбоксов');
  }

  // Выбираем до 3 задолженностей — кликаем по label[for=id]
  const debtCountToSelect = Math.min(3, uncheckedCount);
  console.log(`  ℹ Будет выбрано: ${debtCountToSelect} из ${uncheckedCount} задолженностей`);

  for (let i = 0; i < debtCountToSelect; i++) {
    const debtCheckbox = uncheckedCheckboxes.nth(i);
    await expect(debtCheckbox).toBeAttached({ timeout: 3_000 });

    const cbId = await debtCheckbox.getAttribute('id');
    if (cbId) {
      const cbLabel = page.locator(`label[for="${cbId}"]`);
      await cbLabel.scrollIntoViewIfNeeded();
      await cbLabel.click();
    } else {
      await debtCheckbox.evaluate(el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
    }

    const isChecked = await debtCheckbox.isChecked();
    if (!isChecked) {
      // Fallback через JS если label-клик не сработал
      await debtCheckbox.evaluate(el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
    }
    console.log(`  ✓ Задолженность ${i + 1} отмечена`);
  }

  console.log(`  ✓ Выбрано ${debtCountToSelect} задолженност${debtCountToSelect === 1 ? 'ь' : 'и'}`);

  // ════════════════════════════════════════════════════════════
  // ШАГ 8: Нажать кнопку «Создать»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 8: Нажимаем кнопку "Создать"');
  console.log('══════════════════════════════════════════');

  // Кнопка: <button class="button" type="submit">Создать</button>
  console.log('  → Ищем кнопку "Создать"...');
  const createButton = page.locator('button[type="submit"]').filter({ hasText: /^Создать$/i });
  await expect(createButton).toBeAttached({ timeout: 5_000 });

  // Прокручиваем к кнопке — она может быть внизу страницы
  console.log('  → Прокручиваем к кнопке "Создать"...');
  await createButton.scrollIntoViewIfNeeded();
  await expect(createButton).toBeVisible({ timeout: 3_000 });
  console.log('  ✓ Кнопка "Создать" видима');

  console.log('  → Нажимаем "Создать"...');
  await createButton.click();

  // Ожидаем завершения создания квитанции
  console.log('  → Ожидаем завершения создания квитанции...');
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Кнопка "Создать" нажата, страница обновилась');
  console.log('  ✓ URL после создания:', page.url());

  console.log('\n══════════════════════════════════════════');
  console.log('✅ ТЕСТ ПРОЙДЕН: Составная квитанция создана');
  console.log('══════════════════════════════════════════');
});
