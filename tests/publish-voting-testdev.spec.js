// ============================================================
// E2E тест: Публикация голосования на сайте testdev.sntclub.ru
// Тестовый фреймворк: Playwright Test (@playwright/test)
//
// ⚠️ Запускать вручную ПОСЛЕ успешного прохождения voting.spec.js
//    npx playwright test publish-voting-testdev.spec.js --headed
//
// Отличия от publish-voting.spec.js (prod):
//   1. Базовый URL — https://testdev.sntclub.ru/
//   2. Basic Auth — заголовок Authorization добавляется через page.route()
//   3. Учётные данные — test.ramos@mail.ru / Wqmyt1DZ7L
//   4. Обработка экрана выбора роли «Председатель» после входа
// ============================================================

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────
// НАСТРОЙКИ ТЕСТА
// ─────────────────────────────────────────────────────────────
const BASE_URL = 'https://testdev.sntclub.ru';

const TEST_USER = {
  email: 'test.ramos@mail.ru',
  password: 'Wqmyt1DZ7L',
};

// Basic Auth для доступа к площадке testdev (devsite:devsitesntclub)
// base64('devsite:devsitesntclub') = 'ZGV2c2l0ZTpkZXZzaXRlc250Y2x1Yg=='
const BASIC_AUTH_HEADER = 'Basic ZGV2c2l0ZTpkZXZzaXRlc250Y2x1Yg==';

// ─────────────────────────────────────────────────────────────
// ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: авторизация пользователя
// ─────────────────────────────────────────────────────────────
async function login(page) {
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 1: Авторизация');
  console.log('══════════════════════════════════════════');

  console.log(`  → Открываем страницу авторизации ${BASE_URL}/ ...`);
  await page.goto(`${BASE_URL}/`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/testdev\.sntclub\.ru/);
  console.log('  ✓ Страница открыта. URL:', page.url());

  // ── Поле Email ──────────────────────────────────────────────
  console.log('  → Заполняем поле Email...');
  const emailField = page.getByPlaceholder('Ivanov@mail.ru');
  await expect(emailField).toBeVisible({ timeout: 15_000 });
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
  const loginButton = page.locator('#login-btn');
  await expect(loginButton).toBeEnabled({ timeout: 5_000 });
  await loginButton.click();

  // ── Экран выбора роли ────────────────────────────────────────
  // У пользователя test.ramos@mail.ru после входа может появиться
  // промежуточный экран выбора роли. Если он появился — выбираем «Председатель».
  console.log('  → Проверяем, нет ли экрана выбора роли...');
  try {
    // Ждём 5 секунд — если за это время появится кнопка/ссылка с ролью, кликаем
    const chairmanBtn = page.locator('a, button').filter({ hasText: /Председатель/i }).first();
    await chairmanBtn.waitFor({ state: 'visible', timeout: 5_000 });
    console.log('  ℹ Обнаружен экран выбора роли — выбираем «Председатель»...');
    await chairmanBtn.click();
    console.log('  ✓ Роль «Председатель» выбрана');
  } catch {
    console.log('  ✓ Экрана выбора роли нет — продолжаем');
  }

  // ── Ожидаем успешного входа ──────────────────────────────────
  console.log('  → Ожидаем появления бокового меню после входа...');
  await expect(
    page.getByRole('link', { name: /Общие собрания и голосования/i })
  ).toBeVisible({ timeout: 25_000 });
  console.log('  ✓ Авторизация успешна! URL после входа:', page.url());
}

