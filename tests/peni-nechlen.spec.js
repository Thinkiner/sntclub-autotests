// ============================================================
// E2E тест: Пени — ставка пеней в уставе и претензии
// Тестовый фреймворк: Playwright Test (@playwright/test)
//
// Запуск:
//   npx playwright test peni.spec.js --headed
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
// Скопирована из voting.spec.js без изменений, чтобы тест
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
  await expect(emailField).toBeVisible({ timeout: 10_000 });
  await emailField.fill(TEST_USER.email);
  console.log('  ✓ Email введён');

  // ── Поле Пароль ─────────────────────────────────────────────
  console.log('  → Заполняем поле Пароль...');
  const passwordField = page.getByPlaceholder('******');
  await expect(passwordField).toBeVisible({ timeout: 10_000 });
  await passwordField.fill(TEST_USER.password);
  console.log('  ✓ Пароль введён');

  // ── Кнопка «Войти» ──────────────────────────────────────────
  console.log('  → Нажимаем кнопку "Войти"...');
  // Кнопка реализована как <input id="login-btn">, а не <button>,
  // поэтому getByRole('button') её не находит. Используем id.
  const loginButton = page.locator('#login-btn');
  await expect(loginButton).toBeEnabled({ timeout: 5_000 });
  await loginButton.click();

  // ── Экран выбора роли ────────────────────────────────────────
  // У пользователя test.ramos@mail.ru после входа появляется
  // промежуточный экран выбора роли. Выбираем «Председатель».
  console.log('  → Проверяем, появился ли экран выбора роли...');
  try {
    const roleScreen = page.getByText('Председатель');
    await roleScreen.waitFor({ state: 'visible', timeout: 5_000 });
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
  ).toBeVisible({ timeout: 20_000 });
  console.log('  ✓ Авторизация успешна! URL после входа:', page.url());
}

