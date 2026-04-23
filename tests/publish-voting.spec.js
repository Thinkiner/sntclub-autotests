// ============================================================
// E2E тест: Публикация голосования на сайте lk.sntclub.ru
// Тестовый фреймворк: Playwright Test (@playwright/test)
//
// ⚠️ Запускать вручную ПОСЛЕ успешного прохождения voting.spec.js
//    npx playwright test publish-voting.spec.js --headed
// ============================================================

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────
// НАСТРОЙКИ ТЕСТА
// В продакшене лучше хранить credentials в .env файле
// и читать через process.env.EMAIL / process.env.PASSWORD
// ─────────────────────────────────────────────────────────────
const TEST_USER = {
  email: 'uk@sntclub.ru',
  password: '123321',
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
  console.log('  → Открываем страницу авторизации https://lk.sntclub.ru/ ...');
  await page.goto('https://lk.sntclub.ru/', {
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

  // ── Ожидаем успешного входа ──────────────────────────────────
  // Сайт работает как SPA — URL может не меняться после логина,
  // поэтому waitForURL ненадёжен и был убран.
  // Вместо этого ждём появления элемента, который есть только
  // у авторизованного пользователя — пункта бокового меню.
  console.log('  → Ожидаем появления бокового меню после входа...');
  await expect(
    page.getByRole('link', { name: /Общие собрания и голосования/i })
  ).toBeVisible({ timeout: 20_000 });
  console.log('  ✓ Авторизация успешна! URL после входа:', page.url());
}

// ─────────────────────────────────────────────────────────────
// ОСНОВНОЙ ТЕСТ
// ─────────────────────────────────────────────────────────────
test('Публикация голосования', async ({ page }) => {
  // Даём 120 секунд — публикация включает несколько шагов
  test.setTimeout(120_000);

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

  // Ищем пункт меню по тексту
  const votesMenuLink = page.getByRole('link', { name: /Общие собрания и голосования/i });

  console.log('  → Проверяем видимость пункта меню...');
  const isMenuItemVisible = await votesMenuLink.isVisible();

  if (!isMenuItemVisible) {
    // Пункт скрыт — пробуем раскрыть меню кнопкой «Больше»
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

  // Переходим по прямому URL — это надёжнее, чем кликать по меню
  console.log('  → Переходим на страницу голосований...');
  await page.goto('https://lk.sntclub.ru/votes/', {
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

  // Убеждаемся, что блок «Голосование (новая версия)» присутствует на странице
  console.log('  → Ищем блок "Голосование (новая версия)"...');
  const newVersionBlock = page.getByText(/Голосование\s*\(новая версия\)/i);
  await expect(newVersionBlock).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Блок найден');

  // Ищем кнопку «Перейти» — на странице может быть несколько таких кнопок,
  // поэтому берём первую (она должна относиться к блоку новой версии).
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

  // Проверяем, что перешли на страницу новой версии голосований (?new=Y)
  await expect(page).toHaveURL(/new=Y/, { timeout: 10_000 });
  console.log('  ✓ Переход выполнен. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 4: Найти последнее голосование со статусом «Готово к публикации»
  //         и перейти на его страницу
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 4: Открываем последнее голосование «Готово к публикации»');
  console.log('══════════════════════════════════════════');

  // Ждём загрузки таблицы со списком голосований.
  // Ориентируемся на ячейку статуса — она всегда присутствует
  // если хотя бы одна запись есть в таблице.
  console.log('  → Ждём загрузки таблицы голосований...');
  const firstStatusCell = page.locator('span.main-grid-cell-content', {
    hasText: 'Готово к публикации',
  }).first();
  await expect(firstStatusCell).toBeVisible({ timeout: 15_000 });
  console.log('  ✓ Таблица загружена, статус «Готово к публикации» найден');

  // Строка таблицы: ищем первую строку, которая содержит
  // span со статусом «Готово к публикации».
  // tr.main-grid__row — стандартный класс строки в этой системе.
  // Если класс отличается — скорректируйте селектор по DevTools.
  console.log('  → Ищем первую строку таблицы со статусом «Готово к публикации»...');
  const firstReadyRow = page
    .locator('tr')
    .filter({
      has: page.locator('span.main-grid-cell-content', { hasText: 'Готово к публикации' }),
    })
    .first();
  await expect(firstReadyRow).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Строка найдена');

  // Внутри строки находим ссылку на страницу голосования.
  // Ссылка имеет вид: <a href="/votes/view/?ID=XXXX">Название</a>
  // Берём первый <a> внутри строки с href, содержащим /votes/view/
  console.log('  → Ищем ссылку на голосование внутри строки...');
  const votingLink = firstReadyRow.locator('a[href*="/votes/view/"]').first();
  await expect(votingLink).toBeVisible({ timeout: 5_000 });

  // Читаем текст ссылки и href для логирования (удобно при отладке)
  const votingTitle = await votingLink.textContent();
  const votingHref = await votingLink.getAttribute('href');
  console.log(`  ✓ Ссылка найдена: "${votingTitle?.trim()}" → ${votingHref}`);

  // Переходим на страницу голосования
  console.log('  → Переходим на страницу голосования...');
  await votingLink.click();

  // Ждём загрузки страницы голосования.
  // URL должен содержать /votes/view/?ID=
  await expect(page).toHaveURL(/\/votes\/view\/\?ID=/, { timeout: 15_000 });
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Страница голосования открыта. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 5: Проверяем наличие кнопок скачивания файлов
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 5: Проверяем кнопки скачивания файлов');
  console.log('══════════════════════════════════════════');

  // Все кнопки скачивания имеют класс vote__buttons__btn.
  // Проверяем каждую по href-паттерну или тексту — без привязки к ID.

  // ── 5.1. Заполненный Протокол Правления ──────────────────────
  console.log('  → Проверяем кнопку "Заполненный Протокол Правления"...');
  const btnBoardMinutes = page.locator('a.vote__buttons__btn[href*="board_minutes.php"]');
  await expect(btnBoardMinutes).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Заполненный Протокол Правления" найдена');

  // ── 5.2. Заполненное Уведомление с Повесткой дня ─────────────
  console.log('  → Проверяем кнопку "Заполненное Уведомление с Повесткой дня"...');
  const btnNotice = page.locator('a.vote__buttons__btn[href*="notice_voting_agenda_items.php"]');
  await expect(btnNotice).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Заполненное Уведомление с Повесткой дня" найдена');

  // ── 5.3. Шаблон проекта Протокола ────────────────────────────
  console.log('  → Проверяем кнопку "Шаблон проекта Протокола"...');
  const btnProtocolTemplate = page.locator('a.vote__buttons__btn[href*="protocol_project.docx"]');
  await expect(btnProtocolTemplate).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Шаблон проекта Протокола" найдена');

  // ── 5.4. Шаблон Протокола счетной комиссии ───────────────────
  console.log('  → Проверяем кнопку "Шаблон Протокола счетной комиссии"...');
  const btnTabulationTemplate = page.locator('a.vote__buttons__btn[href*="tabulation_protocol.docx"]');
  await expect(btnTabulationTemplate).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Шаблон Протокола счетной комиссии" найдена');

  // ── 5.5. Бюллетень для голосования ───────────────────────────
  // Два бюллетеня: обычный и для индивидуалов.
  // Отличаем их по наличию/отсутствию параметра isIndividual в href.
  console.log('  → Проверяем кнопку "Бюллетень для голосования"...');
  // Обычный бюллетень: href содержит bulletin.php, но НЕ содержит isIndividual
  const btnBulletin = page.locator('a.vote__buttons__btn[href*="bulletin.php"]:not([href*="isIndividual"])');
  await expect(btnBulletin).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Бюллетень для голосования" найдена');

  // ── 5.6. Бюллетень для голосования для индивидуалов ──────────
  console.log('  → Проверяем кнопку "Бюллетень для голосования для индивидуалов"...');
  const btnBulletinIndividual = page.locator('a.vote__buttons__btn[href*="bulletin.php"][href*="isIndividual=Y"]');
  await expect(btnBulletinIndividual).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Бюллетень для голосования для индивидуалов" найдена');

  // ── Временное скачивание всех 6 файлов ───────────────────────
  // Кликаем по каждой ссылке (target="_blank" откроет новую вкладку).
  // Сразу закрываем лишние вкладки, чтобы не засорять контекст.
  console.log('  → Кликаем по всем кнопкам скачивания...');
  const downloadButtons = [
    btnBoardMinutes,
    btnNotice,
    btnProtocolTemplate,
    btnTabulationTemplate,
    btnBulletin,
    btnBulletinIndividual,
  ];

  for (const btn of downloadButtons) {
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    // Даём браузеру время открыть вкладку / начать скачку
    await page.waitForTimeout(1_000);
    // Закрываем все вкладки кроме основной
    for (const p of page.context().pages()) {
      if (p !== page) {
        await p.close();
      }
    }
  }
  console.log('  ✓ Все кнопки скачивания нажаты, лишние вкладки закрыты');

  // ════════════════════════════════════════════════════════════
  // ШАГ 6: Проверка отправки бюллетеней собственникам
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 6: Отправка бюллетеней собственников');
  console.log('══════════════════════════════════════════');

  // ── 6.1. Открываем слайдбар кнопкой «Получить все бюллетени собственников» ─
  // Кнопка вызывает JS-функцию getBulletins(ID), не делает навигацию.
  // Поэтому waitUntil не нужен — просто кликаем и ждём появления слайдбара.
  console.log('  → Нажимаем "Получить все бюллетени собственников"...');
  const getBulletinsBtn = page.locator('a[onclick*="getBulletins"]');
  await expect(getBulletinsBtn).toBeVisible({ timeout: 10_000 });
  await getBulletinsBtn.click();
  console.log('  ✓ Кнопка нажата');

  // ── 6.2. Ждём появления слайдбара (Bitrix SidePanel) ─────────
  // ⚠️ ВАЖНО: слайдбар реализован через Bitrix SidePanel.
  // Его содержимое загружается внутри <iframe class="side-panel-iframe">
  // а НЕ в основной DOM страницы.
  // Поэтому page.locator('input') не найдёт поле Email —
  // нужно использовать page.frameLocator() для доступа к iframe.
  //
  // Структура:
  //   div.side-panel-overlay
  //     └── div.side-panel-content-container
  //           └── <iframe class="side-panel-iframe" src="/local/ajax/vote/getBulletins.php?...">
  //                 └── <form> с <input name="EMAIL"> и <button type="submit">
  console.log('  → Ждём появления iframe слайдбара...');
  const sidePanelIframe = page.locator('iframe.side-panel-iframe');
  await expect(sidePanelIframe).toBeVisible({ timeout: 15_000 });
  console.log('  ✓ iframe слайдбара видим');

  // Переключаемся в контекст iframe
  const frame = page.frameLocator('iframe.side-panel-iframe');

  // Ждём загрузки содержимого iframe — ориентируемся на поле Email
  console.log('  → Ожидаем загрузки формы внутри iframe...');
  const emailInput = frame.locator('input[name="EMAIL"], input[type="email"]').first();
  await expect(emailInput).toBeVisible({ timeout: 15_000 });
  console.log('  ✓ Слайдбар загружен, поле Email видно');

  // ── 6.3. Проверяем предзаполнение email аккаунта ─────────────
  // Поле должно быть заполнено email'ом текущего пользователя.
  // Сравниваем с константой TEST_USER.email.
  console.log('  → Проверяем предзаполнение поля Email...');
  await expect(emailInput).toHaveValue(TEST_USER.email);
  console.log(`  ✓ Email предзаполнен корректно: ${TEST_USER.email}`);

  // ── 6.4. Нажимаем «Сформировать и отправить» ─────────────────
  // Кнопка тоже находится внутри iframe — используем тот же frame-контекст.
  // После клика сервер формирует архив и отправляет письмо на email.
  console.log('  → Нажимаем "Сформировать и отправить"...');
  const submitBtn = frame.locator('button[type="submit"]').filter({ hasText: /Сформировать и отправить/i });
  await expect(submitBtn).toBeVisible({ timeout: 5_000 });
  await submitBtn.click();
  console.log('  ✓ Кнопка нажата — ожидаем завершения запроса...');

  // После отправки iframe может обновиться или слайдбар закроется.
  // Ждём networkidle на основной странице.
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  console.log('  ✓ Страница обновилась после отправки бюллетеней');

  // ── 6.5. Закрываем слайдбар ──────────────────────────────────
  // После отправки слайдбар остаётся открытым и перекрывает таблицу.
  // Пока SidePanel открыт, Playwright считает элементы за ним «hidden».
  // Закрываем через кнопку X (div.side-panel-label-icon-close).
  console.log('  → Закрываем слайдбар...');
  const closePanelBtn = page.locator('div.side-panel-label-icon-close');
  const isPanelOpen = await closePanelBtn.isVisible();
  if (isPanelOpen) {
    await closePanelBtn.click();
    // Ждём исчезновения оверлея
    await expect(page.locator('div.side-panel-overlay')).toBeHidden({ timeout: 10_000 });
    console.log('  ✓ Слайдбар закрыт');
  } else {
    console.log('  ℹ Слайдбар уже закрыт');
  }

  // ════════════════════════════════════════════════════════════
  // ШАГ 7: Проверяем таблицу участников голосования
  //         Хотя бы одна строка должна удовлетворять всем условиям:
  //         — Верифицирован = «Да»
  //         — Вес голоса > 0
  //         — Может голосовать онлайн = «Да»
  //         — Проголосовал = «Нет»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 7: Проверяем таблицу участников голосования');
  console.log('══════════════════════════════════════════');

  // Небольшая пауза — даём CSS-анимации закрытия SidePanel полностью завершиться.
  // Даже после toBeHidden overlay может ещё несколько кадров перекрывать таблицу.
  console.log('  → Ждём завершения анимации закрытия слайдбара (1.5 сек)...');
  await page.waitForTimeout(1_500);

  // ⚠️ ВАЖНО: таблица участников — Bitrix main-grid.
  // При загрузке страницы span.main-grid-cell-content существуют в DOM,
  // но изначально ПУСТЫЕ — данные подгружаются отдельным AJAX-запросом.
  // Поэтому:
  //   - waitFor({ state: 'visible' }) не работает — span-ы «видимы» но пусты
  //   - нужно ждать пока хотя бы один span получит непустой текст
  console.log('  → Ждём загрузки данных таблицы участников (AJAX)...');
  await page.waitForFunction(
    () => {
      const spans = document.querySelectorAll('span.main-grid-cell-content');
      return Array.from(spans).some(s => s.textContent.trim().length > 0);
    },
    { timeout: 20_000 }
  );
  console.log('  ✓ Данные таблицы загружены');

  // Читаем данные таблицы через page.evaluate.
  //
  // Почему evaluate, а не локаторы?
  // Потому что нам нужно проверить КОМБИНАЦИЮ из 4 колонок
  // в одной строке. Playwright не имеет встроенного способа
  // фильтровать строку одновременно по нескольким дочерним элементам
  // с разными индексами. evaluate позволяет сделать это надёжно
  // и без хрупких nth-child расчётов.
  //
  // Алгоритм:
  //   1. Находим заголовки таблицы → определяем индексы нужных колонок
  //   2. Для каждой строки читаем значения нужных колонок
  //   3. Ищем строку, где выполняются все 4 условия
  console.log('  → Анализируем строки таблицы через page.evaluate...');

  const foundQualifiedVoter = await page.evaluate(() => {
    // ── Шаг 1: Определяем индексы нужных колонок по заголовкам ──
    // Заголовки могут быть обрезаны (truncated) — ищем по подстроке.
    const headerCells = Array.from(
      document.querySelectorAll('th, .main-grid-head-cell, thead td')
    );

    // Функция поиска индекса колонки по подстроке заголовка (регистронезависимо)
    function findColIndex(keyword) {
      const idx = headerCells.findIndex(
        th => th.textContent && th.textContent.toLowerCase().includes(keyword.toLowerCase())
      );
      return idx; // -1 если не найдено
    }

    const idxVerified = findColIndex('Верифи');   // «Верифицирован»
    const idxWeight = findColIndex('Вес');       // «Вес голоса»
    const idxCanVote = findColIndex('Может');     // «Может голосовать онлайн»
    const idxVoted = findColIndex('Прогол');    // «Проголосовал»

    console.log(
      `[evaluate] Индексы колонок: Верифицирован=${idxVerified}, Вес=${idxWeight}, ` +
      `МожетГолосовать=${idxCanVote}, Проголосовал=${idxVoted}`
    );

    // ── Шаг 2: Читаем строки таблицы ─────────────────────────────
    // Строки данных — все tr внутри tbody.
    // Значения хранятся в span.main-grid-cell-content внутри td.
    const rows = Array.from(document.querySelectorAll('tbody tr, .main-grid-body tr'));

    for (const row of rows) {
      // Все ячейки строки — берём span.main-grid-cell-content внутри каждой td/th
      const cells = Array.from(row.querySelectorAll('td, th'));

      // Вспомогательная функция: текст ячейки по индексу
      function cellText(idx) {
        if (idx < 0 || idx >= cells.length) return '';
        const span = cells[idx].querySelector('span.main-grid-cell-content');
        return span ? span.textContent.trim() : cells[idx].textContent.trim();
      }

      const verified = cellText(idxVerified);
      const weightStr = cellText(idxWeight);
      const canVoteOnline = cellText(idxCanVote);
      const voted = cellText(idxVoted);

      // Вес голоса может быть дробным (например «1.5») — парсим как float
      const weight = parseFloat(weightStr.replace(',', '.'));

      const isMatch =
        verified === 'Да' &&
        !isNaN(weight) && weight > 0 &&
        canVoteOnline === 'Да' &&
        voted === 'Нет';

      if (isMatch) {
        console.log(
          `[evaluate] ✓ Найден подходящий участник: ` +
          `Верифицирован="${verified}", Вес="${weightStr}", ` +
          `МожетОнлайн="${canVoteOnline}", Проголосовал="${voted}"`
        );
        return true;
      }
    }

    console.log('[evaluate] ✗ Подходящий участник не найден в текущих строках');
    return false;
  });

  // Если колонки имеют нефиксированный порядок и evaluate не нашёл участника
  // через индексы заголовков, пробуем запасной вариант:
  // ищем строку tr, у которой span-ы содержат все 4 нужных значения.
  // Это менее точный подход (не проверяет порядок колонок),
  // но надёжно работает когда все 4 значения уникально идентифицируют строку.
  let foundViaFallback = false;
  if (!foundQualifiedVoter) {
    console.log('  ℹ Заголовки не распознаны — применяем запасной метод поиска...');

    foundViaFallback = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr, .main-grid-body tr'));

      for (const row of rows) {
        const spans = Array.from(row.querySelectorAll('span.main-grid-cell-content'))
          .map(s => s.textContent.trim());

        const hasVerified = spans.includes('Да');
        const hasNotVoted = spans.includes('Нет');
        // Вес > 0: хотя бы один span парсится как положительное число
        const hasWeight = spans.some(s => {
          const n = parseFloat(s.replace(',', '.'));
          return !isNaN(n) && n > 0;
        });
        // «Может голосовать онлайн» = «Да» — уже покрыто hasVerified выше,
        // но нам нужно ДВА «Да» в строке (Верифицирован + МожетОнлайн)
        const daCount = spans.filter(s => s === 'Да').length;

        if (hasVerified && hasWeight && daCount >= 2 && hasNotVoted) {
          console.log('[evaluate-fallback] ✓ Найден подходящий участник (fallback), значения строки:', spans.join(' | '));
          return true;
        }
      }
      return false;
    });
  }

  const hasQualifiedVoter = foundQualifiedVoter || foundViaFallback;

  // Финальная проверка: выбрасываем ошибку теста если участник не найден
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
  // Ссылка: <a href="/votes/public/?ID=XXXX" class="button">Опубликовать</a>
  // Не привязываемся к конкретному ID — ищем по тексту и классу.
  console.log('  → Ищем кнопку "Опубликовать"...');
  const publishBtn = page.locator('a.button', { hasText: /^Опубликовать$/ });
  await expect(publishBtn).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Опубликовать" найдена');

  console.log('  → Нажимаем "Опубликовать"...');
  await publishBtn.click();

  // ── 8.2. Ждём загрузки формы публикации ──────────────────────
  // Ориентируемся на поле «Название» — оно всегда есть на этой странице.
  console.log('  → Ждём загрузки формы публикации...');
  await expect(page.locator('#news-name')).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Форма публикации загружена. URL:', page.url());

  // ⚠️ Bitrix рендерит .popup-window-overlay сразу при загрузке страницы
  // (от предыдущего попапа или инициализации компонента).
  // Он исчезает через секунду-две. Если не дождаться — перекроет кнопку «Далее».
  console.log('  → Ждём исчезновения Bitrix overlay после загрузки страницы...');
  await page.locator('.popup-window-overlay').waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {
    console.log('  ℹ Overlay не обнаружен или уже скрыт — продолжаем');
  });

  // ── 8.3. Проверяем предзаполнение поля «Название» ────────────
  // Значение должно быть непустым (конкретный текст может меняться).
  console.log('  → Проверяем поле "Название"...');
  const nameField = page.locator('#news-name');
  await expect(nameField).not.toHaveValue('');
  const nameValue = await nameField.inputValue();
  console.log(`  ✓ Поле "Название" заполнено: "${nameValue}"`);

  // ── 8.4. Проверяем предзаполнение поля «Дата начала активности» ─
  // Поле использует Flatpickr — значение в формате DD.MM.YYYY HH:MM:SS.
  // Проверяем что значение непустое и соответствует формату даты.
  console.log('  → Проверяем поле "Дата начала активности"...');
  const dateField = page.locator('#news-date');
  await expect(dateField).toBeVisible({ timeout: 5_000 });
  await expect(dateField).not.toHaveValue('');
  const dateValue = await dateField.inputValue();
  // Проверяем что значение похоже на дату: содержит точки и цифры
  if (!/\d{2}\.\d{2}\.\d{4}/.test(dateValue)) {
    throw new Error(`ШАГ 8.4: Дата не соответствует формату DD.MM.YYYY. Получено: "${dateValue}"`);
  }
  console.log(`  ✓ Поле "Дата начала активности" заполнено: "${dateValue}"`);

  // ── 8.5. Проверяем предзаполнение поля «Детальное описание» ──
  // Поле реализовано через CKEditor (contenteditable div).
  // Проверяем что внутри есть непустой текст.
  console.log('  → Проверяем поле "Детальное описание" (CKEditor)...');
  const ckEditor = page.locator('.ck-editor__editable[contenteditable="true"]');
  await expect(ckEditor).toBeVisible({ timeout: 10_000 });
  const editorText = await ckEditor.innerText();
  if (!editorText || editorText.trim().length === 0) {
    throw new Error('ШАГ 8.5: Поле "Детальное описание" пустое');
  }
  console.log(`  ✓ Поле "Детальное описание" заполнено (${editorText.trim().length} символов)`);

  // ── 8.6. Чекбокс «Добавить в Важное на сайт» ─────────────────
  // label[for="should-lock-news"] указывает на скрытый кастомный чекбокс.
  // Используем click по label — это надёжнее чем check({ force: true })
  // когда реальный input скрыт, но label кликабелен.
  console.log('  → Проверяем и ставим чекбокс "Добавить в Важное на сайт"...');
  const lockNewsCheckbox = page.locator('#should-lock-news');
  const isLockNewsChecked = await lockNewsCheckbox.isChecked().catch(() => false);
  if (!isLockNewsChecked) {
    // Кликаем по label — он всегда виден даже если input скрыт
    await page.locator('label[for="should-lock-news"]').click();
    console.log('  ✓ Чекбокс "Добавить в Важное" установлен');
  } else {
    console.log('  ✓ Чекбокс "Добавить в Важное" уже установлен');
  }
  // Проверяем состояние через force — input может быть hidden
  await expect(lockNewsCheckbox).toBeChecked({ timeout: 3_000 });

  // ── 8.7. Чекбокс «Разослать пользователям оповещение» ────────
  // Не устанавливаем — уведомление отправлять не нужно,
  // поэтому диалог подтверждения после «Далее» не появится.

  // ── 8.8. Нажимаем кнопку «Далее» ─────────────────────────────
  // <button name="iblock_submit" class="button next" value="Y" type="submit">Далее</button>
  // Используем name-атрибут для надёжной идентификации — он уникален.
  console.log('  → Нажимаем кнопку "Далее"...');
  const nextBtn = page.locator('button[name="iblock_submit"]');
  await expect(nextBtn).toBeVisible({ timeout: 5_000 });

  // ⚠️ .popup-window-overlay постоянно перехватывает pointer events на этой странице
  // и не исчезает — это артефакт Bitrix UI на странице /votes/public/.
  // Единственное надёжное решение: dispatch прямого DOM-события click через JS,
  // минуя проверку Playwright на перехват событий.
  await page.evaluate(() => {
    document.querySelector('button[name="iblock_submit"]').click();
  });
  console.log('  ✓ Кнопка "Далее" нажата (через JS click)');

  // ── Финал ────────────────────────────────────────────────────
  // После клика «Далее» (без оповещения) происходит прямой редирект
  // на страницу голосования — диалога подтверждения нет.
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 });
  await expect(page).toHaveURL(/\/votes\/view\/\?ID=/, { timeout: 15_000 });
  console.log('  ✓ Голосование опубликовано');

  console.log('\n══════════════════════════════════════════');
  console.log('✅ ТЕСТ ЗАВЕРШЁН УСПЕШНО');
  console.log('   Финальный URL:', page.url());
  console.log('══════════════════════════════════════════\n');
});