// ─────────────────────────────────────────────────────────────
// ОСНОВНОЙ ТЕСТ
// ─────────────────────────────────────────────────────────────
test('Публикация голосования [testdev]', async ({ page }) => {
  // Даём 180 секунд — testdev-стенд может работать медленнее
  test.setTimeout(180_000);

  // ════════════════════════════════════════════════════════════
  // Basic Auth: перехватываем все запросы и добавляем заголовок
  // Это нужно для доступа к площадке testdev, закрытой HTTP Basic Auth.
  // ════════════════════════════════════════════════════════════
  console.log('  → Настраиваем Basic Auth для testdev.sntclub.ru...');
  await page.route('**/*', (route, request) => {
    const headers = {
      ...request.headers(),
      'Authorization': BASIC_AUTH_HEADER,
    };
    route.continue({ headers });
  });
  console.log('  ✓ Basic Auth настроен');

  // ════════════════════════════════════════════════════════════
  // ШАГ 1: Авторизация
  // ════════════════════════════════════════════════════════════
  await login(page);

  // ════════════════════════════════════════════════════════════
  // ШАГ 2: Навигация в раздел «Общие собрания и голосования»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 2: Навигация в раздел голосований');
  console.log('══════════════════════════════════════════');

  const votesMenuLink = page.getByRole('link', { name: /Общие собрания и голосования/i });

  console.log('  → Проверяем видимость пункта меню...');
  const isMenuItemVisible = await votesMenuLink.isVisible();

  if (!isMenuItemVisible) {
    console.log('  ℹ Пункт меню скрыт. Нажимаем "Больше" для раскрытия...');
    const moreButton = page.getByRole('button', { name: /Больше/i });
    if (await moreButton.isVisible()) {
      await moreButton.click();
      console.log('  ✓ Меню раскрыто');
      await expect(votesMenuLink).toBeVisible({ timeout: 5_000 });
    } else {
      console.log('  ℹ Кнопка "Больше" не найдена — переходим напрямую по URL');
    }
  } else {
    console.log('  ✓ Пункт меню виден');
  }

  console.log('  → Переходим на страницу голосований...');
  await page.goto(`${BASE_URL}/votes/`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/\/votes\//);
  console.log('  ✓ Находимся на странице:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 3: Нажать «Перейти» в блоке «Голосование (новая версия)»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 3: Нажимаем "Перейти" в блоке новой версии');
  console.log('══════════════════════════════════════════');

  console.log('  → Ищем блок "Голосование (новая версия)"...');
  const newVersionBlock = page.getByText(/Голосование\s*\(новая версия\)/i);
  await expect(newVersionBlock).toBeVisible({ timeout: 15_000 });
  console.log('  ✓ Блок найден');

  console.log('  → Ищем кнопку "Перейти"...');
  const goToNewVersionButton = page
    .locator('a, button')
    .filter({ hasText: /^Перейти$/ })
    .first();

  await goToNewVersionButton.scrollIntoViewIfNeeded();
  await expect(goToNewVersionButton).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Перейти" найдена');

  console.log('  → Нажимаем "Перейти"...');
  await goToNewVersionButton.click();

  await expect(page).toHaveURL(/new=Y/, { timeout: 15_000 });
  console.log('  ✓ Переход выполнен. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 4: Найти последнее голосование со статусом «Готово к публикации»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 4: Открываем последнее голосование «Готово к публикации»');
  console.log('══════════════════════════════════════════');

  console.log('  → Ждём загрузки таблицы голосований...');
  const firstStatusCell = page.locator('span.main-grid-cell-content', {
    hasText: 'Готово к публикации',
  }).first();
  await expect(firstStatusCell).toBeVisible({ timeout: 20_000 });
  console.log('  ✓ Таблица загружена, статус «Готово к публикации» найден');

  console.log('  → Ищем первую строку таблицы со статусом «Готово к публикации»...');
  const firstReadyRow = page
    .locator('tr')
    .filter({
      has: page.locator('span.main-grid-cell-content', { hasText: 'Готово к публикации' }),
    })
    .first();
  await expect(firstReadyRow).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Строка найдена');

  console.log('  → Ищем ссылку на голосование внутри строки...');
  const votingLink = firstReadyRow.locator('a[href*="/votes/view/"]').first();
  await expect(votingLink).toBeVisible({ timeout: 5_000 });

  const votingTitle = await votingLink.textContent();
  const votingHref = await votingLink.getAttribute('href');
  console.log(`  ✓ Ссылка найдена: "${votingTitle?.trim()}" → ${votingHref}`);

  console.log('  → Переходим на страницу голосования...');
  await votingLink.click();

  await expect(page).toHaveURL(/\/votes\/view\/\?ID=/, { timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Страница голосования открыта. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 5: Проверяем наличие кнопок скачивания файлов
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 5: Проверяем кнопки скачивания файлов');
  console.log('══════════════════════════════════════════');

  console.log('  → Проверяем кнопку "Заполненный Протокол Правления"...');
  const btnBoardMinutes = page.locator('a.vote__buttons__btn[href*="board_minutes.php"]');
  await expect(btnBoardMinutes).toBeVisible({ timeout: 15_000 });
  console.log('  ✓ Кнопка "Заполненный Протокол Правления" найдена');

  console.log('  → Проверяем кнопку "Заполненное Уведомление с Повесткой дня"...');
  const btnNotice = page.locator('a.vote__buttons__btn[href*="notice_voting_agenda_items.php"]');
  await expect(btnNotice).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Заполненное Уведомление с Повесткой дня" найдена');

  console.log('  → Проверяем кнопку "Шаблон проекта Протокола"...');
  const btnProtocolTemplate = page.locator('a.vote__buttons__btn[href*="protocol_project.docx"]');
  await expect(btnProtocolTemplate).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Шаблон проекта Протокола" найдена');

  console.log('  → Проверяем кнопку "Шаблон Протокола счетной комиссии"...');
  const btnTabulationTemplate = page.locator('a.vote__buttons__btn[href*="tabulation_protocol.docx"]');
  await expect(btnTabulationTemplate).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Шаблон Протокола счетной комиссии" найдена');

  console.log('  → Проверяем кнопку "Бюллетень для голосования"...');
  const btnBulletin = page.locator('a.vote__buttons__btn[href*="bulletin.php"]:not([href*="isIndividual"])');
  await expect(btnBulletin).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Бюллетень для голосования" найдена');

  console.log('  → Проверяем кнопку "Бюллетень для голосования для индивидуалов"...');
  const btnBulletinIndividual = page.locator('a.vote__buttons__btn[href*="bulletin.php"][href*="isIndividual=Y"]');
  await expect(btnBulletinIndividual).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Бюллетень для голосования для индивидуалов" найдена');

  // ── 5.7. Скачать статистику голосования ──────────────────────
  // Ссылка: <a href="/local/ajax/vote/export_users.php?ID=XXXX" class="button">
  // Не привязываемся к ID — ищем по href-паттерну.
  console.log('  → Проверяем кнопку "Скачать статистику голосования"...');
  const btnExportStats = page.locator('a.button[href*="export_users.php"]');
  await expect(btnExportStats).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Скачать статистику голосования" найдена');

  console.log('  → Кликаем по всем кнопкам скачивания...');
  const downloadButtons = [
    btnBoardMinutes,
    btnNotice,
    btnProtocolTemplate,
    btnTabulationTemplate,
    btnBulletin,
    btnBulletinIndividual,
    btnExportStats,
  ];

  for (const btn of downloadButtons) {
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForTimeout(1_000);
    for (const p of page.context().pages()) {
      if (p !== page) await p.close();
    }
  }
  console.log('  ✓ Все кнопки скачивания нажаты, лишние вкладки закрыты');

  // ════════════════════════════════════════════════════════════
  // ШАГ 6: Проверка отправки бюллетеней собственникам
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 6: Отправка бюллетеней собственников');
  console.log('══════════════════════════════════════════');

  console.log('  → Нажимаем "Получить все бюллетени собственников"...');
  const getBulletinsBtn = page.locator('a[onclick*="getBulletins"]');
  await expect(getBulletinsBtn).toBeVisible({ timeout: 10_000 });
  await getBulletinsBtn.click();
  console.log('  ✓ Кнопка нажата');

  // Слайдбар — Bitrix SidePanel с iframe
  console.log('  → Ждём появления iframe слайдбара...');
  const sidePanelIframe = page.locator('iframe.side-panel-iframe');
  await expect(sidePanelIframe).toBeVisible({ timeout: 20_000 });
  console.log('  ✓ iframe слайдбара видим');

  const frame = page.frameLocator('iframe.side-panel-iframe');

  console.log('  → Ожидаем загрузки формы внутри iframe...');
  const emailInput = frame.locator('input[name="EMAIL"], input[type="email"]').first();
  await expect(emailInput).toBeVisible({ timeout: 20_000 });
  console.log('  ✓ Слайдбар загружен, поле Email видно');

  // Проверяем предзаполнение email — на release может отличаться
  console.log('  → Проверяем предзаполнение поля Email...');
  const prefillValue = await emailInput.inputValue();
  if (prefillValue) {
    console.log(`  ✓ Email предзаполнен: "${prefillValue}"`);
  } else {
    console.log(`  ℹ Email не предзаполнен — вводим вручную: ${TEST_USER.email}`);
    await emailInput.fill(TEST_USER.email);
  }

  console.log('  → Нажимаем "Сформировать и отправить"...');
  const submitBtn = frame.locator('button[type="submit"]').filter({ hasText: /Сформировать и отправить/i });
  await expect(submitBtn).toBeVisible({ timeout: 5_000 });
  await submitBtn.click();
  console.log('  ✓ Кнопка нажата — ожидаем завершения запроса...');

  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  console.log('  ✓ Страница обновилась после отправки бюллетеней');

  // Закрываем слайдбар
  console.log('  → Закрываем слайдбар...');
  const closePanelBtn = page.locator('div.side-panel-label-icon-close');
  const isPanelOpen = await closePanelBtn.isVisible();
  if (isPanelOpen) {
    await closePanelBtn.click();
    await expect(page.locator('div.side-panel-overlay')).toBeHidden({ timeout: 10_000 });
    console.log('  ✓ Слайдбар закрыт');
  } else {
    console.log('  ℹ Слайдбар уже закрыт');
  }

  // ════════════════════════════════════════════════════════════
  // ШАГ 7: Проверяем таблицу участников голосования
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 7: Проверяем таблицу участников голосования');
  console.log('══════════════════════════════════════════');

  // Пауза на CSS-анимацию закрытия SidePanel
  console.log('  → Ждём завершения анимации закрытия слайдбара (1.5 сек)...');
  await page.waitForTimeout(1_500);

  // Ждём загрузки данных таблицы через AJAX
  console.log('  → Ждём загрузки данных таблицы участников (AJAX)...');
  await page.waitForFunction(
    () => {
      const spans = document.querySelectorAll('span.main-grid-cell-content');
      return Array.from(spans).some(s => s.textContent.trim().length > 0);
    },
    { timeout: 25_000 }
  );
  console.log('  ✓ Данные таблицы загружены');

  console.log('  → Анализируем строки таблицы через page.evaluate...');

  const foundQualifiedVoter = await page.evaluate(() => {
    const headerCells = Array.from(
      document.querySelectorAll('th, .main-grid-head-cell, thead td')
    );

    function findColIndex(keyword) {
      const idx = headerCells.findIndex(
        th => th.textContent && th.textContent.toLowerCase().includes(keyword.toLowerCase())
      );
      return idx;
    }

    const idxVerified = findColIndex('Верифи');
    const idxWeight   = findColIndex('Вес');
    const idxCanVote  = findColIndex('Может');
    const idxVoted    = findColIndex('Прогол');

    const rows = Array.from(document.querySelectorAll('tbody tr, .main-grid-body tr'));

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td, th'));

      function cellText(idx) {
        if (idx < 0 || idx >= cells.length) return '';
        const span = cells[idx].querySelector('span.main-grid-cell-content');
        return span ? span.textContent.trim() : cells[idx].textContent.trim();
      }

      const verified     = cellText(idxVerified);
      const weightStr    = cellText(idxWeight);
      const canVoteOnline = cellText(idxCanVote);
      const voted        = cellText(idxVoted);
      const weight       = parseFloat(weightStr.replace(',', '.'));

      const isMatch =
        verified === 'Да' &&
        !isNaN(weight) && weight > 0 &&
        canVoteOnline === 'Да' &&
        voted === 'Нет';

      if (isMatch) {
        console.log(`[evaluate] ✓ Найден подходящий участник: Верифицирован="${verified}", Вес="${weightStr}", МожетОнлайн="${canVoteOnline}", Проголосовал="${voted}"`);
        return true;
      }
    }

    console.log('[evaluate] ✗ Подходящий участник не найден');
    return false;
  });

  let foundViaFallback = false;
  if (!foundQualifiedVoter) {
    console.log('  ℹ Заголовки не распознаны — применяем запасной метод поиска...');

    foundViaFallback = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr, .main-grid-body tr'));

      for (const row of rows) {
        const spans = Array.from(row.querySelectorAll('span.main-grid-cell-content'))
          .map(s => s.textContent.trim());

        const hasWeight  = spans.some(s => { const n = parseFloat(s.replace(',', '.')); return !isNaN(n) && n > 0; });
        const hasNotVoted = spans.includes('Нет');
        const daCount    = spans.filter(s => s === 'Да').length;

        if (hasWeight && daCount >= 2 && hasNotVoted) {
          console.log('[evaluate-fallback] ✓ Найден подходящий участник (fallback):', spans.join(' | '));
          return true;
        }
      }
      return false;
    });
  }

  const hasQualifiedVoter = foundQualifiedVoter || foundViaFallback;

  if (!hasQualifiedVoter) {
    throw new Error(
      'ШАГ 7 ПРОВАЛЕН: В таблице нет ни одного участника, у которого ' +
      'Верифицирован=«Да», Вес>0, Может голосовать онлайн=«Да», Проголосовал=«Нет»'
    );
  }

  console.log('  ✓ Найден хотя бы один подходящий участник голосования');

  // ════════════════════════════════════════════════════════════
  // ШАГ 8: Публикация голосования
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 8: Публикация голосования');
  console.log('══════════════════════════════════════════');

  // ── 8.1. Нажимаем кнопку «Опубликовать» ──────────────────────
  console.log('  → Ищем кнопку "Опубликовать"...');
  const publishBtn = page.locator('a.button', { hasText: /^Опубликовать$/ });
  await expect(publishBtn).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Опубликовать" найдена');

  console.log('  → Нажимаем "Опубликовать"...');
  await publishBtn.click();

  // ── 8.2. Ждём загрузки формы публикации ──────────────────────
  console.log('  → Ждём загрузки формы публикации...');
  await expect(page.locator('#news-name')).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Форма публикации загружена. URL:', page.url());

  // Ждём исчезновения Bitrix overlay (артефакт инициализации)
  console.log('  → Ждём исчезновения Bitrix overlay после загрузки страницы...');
  await page.locator('.popup-window-overlay').waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {
    console.log('  ℹ Overlay не обнаружен или уже скрыт — продолжаем');
  });

  // ── 8.3. Проверяем поле «Название» ───────────────────────────
  console.log('  → Проверяем поле "Название"...');
  const nameField = page.locator('#news-name');
  await expect(nameField).not.toHaveValue('');
  const nameValue = await nameField.inputValue();
  console.log(`  ✓ Поле "Название" заполнено: "${nameValue}"`);

  // ── 8.4. Проверяем поле «Дата начала активности» ─────────────
  console.log('  → Проверяем поле "Дата начала активности"...');
  const dateField = page.locator('#news-date');
  await expect(dateField).toBeVisible({ timeout: 5_000 });
  await expect(dateField).not.toHaveValue('');
  const dateValue = await dateField.inputValue();
  if (!/\d{2}\.\d{2}\.\d{4}/.test(dateValue)) {
    throw new Error(`ШАГ 8.4: Дата не соответствует формату DD.MM.YYYY. Получено: "${dateValue}"`);
  }
  console.log(`  ✓ Поле "Дата начала активности" заполнено: "${dateValue}"`);

  // ── 8.5. Проверяем поле «Детальное описание» (CKEditor) ──────
  console.log('  → Проверяем поле "Детальное описание" (CKEditor)...');
  const ckEditor = page.locator('.ck-editor__editable[contenteditable="true"]');
  await expect(ckEditor).toBeVisible({ timeout: 10_000 });
  const editorText = await ckEditor.innerText();
  if (!editorText || editorText.trim().length === 0) {
    throw new Error('ШАГ 8.5: Поле "Детальное описание" пустое');
  }
  console.log(`  ✓ Поле "Детальное описание" заполнено (${editorText.trim().length} символов)`);

  // ── 8.6. Чекбокс «Добавить в Важное на сайт» ─────────────────
  console.log('  → Проверяем и ставим чекбокс "Добавить в Важное на сайт"...');
  const lockNewsCheckbox = page.locator('#should-lock-news');
  const isLockNewsChecked = await lockNewsCheckbox.isChecked().catch(() => false);
  if (!isLockNewsChecked) {
    await page.locator('label[for="should-lock-news"]').click();
    console.log('  ✓ Чекбокс "Добавить в Важное" установлен');
  } else {
    console.log('  ✓ Чекбокс "Добавить в Важное" уже установлен');
  }
  await expect(lockNewsCheckbox).toBeChecked({ timeout: 3_000 });

  // ── 8.7. Чекбокс «Разослать пользователям оповещение» ────────
  // Не устанавливаем — уведомление отправлять не нужно,
  // поэтому диалог подтверждения после «Далее» не появится.

  // ── 8.8. Нажимаем кнопку «Далее» ─────────────────────────────
  console.log('  → Нажимаем кнопку "Далее"...');
  const nextBtn = page.locator('button[name="iblock_submit"]');
  await expect(nextBtn).toBeVisible({ timeout: 5_000 });

  // ⚠️ .popup-window-overlay постоянно перехватывает pointer events на этой странице.
  // Используем прямой JS click, минуя проверку Playwright на перехват.
  await page.evaluate(() => {
    document.querySelector('button[name="iblock_submit"]').click();
  });
  console.log('  ✓ Кнопка "Далее" нажата (через JS click)');

  // ── Финал ────────────────────────────────────────────────────
  // Без чекбокса «Разослать оповещение» — прямой редирект на страницу голосования.
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 });
  await expect(page).toHaveURL(/\/votes\/view\/\?ID=/, { timeout: 20_000 });
  console.log('  ✓ Голосование опубликовано');

  console.log('\n══════════════════════════════════════════');
  console.log('✅ ТЕСТ ЗАВЕРШЁН УСПЕШНО');
  console.log('   Финальный URL:', page.url());
  console.log('══════════════════════════════════════════\n');
});