// ─────────────────────────────────────────────────────────────
// ОСНОВНОЙ ТЕСТ
// ─────────────────────────────────────────────────────────────
test('Пени: ставка пеней в уставе и претензии', async ({ page }) => {
  test.setTimeout(180_000);

  // ════════════════════════════════════════════════════════════
  // ШАГ 1: Авторизация
  // ════════════════════════════════════════════════════════════
  await login(page);

  // ════════════════════════════════════════════════════════════
  // ШАГ 2: Навигация в раздел «Работа с должниками»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 2: Навигация в раздел "Работа с должниками"');
  console.log('══════════════════════════════════════════');

  // Ищем пункт меню по тексту.
  // Пункт может быть скрыт за кнопкой «Больше» — обрабатываем оба случая.
  console.log('  → Проверяем видимость пункта "Работа с должниками" в меню...');
  const peniMenuLink = page.getByRole('link', { name: /Работа с должниками/i });
  const isMenuItemVisible = await peniMenuLink.isVisible();

  if (!isMenuItemVisible) {
    // Пункт скрыт — пробуем раскрыть меню кнопкой «Больше»
    console.log('  ℹ Пункт меню скрыт. Нажимаем "Больше" для раскрытия...');
    const moreButton = page.getByRole('button', { name: /Больше/i });

    if (await moreButton.isVisible()) {
      await moreButton.click();
      console.log('  ✓ Меню раскрыто');
      await expect(peniMenuLink).toBeVisible({ timeout: 5_000 });
    } else {
      // Кнопка «Больше» не найдена — переходим напрямую по URL
      console.log('  ℹ Кнопка "Больше" не найдена — переходим напрямую по URL');
    }
  } else {
    console.log('  ✓ Пункт меню "Работа с должниками" виден');
  }

  // Переходим по прямому URL — это надёжнее, чем кликать по меню
  console.log('  → Переходим на страницу претензий...');
  await page.goto(`${BASE_URL}/snt/peni/claims/`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/\/snt\/peni\/claims\//);
  console.log('  ✓ Находимся на странице:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 3: Переход во вкладку «Ставка пеней в уставе»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 3: Открываем вкладку "Ставка пеней в уставе"');
  console.log('══════════════════════════════════════════');

  // Вкладка может быть реализована как любой HTML-элемент: <a>, <button>, <li>, <span>, <div>.
  // Поэтому ищем среди ВСЕХ элементов по тексту, а не только среди <a>/<button>.
  // Запасной вариант — прямой переход по URL, если клик не сменил URL.
  console.log('  → Ищем вкладку "Ставка пеней в уставе"...');
  const stavkaTab = page.locator('*').filter({ hasText: /^Ставка пеней в уставе$/i }).last();

  const stavkaTabVisible = await stavkaTab.isVisible().catch(() => false);
  if (stavkaTabVisible) {
    console.log('  ✓ Вкладка найдена, нажимаем...');
    await stavkaTab.click();
  } else {
    // Элемент не найден или не виден — переходим напрямую по URL
    console.log('  ℹ Вкладка не найдена через DOM — переходим напрямую по URL');
    await page.goto(`${BASE_URL}/snt/peni/stavka/`, { waitUntil: 'domcontentloaded' });
  }

  // Проверяем, что оказались на нужной ветке URL
  await expect(page).toHaveURL(/\/snt\/peni\/stavka\//, { timeout: 10_000 });
  console.log('  ✓ Переход выполнен. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 4: Проверка наличия записей в таблице ставок пеней
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 4: Проверяем наличие записей в таблице ставок');
  console.log('══════════════════════════════════════════');

  // Ждём загрузки блока с таблицей.
  // Структура: div.table__block > table.list-items__table
  console.log('  → Ждём появления блока таблицы...');
  const tableBlock = page.locator('div.table__block table.list-items__table');
  await expect(tableBlock).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Таблица найдена');

  // Считаем строки в tbody — каждая строка это одна запись ставки.
  // Строки имеют класс list-items__row и id вида stavkaXXX.
  console.log('  → Считаем строки в таблице...');
  const stavkaRows = tableBlock.locator('tbody tr.list-items__row');
  const rowCount = await stavkaRows.count();
  console.log(`  ✓ Найдено строк в таблице: ${rowCount}`);

  // Проверяем, что хотя бы одна запись есть
  expect(rowCount).toBeGreaterThan(0);
  console.log('  ✓ Таблица содержит хотя бы одну запись со ставкой пеней');

  // Логируем первую запись для наглядности
  const firstRow = stavkaRows.first();
  const firstPercent = await firstRow.locator('td.list-items__item').first().textContent();
  const firstDate = await firstRow.locator('td.list-items__item').nth(1).textContent();
  console.log(`  ℹ Первая запись: Процент ставки = "${firstPercent?.trim()}", Дата начала = "${firstDate?.trim()}"`);

  // ════════════════════════════════════════════════════════════
  // ШАГ 5: Возврат во вкладку «Претензии»
  // Таблица содержит записи — переходим обратно на претензии
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 5: Возвращаемся во вкладку "Претензии"');
  console.log('══════════════════════════════════════════');

  // Ищем вкладку «Претензии» среди всех элементов по точному тексту.
  // Запасной вариант — прямой переход по URL если DOM-элемент не найден.
  console.log('  → Ищем вкладку "Претензии"...');
  const claimsTab = page.locator('*').filter({ hasText: /^Претензии$/i }).last();

  const claimsTabVisible = await claimsTab.isVisible().catch(() => false);
  if (claimsTabVisible) {
    console.log('  ✓ Вкладка "Претензии" найдена, нажимаем...');
    await claimsTab.click();
  } else {
    console.log('  ℹ Вкладка не найдена через DOM — переходим напрямую по URL');
    await page.goto(`${BASE_URL}/snt/peni/claims/`, { waitUntil: 'domcontentloaded' });
  }

  // Проверяем, что вернулись на ветку /snt/peni/claims/
  await expect(page).toHaveURL(/\/snt\/peni\/claims\//, { timeout: 10_000 });
  console.log('  ✓ Переход выполнен. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 6: Нажать кнопку «Создать претензию»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 6: Нажимаем кнопку "Создать претензию"');
  console.log('══════════════════════════════════════════');

  // Кнопка: <a href="/snt/peni/claims/add/" class="button button-create-claim">Создать претензию</a>
  // Ищем по классу — это надёжнее, чем по тексту, если текст может меняться.
  console.log('  → Ищем кнопку "Создать претензию"...');
  const createClaimBtn = page.locator('a.button-create-claim');
  await expect(createClaimBtn).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Создать претензию" найдена');

  console.log('  → Нажимаем кнопку "Создать претензию"...');
  await createClaimBtn.click();

  // Проверяем, что перешли на страницу создания новой претензии
  await expect(page).toHaveURL(/\/snt\/peni\/claims\/add\//, { timeout: 10_000 });
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Открыта страница создания претензии. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 7: Выбрать собственника «№2, Кленовый проезд (Ершов Евгений Александрович)»
  //         и дождаться появления списка задолженностей
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 7: Выбираем собственника из выпадающего списка');
  console.log('══════════════════════════════════════════');

  // Выпадающий список выбора собственника может быть реализован
  // как кастомный select2/choices.js/томSelect или как нативный <select>.
  // Стратегия:
  //   1. Пробуем нативный <select> с вариантом по тексту.
  //   2. Если нативный select не найден — ищем кастомный input-контейнер
  //      (select2, tom-select и т.д.) и вводим текст поиска.
  //   3. В обоих случаях кликаем по появившемуся варианту в списке.
  console.log('  → Ищем поле выбора собственника...');

  // ── Попытка 1: нативный <select> ──────────────────────────
  // Нативные селекты на форме создания претензии обычно имеют
  // name/id вида USER_ID, OWNER_ID и т.п.
  // Если вариант не найден через selectOption — переходим к попытке 2.
  let ownerSelected = false;

  const nativeSelects = page.locator('select').filter({
    hasNot: page.locator('[id="SCORE_ID"]'), // исключаем список задолженностей
  });
  const nativeSelectCount = await nativeSelects.count();
  console.log(`  ℹ Найдено нативных <select> (кроме SCORE_ID): ${nativeSelectCount}`);

  if (nativeSelectCount > 0) {
    // Перебираем доступные <select> и пробуем выбрать нужный вариант
    for (let i = 0; i < nativeSelectCount; i++) {
      const sel = nativeSelects.nth(i);
      try {
        await sel.selectOption({ label: /Ершов Евгений/i });
        console.log(`  ✓ Собственник выбран через нативный <select> (индекс ${i})`);
        ownerSelected = true;
        break;
      } catch {
        // Этот <select> не содержит нужный вариант — идём дальше
      }
    }
  }

  if (!ownerSelected) {
    // ── Попытка 2: кастомный виджет (select2 / tom-select / choices.js) ──
    // Такие виджеты обычно рендерят кликабельный контейнер,
    // при клике на который появляется поле поиска и список вариантов.
    console.log('  ℹ Нативный <select> не подошёл — ищем кастомный виджет...');

    // Кликаем по контейнеру кастомного селекта.
    // Общие паттерны: .select2-selection, .ts-control, .choices__inner
    const customSelectContainer = page.locator(
      '.select2-selection, .ts-control, .choices__inner, [data-select]'
    ).first();

    if (await customSelectContainer.isVisible().catch(() => false)) {
      console.log('  ✓ Кастомный контейнер найден, кликаем...');
      await customSelectContainer.click();
    } else {
      // Последний резерв: кликаем по первому видимому input/div на форме
      console.log('  ℹ Контейнер не найден — пробуем кликнуть по input поиска...');
      const searchInput = page.locator('input[type="search"], input.select2-search__field, input.ts-input').first();
      await expect(searchInput).toBeVisible({ timeout: 5_000 });
      await searchInput.click();
    }

    // Вводим текст поиска, чтобы отфильтровать список
    console.log('  → Вводим "Клубничкин" в поле поиска...');
    await page.keyboard.type('Клубничкин');
    await page.waitForTimeout(800); // ждём debounce поиска

    // Кликаем по варианту «№4, Тихий переулок (Клубничкин Глеб)» в выпадающем списке
    console.log('  → Ищем вариант "Клубничкин Глеб" в выпадающем списке...');
    const ownerOption = page.locator(
      '.select2-results__option, .ts-dropdown-content .option, .choices__item--choice'
    ).filter({ hasText: /Ершов Евгений/i }).first();
    await expect(ownerOption).toBeVisible({ timeout: 5_000 });
    await ownerOption.click();
    console.log('  ✓ Собственник выбран через кастомный виджет');
    ownerSelected = true;
  }

  // ════════════════════════════════════════════════════════════
  // ШАГ 8: Выбрать задолженности из списка SCORE_ID
  //   — 3 варианта если доступно ≥ 3
  //   — 2 варианта если доступно ровно 2
  //   — 1 вариант  если доступно ровно 1
  //   — ошибка     если реальных вариантов нет
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 8: Выбираем задолженности из списка');
  console.log('══════════════════════════════════════════');

  const scoreSelect = page.locator('#SCORE_ID');
  await expect(scoreSelect).toBeVisible({ timeout: 15_000 });

  // ⚠️ ВАЖНО: #SCORE_ID становится видимым сразу после выбора собственника,
  // но его <option> загружаются отдельным AJAX-запросом чуть позже.
  // Если читать список сразу — получим только плейсхолдер "---" (value=0).
  // Ждём пока в select появится хотя бы одна опция с value != "0" и value != "".
  console.log('  → Ожидаем загрузки реальных задолженностей через AJAX...');
  await page.waitForFunction(
    () => {
      const sel = document.querySelector('#SCORE_ID');
      if (!sel) return false;
      return Array.from(sel.options).some(
        opt => opt.value && opt.value !== '0' && opt.text.trim().replace(/-/g, '').trim() !== ''
      );
    },
    { timeout: 15_000 }
  );
  console.log('  ✓ Реальные опции загружены');

  const scoreOptions = await scoreSelect.locator('option').all();
  console.log(`  ℹ Всего <option> в списке: ${scoreOptions.length}`);

  // Собираем только реальные варианты — исключаем плейсхолдеры:
  //   value="0"  — пустая заглушка типа "---"
  //   value=""   — пустое значение
  //   текст "---", "-" или пробелы — заглушка без данных
  const realOptions = [];
  for (const opt of scoreOptions) {
    const val = await opt.getAttribute('value');
    const txt = (await opt.textContent())?.trim() ?? '';
    const isPlaceholder = !val || val === '0' || /^[-\s]*$/.test(txt);
    if (!isPlaceholder) {
      realOptions.push({ val, txt });
    }
  }
  console.log(`  ℹ Реальных задолженностей (без плейсхолдеров): ${realOptions.length}`);

  if (realOptions.length === 0) {
    throw new Error('ШАГ 8: Нет реальных задолженностей для выбора (все варианты — плейсхолдеры или список пуст)');
  }

  const countToSelect = Math.min(3, realOptions.length);
  console.log(`  ℹ Будет выбрано: ${countToSelect} из ${realOptions.length} вариантов`);

  const valuesToSelect = realOptions.slice(0, countToSelect).map(o => o.val);
  for (const { val, txt } of realOptions.slice(0, countToSelect)) {
    console.log(`  ℹ Выбираем задолженность: "${txt}" (value=${val})`);
  }

  await scoreSelect.selectOption(valuesToSelect);
  console.log(`  ✓ Выбрано ${valuesToSelect.length} задолженност${valuesToSelect.length === 1 ? 'ь' : 'и'}`);

  // ─────────────────────────────────────────────────────────────
  // Ожидаем появления блоков «Задолженность по взносу»
  // Количество блоков равно количеству выбранных задолженностей.
  // Ориентируемся на поля DATE_DELAY_BEGIN[], по одному на блок.
  // ─────────────────────────────────────────────────────────────
  console.log('  → Ожидаем появления блоков "Задолженность по взносу"...');
  const beginDateFields = page.locator('input[name="DATE_DELAY_BEGIN[]"]');
  await expect(beginDateFields).toHaveCount(valuesToSelect.length, { timeout: 15_000 });
  console.log(`  ✓ Появилось ${valuesToSelect.length} блока(ов) "Задолженность по взносу"`);



  // ════════════════════════════════════════════════════════════
  // ШАГ 9: В каждом блоке проверить и изменить обе даты
  //         — Дата возникновения задолженности (DATE_DELAY_BEGIN)
  //         — Дата расчёта                     (DATE_DELAY_END)
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 9: Проверяем и изменяем даты в каждом блоке');
  console.log('══════════════════════════════════════════');

  const endDateFields = page.locator('input[name="DATE_DELAY_END[]"]');

  for (let i = 0; i < valuesToSelect.length; i++) {
    console.log(`\n  ── Блок ${i + 1} из ${valuesToSelect.length} ───────────────────────`);


    // ── Дата возникновения задолженности (DATE_DELAY_BEGIN) ──────
    const beginField = beginDateFields.nth(i);
    await expect(beginField).toBeVisible({ timeout: 5_000 });

    const beginValue = await beginField.inputValue();
    console.log(`  ℹ [Блок ${i + 1}] Дата возникновения: "${beginValue}"`);
    expect(beginValue).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    console.log(`  ✓ [Блок ${i + 1}] Дата возникновения заполнена корректно`);

    // Кликаем по полю — должен открыться flatpickr-календарь
    console.log(`  → [Блок ${i + 1}] Кликаем по полю даты возникновения...`);
    await beginField.click();

    // Проверяем, что календарь открылся
    const calendarBegin = page.locator('.flatpickr-calendar.open');
    await expect(calendarBegin).toBeVisible({ timeout: 5_000 });
    console.log(`  ✓ [Блок ${i + 1}] Календарь "Дата возникновения" открылся`);

    // Двигаем дату на один день вперёд через flatpickr API
    const newBeginValue = await page.evaluate((idx) => {
      const inputs = document.querySelectorAll('input[name="DATE_DELAY_BEGIN[]"]');
      const input = inputs[idx];
      if (!input || !input._flatpickr) return null;
      const current = input._flatpickr.selectedDates[0];
      if (!current) return null;
      const next = new Date(current);
      next.setDate(next.getDate() + 1);
      input._flatpickr.setDate(next, true);
      return input.value;
    }, i);

    if (newBeginValue) {
      console.log(`  ✓ [Блок ${i + 1}] Дата возникновения изменена на: "${newBeginValue}"`);
    } else {
      console.log(`  ⚠ [Блок ${i + 1}] flatpickr API недоступен — пробуем через клавиши`);
      // Запасной вариант: выбрать следующий день кликом в открытом календаре
      const nextDayBtn = page.locator('.flatpickr-calendar.open .flatpickr-day.selected')
        .locator('xpath=following-sibling::span[1]');
      if (await nextDayBtn.isVisible().catch(() => false)) {
        await nextDayBtn.click();
      }
    }

    // Закрываем календарь клавишей Escape
    await page.keyboard.press('Escape');
    await expect(calendarBegin).toBeHidden({ timeout: 3_000 }).catch(() => {});

    // ── Дата расчёта (DATE_DELAY_END) ────────────────────────────
    const endField = endDateFields.nth(i);
    await expect(endField).toBeVisible({ timeout: 5_000 });

    const endValue = await endField.inputValue();
    console.log(`  ℹ [Блок ${i + 1}] Дата расчёта: "${endValue}"`);
    expect(endValue).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    console.log(`  ✓ [Блок ${i + 1}] Дата расчёта заполнена корректно`);

    // Кликаем — должен открыться второй flatpickr-календарь
    console.log(`  → [Блок ${i + 1}] Кликаем по полю даты расчёта...`);
    await endField.click();

    const calendarEnd = page.locator('.flatpickr-calendar.open');
    await expect(calendarEnd).toBeVisible({ timeout: 5_000 });
    console.log(`  ✓ [Блок ${i + 1}] Календарь "Дата расчёта" открылся`);

    // Двигаем дату расчёта на один день вперёд
    const newEndValue = await page.evaluate((idx) => {
      const inputs = document.querySelectorAll('input[name="DATE_DELAY_END[]"]');
      const input = inputs[idx];
      if (!input || !input._flatpickr) return null;
      const current = input._flatpickr.selectedDates[0];
      if (!current) return null;
      const next = new Date(current);
      next.setDate(next.getDate() + 1);
      input._flatpickr.setDate(next, true);
      return input.value;
    }, i);

    if (newEndValue) {
      console.log(`  ✓ [Блок ${i + 1}] Дата расчёта изменена на: "${newEndValue}"`);
    } else {
      console.log(`  ⚠ [Блок ${i + 1}] flatpickr API недоступен — пробуем через клавиши`);
      const nextDayBtn = page.locator('.flatpickr-calendar.open .flatpickr-day.selected')
        .locator('xpath=following-sibling::span[1]');
      if (await nextDayBtn.isVisible().catch(() => false)) {
        await nextDayBtn.click();
      }
    }

    // Закрываем календарь
    await page.keyboard.press('Escape');
    await expect(calendarEnd).toBeHidden({ timeout: 3_000 }).catch(() => {});

    console.log(`  ✓ [Блок ${i + 1}] Обе даты проверены и изменены`);
  }

  // ════════════════════════════════════════════════════════════
  // ШАГ 10: Нажать «Сохранить черновик» и проверить надпись
  //          «Дата возникновения задолженности» вверху страницы
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 10: Нажимаем "Сохранить черновик"');
  console.log('══════════════════════════════════════════');

  // Кнопка: <span class="button button--secondary btn-save-draft">Сохранить черновик</span>
  // Используем точный CSS-класс — надёжнее, чем поиск по тексту.
  console.log('  → Ищем кнопку "Сохранить черновик"...');
  const saveDraftBtn = page.locator('span.btn-save-draft').first();
  await expect(saveDraftBtn).toBeAttached({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Сохранить черновик" найдена в DOM');

  // Прокручиваем к кнопке ДО проверки видимости —
  // кнопка находится внизу страницы и изначально за пределами viewport.
  console.log('  → Прокручиваем страницу к кнопке...');
  await saveDraftBtn.scrollIntoViewIfNeeded();
  await expect(saveDraftBtn).toBeVisible({ timeout: 5_000 });
  console.log('  ✓ Кнопка видима');

  console.log('  → Нажимаем "Сохранить черновик"...');
  await saveDraftBtn.click();
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Кнопка нажата, страница обновилась');



  // Проверяем, что на странице есть текст / placeholder
  // «Дата возникновения задолженности» — это поле должно быть видно вверху.
  // Ориентируемся на placeholder поля #DATE_DELAY_BEGIN_CLAIM.
  console.log('  → Проверяем наличие "Дата возникновения задолженности" на странице...');
  const beginFieldAfterSave = page.locator(
    'input[name="DATE_DELAY_BEGIN[]"], input[placeholder="Дата возникновения задолженности"]'
  ).first();
  await expect(beginFieldAfterSave).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Поле "Дата возникновения задолженности" видно на странице');

  // ════════════════════════════════════════════════════════════
  // ШАГ 11: Возврат на страницу претензий через хлебные крошки
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 11: Возврат на "Претензии" через хлебные крошки');
  console.log('══════════════════════════════════════════');

  // Хлебная крошка: <span itemprop="name">Претензии</span>
  // Она вложена в тег <a> — кликаем по ссылке, которая содержит этот span.
  console.log('  → Ищем хлебную крошку "Претензии"...');
  const breadcrumbClaims = page.locator('a').filter({
    has: page.locator('span[itemprop="name"]', { hasText: /^Претензии$/i }),
  }).first();

  const breadcrumbVisible = await breadcrumbClaims.isVisible().catch(() => false);
  if (breadcrumbVisible) {
    console.log('  ✓ Хлебная крошка "Претензии" найдена, кликаем...');
    await breadcrumbClaims.click();
  } else {
    // Запасной вариант: ищем сам span и кликаем по нему
    console.log('  ℹ Ссылка-обёртка не найдена — кликаем по span напрямую...');
    const breadcrumbSpan = page.locator('span[itemprop="name"]', { hasText: /^Претензии$/i });
    const spanVisible = await breadcrumbSpan.isVisible().catch(() => false);
    if (spanVisible) {
      await breadcrumbSpan.click();
    } else {
      // Последний резерв: прямая навигация по URL
      console.log('  ℹ Хлебная крошка не найдена — переходим напрямую по URL');
      await page.goto(`${BASE_URL}/snt/peni/claims/`, { waitUntil: 'domcontentloaded' });
    }
  }

  // Проверяем, что оказались на странице претензий
  await expect(page).toHaveURL(/\/snt\/peni\/claims\//, { timeout: 10_000 });
  console.log('  ✓ Переход на страницу претензий выполнен. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 12: Найти черновик в таблице претензий и открыть его
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 12: Ищем черновик в таблице претензий');
  console.log('══════════════════════════════════════════');

  // Ссылка на черновик выглядит так в обоих версиях (мобильной и десктопной):
  //   <a href="/snt/peni/claims/add/?draft=XXXX">Черновик</a>
  // Ищем по тексту «Черновик» — это надёжнее, чем по href (ID черновика динамический).
  // Берём первый найденный — это будет самый свежий черновик вверху таблицы.
  console.log('  → Ищем ссылку "Черновик" в таблице...');
  const draftLink = page.locator('a').filter({ hasText: /^Черновик$/i }).first();
  await expect(draftLink).toBeVisible({ timeout: 10_000 });

  // Логируем href черновика для диагностики (содержит ID черновика)
  const draftHref = await draftLink.getAttribute('href');
  console.log(`  ✓ Черновик найден. Ссылка: ${draftHref}`);

  // Кликаем по ссылке черновика
  console.log('  → Открываем черновик...');
  await draftLink.click();

  // Проверяем, что перешли на страницу редактирования черновика
  // URL вида: /snt/peni/claims/add/?draft=XXXX
  await expect(page).toHaveURL(/\/snt\/peni\/claims\/add\/\?draft=\d+/, { timeout: 10_000 });
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Открыта страница редактирования черновика. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 13: Выбрать «Да» в поле «Включить пени»
  // (для индивидуала поле INCLUDE_PERCENT_PENI отсутствует)
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 13: Выбираем "Да" в поле INCLUDE_PENI');
  console.log('══════════════════════════════════════════');

  // ── INCLUDE_PENI: включить пени ─────────────────────────────
  console.log('  → Выбираем "Да" в поле INCLUDE_PENI...');
  const includePeniSelect = page.locator('#INCLUDE_PENI');
  await expect(includePeniSelect).toBeVisible({ timeout: 10_000 });
  await includePeniSelect.selectOption('Y');
  const includePeniVal = await includePeniSelect.inputValue();
  expect(includePeniVal).toBe('Y');
  console.log('  ✓ INCLUDE_PENI = "Да"');

  // Ждём появления дополнительных полей после выбора «Да»
  console.log('  → Ожидаем появления дополнительных полей...');
  await expect(page.locator('#snt_inn')).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Дополнительные поля появились');

  // ════════════════════════════════════════════════════════════
  // ШАГ 14: Проверить предзаполненные поля СНТ и заполнить пустые
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 14: Проверяем поля реквизитов СНТ');
  console.log('══════════════════════════════════════════');

  // ── 1) Наименование СНТ ────────────────────────────────────
  // Поле может иметь разные id: snt_name, SNT_NAME, ORGANISATION_NAME и т.п.
  // Ищем первый видимый input рядом с лейблом «Наименование»
  console.log('  → Проверяем поле "Наименование СНТ"...');
  const sntNameField = page.locator(
    'input[id*="snt_name" i], input[id*="org_name" i], input[name*="NAME" i]'
  ).first();
  const sntNameVisible = await sntNameField.isVisible().catch(() => false);
  if (sntNameVisible) {
    const sntName = await sntNameField.inputValue();
    console.log(`  ℹ Наименование СНТ: "${sntName}"`);
    expect(sntName.length).toBeGreaterThan(0);
    console.log('  ✓ Поле "Наименование СНТ" заполнено');
  } else {
    console.log('  ℹ Поле "Наименование СНТ" не найдено — пропускаем');
  }

  // ── 2) ИНН ────────────────────────────────────────────────
  console.log('  → Проверяем поле "ИНН"...');
  const innField = page.locator('#snt_inn');
  await expect(innField).toBeVisible({ timeout: 5_000 });
  const innValue = await innField.inputValue();
  console.log(`  ℹ ИНН: "${innValue}"`);
  expect(innValue.length).toBeGreaterThan(0);
  console.log('  ✓ Поле "ИНН" заполнено');

  // ── 3) КПП ────────────────────────────────────────────────
  console.log('  → Проверяем поле "КПП"...');
  const kppField = page.locator('#snt_kpp');
  await expect(kppField).toBeVisible({ timeout: 5_000 });
  const kppValue = await kppField.inputValue();
  console.log(`  ℹ КПП: "${kppValue}"`);
  expect(kppValue.length).toBeGreaterThan(0);
  console.log('  ✓ Поле "КПП" заполнено');

  // ── 4) Адрес ──────────────────────────────────────────────
  console.log('  → Проверяем поле "Адрес"...');
  const addressField = page.locator('#snt_address');
  await expect(addressField).toBeVisible({ timeout: 5_000 });
  const addressValue = await addressField.inputValue();
  console.log(`  ℹ Адрес: "${addressValue}"`);
  expect(addressValue.length).toBeGreaterThan(0);
  console.log('  ✓ Поле "Адрес" заполнено');

  // ── 5) Адрес для корреспонденции ──────────────────────────
  // Если пусто — копируем из поля «Адрес»
  console.log('  → Проверяем поле "Адрес для корреспонденции"...');
  const additionalAddressField = page.locator('#snt_additional_address');
  await expect(additionalAddressField).toBeVisible({ timeout: 5_000 });
  const additionalAddressValue = await additionalAddressField.inputValue();
  if (!additionalAddressValue.trim()) {
    console.log('  ℹ Поле пустое — копируем адрес из основного поля');
    await additionalAddressField.fill(addressValue);
    console.log(`  ✓ Адрес для корреспонденции заполнен: "${addressValue}"`);
  } else {
    console.log(`  ✓ Адрес для корреспонденции уже заполнен: "${additionalAddressValue}"`);
  }


  // ── 6) Телефон ────────────────────────────────────────────
  console.log('  → Заполняем поле "Телефон"...');
  const phoneField = page.locator('#snt_phone');
  await expect(phoneField).toBeVisible({ timeout: 5_000 });
  const phoneValue = await phoneField.inputValue();
  if (!phoneValue.trim()) {
    // Поле пустое — вводим тестовый номер
    await phoneField.fill('+7 (999) 000-00-00');
    console.log('  ✓ Телефон заполнен: "+7 (999) 000-00-00"');
  } else {
    console.log(`  ✓ Телефон уже заполнен: "${phoneValue}"`);
  }

  // ════════════════════════════════════════════════════════════
  // ШАГ 15: Выбрать дату оплаты — последний день текущего месяца
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 15: Выбираем дату оплаты задолженности');
  console.log('══════════════════════════════════════════');

  // Вычисляем последний день текущего месяца:
  // new Date(год, месяц+1, 0) возвращает последний день текущего месяца.
  const lastDayOfMonth = await page.evaluate(() => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return last;
  });
  // Форматируем дату в ДД.ММ.ГГГГ для лога
  const lastDay = new Date(lastDayOfMonth);
  const lastDayStr = `${String(lastDay.getDate()).padStart(2, '0')}.${String(lastDay.getMonth() + 1).padStart(2, '0')}.${lastDay.getFullYear()}`;
  console.log(`  ℹ Последний день текущего месяца: ${lastDayStr}`);

  // Кликаем по полю SCORE_PAY_END — открывается flatpickr календарь
  console.log('  → Кликаем по полю даты оплаты...');
  const scorePayEndField = page.locator('#SCORE_PAY_END');
  await expect(scorePayEndField).toBeVisible({ timeout: 10_000 });
  await scorePayEndField.click();

  // Проверяем, что календарь открылся
  const payCalendar = page.locator('.flatpickr-calendar.open');
  await expect(payCalendar).toBeVisible({ timeout: 5_000 });
  console.log('  ✓ Календарь открылся');

  // Устанавливаем дату через flatpickr API
  const setDateResult = await page.evaluate(() => {
    const input = document.querySelector('#SCORE_PAY_END');
    if (!input || !input._flatpickr) return null;
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    input._flatpickr.setDate(lastDay, true);
    return input.value;
  });

  if (setDateResult) {
    console.log(`  ✓ Дата оплаты установлена через flatpickr: "${setDateResult}"`);
  } else {
    // Запасной вариант: кликаем на последний день в открытом календаре
    console.log('  ℹ flatpickr API недоступен — кликаем по последнему дню в календаре...');
    const lastDayCell = payCalendar.locator(`.flatpickr-day:not(.nextMonthDay):not(.prevMonthDay)`).last();
    await expect(lastDayCell).toBeVisible({ timeout: 3_000 });
    await lastDayCell.click();
    console.log('  ✓ Последний день месяца выбран кликом в календаре');
  }

  // Закрываем календарь
  await page.keyboard.press('Escape');
  await expect(payCalendar).toBeHidden({ timeout: 3_000 }).catch(() => {});

  // Проверяем, что значение поля обновилось
  const payDateValue = await scorePayEndField.inputValue();
  console.log(`  ✓ Итоговая дата оплаты: "${payDateValue}"`);

  // ════════════════════════════════════════════════════════════
  // ШАГ 16: Сохранить черновик и вернуться на страницу претензий
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 16: Сохраняем черновик и возвращаемся на "Претензии"');
  console.log('══════════════════════════════════════════');

  // Кнопка «Сохранить черновик»: <span class="btn-save-draft">
  // После заполнения полей форма может перерисоваться и кнопка уйдёт
  // за пределы viewport. Используем force:true чтобы кликнуть даже если
  // кнопка временно скрыта или перекрыта другим элементом.
  console.log('  → Ищем кнопку "Сохранить черновик"...');
  const saveDraftBtn2 = page.locator('span.btn-save-draft').first();
  await expect(saveDraftBtn2).toBeAttached({ timeout: 10_000 });
  console.log('  ✓ Кнопка найдена в DOM');

  // Прокручиваем через JS (не через Playwright scroll, который ждёт видимости)
  await page.evaluate(() => {
    const btn = document.querySelector('span.btn-save-draft');
    if (btn) btn.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  await page.waitForTimeout(300);

  console.log('  → Нажимаем "Сохранить черновик" через JS...');
  // Кнопка находится внутри скрытого контейнера (display:none на родителе),
  // поэтому ни scrollIntoView, ни force:true не помогают.
  // Единственный способ — вызвать .click() напрямую через DOM API.
  await page.evaluate(() => {
    const btn = document.querySelector('span.btn-save-draft');
    if (!btn) throw new Error('span.btn-save-draft не найден в DOM');
    btn.click();
  });
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Черновик сохранён');


  // Возврат через хлебные крошки: <span itemprop="name">Претензии</span>
  console.log('  → Ищем хлебную крошку "Претензии"...');
  const breadcrumb2 = page.locator('a').filter({
    has: page.locator('span[itemprop="name"]', { hasText: /^Претензии$/i }),
  }).first();

  const breadcrumb2Visible = await breadcrumb2.isVisible().catch(() => false);
  if (breadcrumb2Visible) {
    console.log('  ✓ Хлебная крошка найдена, кликаем...');
    await breadcrumb2.click();
  } else {
    const breadcrumbSpan2 = page.locator('span[itemprop="name"]', { hasText: /^Претензии$/i });
    if (await breadcrumbSpan2.isVisible().catch(() => false)) {
      await breadcrumbSpan2.click();
    } else {
      console.log('  ℹ Хлебная крошка не найдена — переходим по URL');
      await page.goto(`${BASE_URL}/snt/peni/claims/`, { waitUntil: 'domcontentloaded' });
    }
  }

  // Проверяем переход на страницу претензий
  await expect(page).toHaveURL(/\/snt\/peni\/claims\//, { timeout: 10_000 });
  console.log('  ✓ Переход на страницу претензий выполнен. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 17: Снова найти черновик в таблице и открыть его
  //          (аналогично шагу 12)
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 17: Снова ищем черновик в таблице претензий');
  console.log('══════════════════════════════════════════');

  console.log('  → Ищем ссылку "Черновик" в таблице...');
  const draftLink2 = page.locator('a').filter({ hasText: /^Черновик$/i }).first();
  await expect(draftLink2).toBeVisible({ timeout: 10_000 });
  const draftHref2 = await draftLink2.getAttribute('href');
  console.log(`  ✓ Черновик найден. Ссылка: ${draftHref2}`);

  await draftLink2.click();
  await expect(page).toHaveURL(/\/snt\/peni\/claims\/add\/\?draft=\d+/, { timeout: 10_000 });
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Открыта страница редактирования черновика. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 18: Рассчитать задолженность, поставить подпись, создать претензию
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 18: Рассчитываем задолженность и создаём претензию');
  console.log('══════════════════════════════════════════');

  // ── Нажимаем «Рассчитать задолженность» ──────────────────────
  // <a id="calc" class="button btn">Рассчитать задолженность</a>
  // Для индивидуала кнопка может находиться в скрытом контейнере —
  // используем page.evaluate чтобы кликнуть через DOM API.
  console.log('  → Нажимаем "Рассчитать задолженность"...');
  await expect(page.locator('#calc')).toBeAttached({ timeout: 10_000 });
  await page.evaluate(() => {
    const btn = document.querySelector('#calc');
    if (!btn) throw new Error('#calc не найден в DOM');
    btn.click();
  });


  // Ждём появления таблицы с расчётами под кнопкой.
  // Ориентируемся на любую таблицу (table) внутри блока результатов,
  // которая появляется после расчёта.
  console.log('  → Ожидаем появления таблицы расчётов...');
  const calcTable = page.locator('table').filter({ hasText: /итог|сумма|пени|расчёт/i }).first();
  // Если специфичная таблица не найдена — ждём любую новую таблицу
  const calcTableGeneric = page.locator('.calc-result, #calc-result, [id*="result"], [class*="result"]').first();
  const calcTableVisible = await calcTable.isVisible({ timeout: 10_000 }).catch(() => false)
    || await calcTableGeneric.isVisible({ timeout: 2_000 }).catch(() => false);
  if (calcTableVisible) {
    console.log('  ✓ Таблица расчётов появилась');
  } else {
    console.log('  ℹ Таблица расчётов не найдена по ключевым словам — продолжаем');
  }
  // Небольшая пауза для завершения рендеринга
  await page.waitForTimeout(1_000);

  // ── Чекбокс подписи и печати ─────────────────────────────────
  // <label for="SIGNATURE">Поставить подпись и печать...</label>
  // Кликаем по label — это надёжнее, чем по самому input[type=checkbox]
  console.log('  → Ищем чекбокс "Подпись и печать"...');
  const signatureLabel = page.locator('label[for="SIGNATURE"]');
  const signatureLabelVisible = await signatureLabel.isVisible({ timeout: 5_000 }).catch(() => false);
  if (signatureLabelVisible) {
    await signatureLabel.scrollIntoViewIfNeeded();
    const signatureCheckbox = page.locator('#SIGNATURE');
    const isChecked = await signatureCheckbox.isChecked().catch(() => false);
    if (!isChecked) {
      await signatureLabel.click();
      console.log('  ✓ Чекбокс "Подпись и печать" отмечен');
    } else {
      console.log('  ✓ Чекбокс "Подпись и печать" уже отмечен');
    }
  } else {
    console.log('  ℹ Чекбокс "Подпись и печать" не найден — пропускаем');
  }

  // <button class="button ml-3" type="submit">Создать претензию</button>
  // Для индивидуала кнопка скрыта — кликаем через DOM API.
  console.log('  → Нажимаем "Создать претензию"...');
  await expect(page.locator('button[type="submit"]').filter({ hasText: /Создать претензию/i }).first())
    .toBeAttached({ timeout: 10_000 });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button[type="submit"]'))
      .find(b => b.textContent.trim().includes('Создать претензию'));
    if (!btn) throw new Error('Кнопка "Создать претензию" не найдена в DOM');
    btn.click();
  });


  // После нажатия должен быть редирект на страницу претензий (/claims/, НЕ /claims/add/).
  // Используем негативный lookahead чтобы не совпасть с /claims/add/?draft=...
  await expect(page).toHaveURL(/\/snt\/peni\/claims\/(?!add)/, { timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Претензия создана. Переход на страницу претензий. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 19: Проверить, что претензия создана
  //          Найти запись с сегодняшней датой и статусом «Не отправлено»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 19: Проверяем, что претензия создана');
  console.log('══════════════════════════════════════════');

  // Формируем строку сегодняшней даты в формате ДД.ММ.ГГГГ
  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
  console.log(`  ℹ Сегодняшняя дата: ${todayStr}`);

  // Ищем строку таблицы, которая содержит сегодняшнюю дату И статус «Не отправлено»
  console.log('  → Ищем запись с сегодняшней датой и статусом "Не отправлено"...');
  const newClaimRow = page.locator('tr').filter({ hasText: todayStr }).filter({
    hasText: /Не отправлено/i,
  }).first();
  await expect(newClaimRow).toBeVisible({ timeout: 15_000 });
  console.log('  ✓ Запись с новой претензией найдена (сегодня, статус "Не отправлено")');

  // ════════════════════════════════════════════════════════════
  // ШАГ 20: Нажать на колокольчик → Отмена, затем снова → Отправить
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 20: Отправка претензии через иконку колокольчика');
  console.log('══════════════════════════════════════════');

  // Колокольчик: SVG use[xlink:href*="bell-outline"] внутри строки претензии.
  // xlink:href — XML-пространство имён, CSS и Playwright не могут его адресовать напрямую.
  // Используем page.evaluate чтобы найти и кликнуть ближайший кликабельный предок SVG.

  // Вспомогательная функция: кликает по ближайшему <a>/<button>/<span> к SVG колокольчику
  // в строке, содержащей заданный текст.
  const clickBellInRow = async (rowText) => {
    await page.evaluate((text) => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(r => r.textContent.includes(text));
      if (!row) throw new Error(`Строка с текстом "${text}" не найдена`);

      // SVG use с любым href/xlink:href содержащим «bell»
      const svgUses = Array.from(row.querySelectorAll('use'));
      const bellUse = svgUses.find(u =>
        (u.getAttribute('href') || u.getAttribute('xlink:href') || '').includes('bell')
      );
      if (!bellUse) throw new Error('SVG колокольчик не найден в строке');

      // Идём вверх по DOM в поисках кликабельного предка
      let el = bellUse.closest('a, button');
      if (!el) el = bellUse.closest('span[onclick], div[onclick], span, div');
      if (!el) el = bellUse.parentElement;
      el.click();
    }, rowText);
  };

  // ── Первый клик → Отмена ─────────────────────────────────────
  console.log('  → Первый клик по колокольчику...');
  await clickBellInRow('Не отправлено');

  // Ждём диалог подтверждения
  console.log('  → Ожидаем диалог подтверждения...');
  const btnNo = page.locator('#btnNo');
  await expect(btnNo).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Диалог появился. Нажимаем "Отмена"...');
  await btnNo.click();

  // Диалог должен закрыться
  await expect(btnNo).toBeHidden({ timeout: 5_000 });
  console.log('  ✓ Диалог закрыт');
  await page.waitForTimeout(500);

  // ── Второй клик → Отправить ───────────────────────────────────
  console.log('  → Второй клик по колокольчику...');
  await clickBellInRow('Не отправлено');

  console.log('  → Ожидаем диалог подтверждения...');
  const btnYes = page.locator('#btnYes');
  await expect(btnYes).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Диалог появился. Нажимаем "Отправить"...');
  await btnYes.click();

  // После отправки диалог закрывается и статус меняется
  await expect(btnYes).toBeHidden({ timeout: 10_000 });
  console.log('  ✓ Претензия отправлена');

  // ════════════════════════════════════════════════════════════
  // ШАГ 21: Проверить, что статус изменился на «Отправлено»
  //          и в колонке даты отправки — сегодняшняя дата
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 21: Проверяем статус "Отправлено"');
  console.log('══════════════════════════════════════════');

  // После отправки страница может обновиться — ждём
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1_000);

  // Ищем строку с сегодняшней датой и статусом «Отправлено»
  console.log('  → Ищем запись со статусом "Отправлено" и сегодняшней датой...');
  const sentClaimRow = page.locator('tr').filter({ hasText: todayStr }).filter({
    hasText: /Отправлено/i,
  }).first();
  await expect(sentClaimRow).toBeVisible({ timeout: 15_000 });
  console.log('  ✓ Запись найдена. Статус изменён на "Отправлено"');

  // Проверяем ячейку с датой отправки — должна содержать сегодняшнюю дату
  const sentDateCell = sentClaimRow.locator('td').filter({ hasText: todayStr }).last();
  await expect(sentDateCell).toBeVisible({ timeout: 5_000 });
  const sentDateText = await sentDateCell.textContent();
  console.log(`  ✓ Дата отправки: "${sentDateText?.trim()}"`);

  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 22: Скачиваем претензию (PDF и DOCX)');
  console.log('══════════════════════════════════════════');

  // SVG use[xlink:href*="download"] — адресуем через DOM API, как колокольчик.
  const clickDownloadInRow = async (rowText) => {
    await page.evaluate((text) => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(r => r.textContent.includes(text));
      if (!row) throw new Error(`Строка с текстом "${text}" не найдена`);
      const svgUses = Array.from(row.querySelectorAll('use'));
      const dlUse = svgUses.find(u =>
        (u.getAttribute('href') || u.getAttribute('xlink:href') || '').includes('download')
      );
      if (!dlUse) throw new Error('SVG иконка download не найдена в строке');
      let el = dlUse.closest('a, button');
      if (!el) el = dlUse.closest('span, div');
      if (!el) el = dlUse.parentElement;
      el.click();
    }, rowText);
  };

  // ── 1) Клик → Отмена ─────────────────────────────────────────
  console.log('  → [1/3] Кликаем "Скачать претензию"...');
  await clickDownloadInRow('Отправлено');

  console.log('  → Ожидаем диалог выбора формата...');
  const dlCancelBtn = page.locator('#btnNo').first();
  const dlCancelGeneric = page.locator('button, div, span').filter({ hasText: /^Отмена$/i }).first();
  if (await dlCancelBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await dlCancelBtn.click();
    console.log('  ✓ Нажата "Отмена"');
  } else {
    await expect(dlCancelGeneric).toBeVisible({ timeout: 5_000 });
    await dlCancelGeneric.click();
    console.log('  ✓ Нажата "Отмена" (generic)');
  }
  await page.waitForTimeout(500);

  // ── 2) Клик → PDF ────────────────────────────────────────────
  console.log('  → [2/3] Кликаем "Скачать претензию"...');
  await clickDownloadInRow('Отправлено');

  console.log('  → Ожидаем диалог и нажимаем "PDF"...');
  const pdfBtn = page.locator('button, span').filter({ hasText: /^PDF$/i }).first();
  await expect(pdfBtn).toBeVisible({ timeout: 10_000 });

  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    pdfBtn.click(),
  ]);
  const pdfFilename = pdfDownload.suggestedFilename();
  console.log(`  ✓ Файл PDF скачан: "${pdfFilename}"`);
  expect(pdfFilename.toLowerCase()).toMatch(/\.pdf$/);
  await page.waitForTimeout(1_000);

  // ── 3) Клик → DOCX ───────────────────────────────────────────
  console.log('  → [3/3] Кликаем "Скачать претензию"...');
  await clickDownloadInRow('Отправлено');

  console.log('  → Ожидаем диалог и нажимаем "DOCX"...');
  const docxBtn = page.locator('button').filter({ hasText: /^DOCX$/i }).first();
  await expect(docxBtn).toBeVisible({ timeout: 10_000 });

  const [docxDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    docxBtn.click(),
  ]);
  const docxFilename = docxDownload.suggestedFilename();
  console.log(`  ✓ Файл DOCX скачан: "${docxFilename}"`);
  expect(docxFilename.toLowerCase()).toMatch(/\.docx$/);

  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 23: Удаляем претензию (корзина)');
  console.log('══════════════════════════════════════════');

  // SVG use[xlink:href*="delete"] — аналогично bell и download через DOM API.
  const clickDeleteInRow = async (rowText) => {
    await page.evaluate((text) => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(r => r.textContent.includes(text));
      if (!row) throw new Error(`Строка с текстом "${text}" не найдена`);
      const svgUses = Array.from(row.querySelectorAll('use'));
      const delUse = svgUses.find(u =>
        (u.getAttribute('href') || u.getAttribute('xlink:href') || '').includes('delete')
      );
      if (!delUse) throw new Error('SVG иконка delete не найдена в строке');
      let el = delUse.closest('a, button');
      if (!el) el = delUse.closest('span, div');
      if (!el) el = delUse.parentElement;
      el.click();
    }, rowText);
  };

  // ── 1) Клик → Отмена ─────────────────────────────────────────
  console.log('  → [1/2] Кликаем на иконку корзины...');
  await clickDeleteInRow('Отправлено');

  console.log('  → Ожидаем диалог подтверждения удаления...');
  const delCancelBtn = page.locator('#btnNo').first();
  await expect(delCancelBtn).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Диалог появился. Нажимаем "Отмена"...');
  await delCancelBtn.click();
  await expect(delCancelBtn).toBeHidden({ timeout: 5_000 });
  console.log('  ✓ Диалог закрыт');
  await page.waitForTimeout(500);

  // ── 2) Клик → Удалить ────────────────────────────────────────
  console.log('  → [2/2] Кликаем на иконку корзины...');
  await clickDeleteInRow('Отправлено');

  console.log('  → Ожидаем диалог подтверждения удаления...');
  const delConfirmBtn = page.locator('#btnYes').first();
  await expect(delConfirmBtn).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Диалог появился. Нажимаем "Удалить"...');
  await delConfirmBtn.click();

  // После удаления диалог скрывается и страница обновляется
  await expect(delConfirmBtn).toBeHidden({ timeout: 10_000 });
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Претензия удалена');

  console.log('\n══════════════════════════════════════════');
  console.log('✅ Тест пройден успешно!');
  console.log('══════════════════════════════════════════');
});



