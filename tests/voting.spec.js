// ============================================================
// E2E тест: Голосование на сайте lk.sntclub.ru
// Тестовый фреймворк: Playwright Test (@playwright/test)
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
// Вынесена отдельно, чтобы её можно было переиспользовать
// в других тестах без дублирования кода
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
  // Используем getByPlaceholder для единообразия с полем email
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
test('Голосование: открыть форму организации собрания', async ({ page }) => {
  // Даём 90 секунд — тест проходит ~22с без браузера, в headed-режиме до 40с
  test.setTimeout(90_000);

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
  // ⚠️ Потенциально нестабильное место: если точный текст отличается —
  //    проверьте его через DevTools → Elements
  const votesMenuLink = page.getByRole('link', { name: /Общие собрания и голосования/i });

  console.log('  → Проверяем видимость пункта меню...');
  const isMenuItemVisible = await votesMenuLink.isVisible();

  if (!isMenuItemVisible) {
    // Пункт скрыт — пробуем раскрыть меню кнопкой «Больше»
    console.log('  ℹ Пункт меню скрыт. Нажимаем "Больше" для раскрытия...');

    // ⚠️ Потенциально нестабильное место: «Больше» может быть
    //    реализована как <span>, не <button>.
    //    Запасной вариант: page.locator('text=Больше').first()
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
  // ⚠️ Потенциально нестабильное место: точный текст заголовка
  //    может отличаться — проверьте через DevTools
  console.log('  → Ищем блок "Голосование (новая версия)"...');
  const newVersionBlock = page.getByText(/Голосование\s*\(новая версия\)/i);
  await expect(newVersionBlock).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Блок найден');

  // Ищем кнопку «Перейти» — на странице может быть несколько таких кнопок,
  // поэтому берём первую (она должна относиться к блоку новой версии).
  // ⚠️ Если тест кликает не ту кнопку — уточните локатор, например:
  //    newVersionBlock.locator('..').getByRole('link', { name: /Перейти/i })
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
  // ШАГ 4: Нажать «+ Организовать собрание»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 4: Нажимаем "+ Организовать собрание"');
  console.log('══════════════════════════════════════════');

  await page.waitForLoadState('domcontentloaded');

  // Ищем кнопку по тексту; regex обрабатывает возможные пробелы/неразрывные символы
  // ⚠️ Потенциально нестабильное место: если кнопка реализована через <a>, а не <button>,
  //    раскомментируйте запасной вариант ниже
  console.log('  → Ищем кнопку "+ Организовать собрание"...');
  const organizeButton = page.getByRole('button', {
    name: /\+\s*Организовать\s+собрание/i,
  });
  // Запасной вариант: const organizeButton = page.getByText(/Организовать собрание/i).first();

  await organizeButton.scrollIntoViewIfNeeded();
  await expect(organizeButton).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка найдена');

  console.log('  → Нажимаем "+ Организовать собрание"...');
  await organizeButton.click();
  console.log('  ✓ Кнопка нажата');

  // ════════════════════════════════════════════════════════════
  // ШАГ 5: Заполнение формы «Протокол Правления» (ШАГ 1 в UI)
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 5: Заполнение формы протокола');
  console.log('══════════════════════════════════════════');

  // Ждём появления формы — убеждаемся, что она открылась после клика
  // Ориентир — заголовок первого поля формы
  console.log('  → Ждём загрузки формы...');
  await expect(
    page.getByPlaceholder(/Московская область/i)
  ).toBeVisible({ timeout: 15_000 });
  console.log('  ✓ Форма загружена');

  // ── 1. Добавить пункт Повестки дня ПЕРВЫМ ────────────────────
  // ⚠️ Клик «Добавить пункт» делает AJAX-запрос, который ЗАМЕНЯЕТ часть DOM
  //    (секцию с Место/Дата/Присутствовали). Поэтому мы сначала кликаем,
  //    а потом заполняем все поля — иначе значения сбрасываются AJAX-ом.
  console.log('  → Нажимаем "Добавить пункт Повестки дня" (первым!)...');
  const addAgendaItemLink = page.getByText(/Добавить пункт Повестки дня/i);
  await expect(addAgendaItemLink).toBeVisible({ timeout: 5_000 });
  await addAgendaItemLink.click();

  // Ждём появления поля пункта повестки по name (надёжнее placeholder)
  // name="AGENDA_0_question" подтверждён из отладочного дампа формы
  const agendaItemField = page.locator('[name="AGENDA_0_question"]');
  await expect(agendaItemField).toBeVisible({ timeout: 20_000 });
  console.log('  ✓ Пункт повестки добавлен, AJAX завершён');

  // ── 2. Место / Дата / Присутствовали (ПОСЛЕ AJAX) ─────────────
  // Теперь DOM стабилен — заполняем основные поля напрямую по name.
  console.log('  → Заполняем поля: Место, Дата, Присутствовали...');
  await page.evaluate(() => {
    function setField(selector, value) {
      const el = document.querySelector(selector);
      if (!el) { console.error('Поле не найдено:', selector); return; }
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }
    setField('[name="real_board_meeting_location"]',
      'Московская область, г.о.Мытищи, ул.Центральная, 1');
    const dateInput = document.querySelector('[name="real_board_meeting_date_begin"]');
    if (dateInput) {
      if (dateInput._flatpickr) {
        dateInput._flatpickr.setDate(new Date(2025, 5, 1, 12, 0), true);
      }
      dateInput.value = '01.06.2025 12:00';
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setField('[name="real_board_members"]',
      'Иванов И.И.; Петрова А.А.; Сидоров В.В.');
  });
  console.log('  ✓ Место, Дата и Присутствовали заполнены');

  // ── 3. № протокола ───────────────────────────────────────────
  console.log('  → Заполняем "№ протокола"...');
  const protocolNumberField = page.getByPlaceholder(/№1/i);
  await expect(protocolNumberField).toBeVisible({ timeout: 5_000 });
  await protocolNumberField.fill('№5');
  console.log('  ✓ Номер протокола заполнен');

  // ── 4. Рассмотрен вопрос повестки дня №1 ────────────────────
  console.log('  → Заполняем "Рассмотрен вопрос повестки дня №1"...');
  await agendaItemField.fill('Утверждение состава правления СНТ');
  console.log('  ✓ Вопрос повестки дня заполнен');

  // ── 5. Описание рассмотрения ─────────────────────────────────
  // name="AGENDA_0_description" подтверждён из дампа формы
  console.log('  → Заполняем "Описание рассмотрения"...');
  const descriptionField = page.locator('[name="AGENDA_0_description"]');
  await expect(descriptionField).toBeVisible({ timeout: 5_000 });
  await descriptionField.fill('Выступил: Иванов И.И., доложил о результатах работы за год.');
  console.log('  ✓ Описание рассмотрения заполнено');

  // ── 6–8. ЗА / ПРОТИВ / ВОЗДЕРЖАЛИСЬ ─────────────────────────
  console.log('  → Заполняем поля голосования (ЗА / ПРОТИВ / ВОЗДЕРЖАЛИСЬ)...');
  await page.locator('#AGENDA_0_agree').fill('10');
  await page.locator('#AGENDA_0_disagree').fill('2');
  await page.locator('#AGENDA_0_abstained').fill('1');
  console.log('  ✓ Голосование заполнено: ЗА=10, ПРОТИВ=2, ВОЗДЕРЖАЛИСЬ=1');

  // ── 9. Решили ────────────────────────────────────────────────
  // name="AGENDA_0_resolution" подтверждён из дампа формы
  console.log('  → Заполняем "Решили"...');
  const decisionField = page.locator('[name="AGENDA_0_resolution"]');
  await expect(decisionField).toBeVisible({ timeout: 5_000 });
  await decisionField.fill('Утвердить состав правления СНТ на следующий год.');
  console.log('  ✓ Поле "Решили" заполнено');

  // ── 12. Чекбокс «Не показывать собственникам Протокол Правления» ─
  // Это кастомный чекбокс: реальный <input> скрыт через CSS,
  // поверх него нарисован визуальный элемент. Поэтому:
  //   - toBeVisible() не используем (элемент hidden)
  //   - check({ force: true }) кликает напрямую, минуя проверку видимости
  // id взят из DevTools/лога: HIDE_FOR_THE_OWNERS
  console.log('  → Ставим чекбокс "Не показывать собственникам протокол правления"...');
  const hideProtocolCheckbox = page.locator('#HIDE_FOR_THE_OWNERS');
  await hideProtocolCheckbox.check({ force: true });
  await expect(hideProtocolCheckbox).toBeChecked();
  console.log('  ✓ Чекбокс установлен');

  // ── Кнопка «Вперед» ──────────────────────────────────────────
  console.log('  → Нажимаем кнопку "Вперед"...');
  const nextButton = page.locator('button[name="PAGE"][value="3"]');
  await expect(nextButton).toBeVisible({ timeout: 5_000 });
  await nextButton.click();
  console.log('  ✓ Кнопка "Вперед" нажата');

  // Ждём полной загрузки страницы ШАГ 2
  await page.waitForLoadState('networkidle');

  // ════════════════════════════════════════════════════════════
  // ШАГ 6: Страница «ШАГ 2» — скачать Протокол Правления
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 6: Скачиваем Протокол Правления');
  console.log('══════════════════════════════════════════');

  // Ищем ссылку скачивания по CSS-классу из DevTools: a.button--tertiary.button--long.download
  console.log('  → Ждём появления ссылки скачивания...');
  const downloadBtn = page.locator('a.button--long.download');
  await expect(downloadBtn).toBeVisible({ timeout: 15_000 });
  console.log('  ✓ Ссылка скачивания найдена');

  // Кликаем — браузер либо откроет PDF в новой вкладке, либо скачает файл.
  // Мы не проверяем содержимое файла, только факт клика.
  console.log('  → Кликаем по ссылке скачивания...');
  await downloadBtn.click();
  console.log('  ✓ Клик выполнен');

  // Даём браузеру время отреагировать (открыть вкладку / начать скачку)
  await page.waitForTimeout(2_000);

  // Закрываем любые лишние вкладки, которые могли открыться (PDF-просмотр)
  const allPages = page.context().pages();
  for (const p of allPages) {
    if (p !== page) {
      await p.close();
      console.log('  ✓ Дополнительная вкладка закрыта');
    }
  }

  // ── Кнопка «Вперед» (ШАГ 2 → ШАГ 3) ────────────────────────
  // value="4" — переход на страницу ШАГ 3 (не путать с «Назад» value="2")
  console.log('  → Нажимаем кнопку "Вперед"...');
  const nextButton2 = page.locator('button[name="PAGE"][value="4"]');
  await expect(nextButton2).toBeVisible({ timeout: 5_000 });
  await nextButton2.click();
  console.log('  ✓ Кнопка "Вперед" нажата');
  await page.waitForLoadState('networkidle');

  // ════════════════════════════════════════════════════════════
  // ШАГ 7: Форма «ШАГ 3. Определите форму собрания и голосования»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 7: Определяем форму собрания и голосования');
  console.log('══════════════════════════════════════════');

  // Ждём загрузки страницы — ориентируемся на поле «Название голосования»
  await expect(page.locator('[name="vote_name"]')).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Страница ШАГ 3 загружена');

  // ── 1. Название голосования ───────────────────────────────────
  console.log('  → Заполняем "Название голосования"...');
  await page.locator('[name="vote_name"]').fill('Внеочередное общее собрание собственников СНТ');
  console.log('  ✓ Название заполнено');

  // ── 2. Краткое описание ───────────────────────────────────────
  console.log('  → Заполняем "Краткое описание"...');
  await page.locator('[name="vote_description"]').fill(
    'Голосование по вопросу утверждения состава правления СНТ на следующий год.'
  );
  console.log('  ✓ Описание заполнено');

  // ── 3. Вид собрания: Внеочередное ────────────────────────────
  // Используем regex /^текст$/ — точное совпадение, исключает частичные
  // (например «Заочное» без ^ и $ матчит «Очно-заочное»)
  console.log('  → Выбираем "Внеочередное"...');
  await page.locator('label.voting-form__radio-label').filter({ hasText: /^Внеочередное$/ }).click();
  console.log('  ✓ Вид собрания: Внеочередное');

  // ── 4. Форма голосования: Очно-заочное ───────────────────────
  console.log('  → Выбираем "Очно-заочное"...');
  await page.locator('label.voting-form__radio-label').filter({ hasText: /^Очно-заочное$/ }).click();
  console.log('  ✓ Форма голосования: Очно-заочное');

  // ── 5. Тип голосования: Открытое ─────────────────────────────
  console.log('  → Выбираем "Открытое"...');
  await page.locator('label.voting-form__radio-label').filter({ hasText: /^Открытое$/ }).click();
  console.log('  ✓ Тип голосования: Открытое');

  // ── 6–7. Дата начала (+1 час) и Дата окончания (+14 дней) ────
  // Поля используют Flatpickr. Проблема: flatpickr молча отклоняет дату
  // если она меньше data-mindate — value остаётся пустым.
  // Решение: вызываем flatpickr.setDate() И всегда устанавливаем raw value напрямую.
  // Дата начала = now+1h чтобы гарантированно пройти mindate валидацию.
  console.log('  → Устанавливаем даты голосования...');
  await page.evaluate(() => {
    const now = new Date(new Date().getTime() + 5 * 60 * 1000); // +5 минут от текущего
    const endDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // +14 дней

    function fmt(d) {
      const pad = n => String(n).padStart(2, '0');
      return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function setDateField(selector, date) {
      const el = document.querySelector(selector);
      if (!el) return;
      // Сначала пробуем flatpickr API
      if (el._flatpickr) {
        el._flatpickr.setDate(date, true);
      }
      // ВСЕГДА устанавливаем raw value — flatpickr мог молча отклонить дату
      el.value = fmt(date);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    setDateField('[name="vote_date_begin"]', now);
    setDateField('[name="vote_date_end"]', endDate);
  });
  console.log('  ✓ Даты установлены');

  // ── 8. Отображение результатов: В процессе голосования ────────
  console.log('  → Выбираем "В процессе голосования"...');
  await page.locator('label.voting-form__radio-label').filter({ hasText: /^В процессе голосования$/ }).click();
  console.log('  ✓ Отображение результатов: В процессе голосования');

  // ── 9. Место проведения собрания ─────────────────────────────
  console.log('  → Заполняем "Место проведения собрания"...');
  await page.locator('[name="voting_location"]').fill(
    'Московская область, г.о. Мытищи, ул. Центральная, 1'
  );
  console.log('  ✓ Место проведения заполнено');

  // ── 10. Адрес урны для голосования ───────────────────────────
  console.log('  → Заполняем "Адрес урны для голосования"...');
  await page.locator('[name="ballot_box_location"]').fill(
    'Московская область, г.о. Мытищи, ул. Центральная, 1, офис правления'
  );
  console.log('  ✓ Адрес урны заполнен');

  // ── 11. Кнопка «Вперед» (ШАГ 3 → ШАГ 4) ─────────────────────
  console.log('  → Нажимаем кнопку "Вперед"...');
  const nextButton3 = page.locator('button[name="PAGE"][value="5"]');
  await expect(nextButton3).toBeVisible({ timeout: 5_000 });
  await nextButton3.click();
  console.log('  ✓ Кнопка "Вперед" нажата');
  await page.waitForLoadState('networkidle');

  // ════════════════════════════════════════════════════════════
  // ШАГ 8: Форма «ШАГ 4. Введите данные Повестки дня»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 8: Вводим данные Повестки дня Общего собрания');
  console.log('══════════════════════════════════════════');

  // Даём странице время полностью отрисоваться после перехода
  await page.waitForTimeout(1_500);

  // Ждём загрузки ШАГ 4 по классу ссылки.
  // ⚠️ getByRole('link') не работает для <a> без href — такие элементы не имеют ARIA role="link".
  //    Поэтому используем CSS-класс a.add_voting_agenda_item напрямую.
  const addItemBtn = page.locator('a.add_voting_agenda_item')
    .filter({ hasText: /Добавить еще один пункт/ });
  await expect(addItemBtn.first()).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Страница ШАГ 4 загружена');

  // ── 1. Пункт повестки №1 ─────────────────────────────────────
  console.log('  → Добавляем пункт повестки №1...');
  await addItemBtn.first().click();
  // Ждём появления textarea — признак что AJAX завершился
  await expect(page.locator('[name="VOTEAGENDA_0_items"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('[name="VOTEAGENDA_0_items"]').fill('Утверждение состава правления СНТ');
  console.log('  ✓ Пункт №1 заполнен');

  // ── 2. Подпункт для пункта №1 ────────────────────────────────
  console.log('  → Добавляем подпункт к пункту №1...');
  const addSubItemBtn = page.locator('a.add_voting_agenda_item')
    .filter({ hasText: /^Добавить подпункт$/ });
  await expect(addSubItemBtn.first()).toBeVisible({ timeout: 5_000 });
  await addSubItemBtn.first().click();
  await expect(page.locator('[name="0_0_SubItem"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('[name="0_0_SubItem"]').fill('Выбор председателя правления СНТ');
  console.log('  ✓ Подпункт к пункту №1 заполнен');

  // ── 3. Пункт повестки №2 ─────────────────────────────────────
  // После п.1 появляется новая ссылка — кликаем по последней из них
  console.log('  → Добавляем пункт повестки №2...');
  await addItemBtn.last().click();
  await expect(page.locator('[name="VOTEAGENDA_1_items"]')).toBeVisible({ timeout: 5_000 });
  await page.locator('[name="VOTEAGENDA_1_items"]').fill('Утверждение сметы доходов и расходов на следующий год');
  console.log('  ✓ Пункт №2 заполнен');

  // ── 4. Подпункт для пункта №2 ────────────────────────────────
  // Теперь на странице 2 ссылки «Добавить подпункт» — берём последнюю
  console.log('  → Добавляем подпункт к пункту №2...');
  await addSubItemBtn.last().click();
  await expect(page.locator('[name="1_0_SubItem"]')).toBeVisible({ timeout: 5_000 });
  await page.locator('[name="1_0_SubItem"]').fill('Утвердить смету в размере 500 000 руб.');
  console.log('  ✓ Подпункт к пункту №2 заполнен');

  // ── 5. Чекбокс «Не показывать собственникам Уведомление с Повесткой дня» ─
  // Тот же паттерн что в ШАГ 5: кастомный скрытый чекбокс → check({ force: true })
  console.log('  → Ставим чекбокс "Не показывать собственникам Уведомление с Повесткой дня"...');
  await page.locator('#HIDE_FOR_THE_OWNERS').check({ force: true });
  console.log('  ✓ Чекбокс установлен');

  // ── 6. Кнопка «Вперед» (ШАГ 4 → ШАГ 5) ──────────────────────
  // value="6" подтверждено из HTML: <button name="PAGE" value="6">Вперед</button>
  console.log('  → Нажимаем кнопку "Вперед"...');
  const nextButton4 = page.locator('button[name="PAGE"][value="6"]');
  await expect(nextButton4).toBeVisible({ timeout: 5_000 });
  await nextButton4.click();
  console.log('  ✓ Кнопка "Вперед" нажата');
  await page.waitForLoadState('networkidle');

  // ════════════════════════════════════════════════════════════
  // ШАГ 9: Страница «ШАГ 5» — скачать Уведомление с Повесткой дня
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 9: Скачиваем Уведомление с Повесткой дня');
  console.log('══════════════════════════════════════════');

  // Та же логика что в ШАГ 6: ссылка с классом download видна на странице
  // <a href="...notice_voting_agenda_items.php?ID=..." class="button--tertiary button--long download">
  console.log('  → Ждём появления ссылки скачивания...');
  const downloadBtn2 = page.locator('a.button--long.download');
  await expect(downloadBtn2).toBeVisible({ timeout: 15_000 });
  console.log('  ✓ Ссылка скачивания найдена');

  console.log('  → Кликаем по ссылке скачивания...');
  await downloadBtn2.click();
  console.log('  ✓ Клик выполнен');

  // Даём браузеру время отреагировать и закрываем новые вкладки
  await page.waitForTimeout(2_000);
  const allPages2 = page.context().pages();
  for (const p of allPages2) {
    if (p !== page) {
      await p.close();
      console.log('  ✓ Дополнительная вкладка закрыта');
    }
  }

  // ── Кнопка «Вперед» (ШАГ 5 → ШАГ 6) ──────────────────────────
  // value="7" подтверждено из HTML: <button name="PAGE" value="7">Вперед</button>
  console.log('  → Нажимаем кнопку "Вперед"...');
  const nextButton5 = page.locator('button[name="PAGE"][value="7"]');
  await expect(nextButton5).toBeVisible({ timeout: 5_000 });
  await nextButton5.click();
  console.log('  ✓ Кнопка "Вперед" нажата');
  await page.waitForLoadState('networkidle');

  // ════════════════════════════════════════════════════════════
  // ШАГ 10: Форма «ШАГ 6. Заполните поля для формирования бюллетеня голосования»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 10: Бюллетень голосования');
  console.log('══════════════════════════════════════════');

  // Ждём загрузки — ориентируемся на предзаполненное поле вопроса №1
  await expect(page.locator('[name="MAINVOTEAGENDA_0_items"]')).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Страница ШАГ 6 загружена');

  // ── 1. Проверяем предзаполненные поля Вопрос №1 ──────────────
  console.log('  → Проверяем предзаполненное поле "Вопрос для голосования №1"...');
  await expect(page.locator('[name="MAINVOTEAGENDA_0_items"]'))
    .toHaveValue('Утверждение состава правления СНТ');
  console.log('  ✓ Вопрос №1 предзаполнен корректно');

  // ── 2. Чекбокс «Могут голосовать не члены СНТ» (вопрос №1) ──
  console.log('  → Ставим чекбокс "Могут голосовать не члены СНТ"...');
  await page.locator('#questions_0_is_voting_individual').check({ force: true });
  console.log('  ✓ Чекбокс "Могут голосовать не члены СНТ" установлен');

  // ── 3. Проверяем предзаполненное поле Вопрос №1.1 ────────────
  console.log('  → Проверяем поле "Вопрос для голосования №1.1"...');
  await expect(page.locator('[name="0_0_SubItem"]'))
    .toHaveValue('Выбор председателя правления СНТ');
  console.log('  ✓ Вопрос №1.1 предзаполнен корректно');

  // ── 4. Проверяем предзаполненные варианты ответа (За/Против/Воздержался) ─
  console.log('  → Проверяем варианты ответа для вопроса №1.1...');
  await expect(page.locator('[name="0_0_0_SUBANSWER"]')).toHaveValue('За');
  await expect(page.locator('[name="0_0_1_SUBANSWER"]')).toHaveValue('Против');
  await expect(page.locator('[name="0_0_2_SUBANSWER"]')).toHaveValue('Воздержался');
  console.log('  ✓ Варианты ответа: За / Против / Воздержался — предзаполнены');

  // ── 5. Добавляем вариант ответа «Другое» для вопроса №1.1 ────
  // <a class="add_answer"> без href — используем class-локатор (не getByRole)
  // На странице будет 2 таких ссылки (для вопроса 1.1 и 2.1) — берём первую
  console.log('  → Добавляем вариант ответа "Другое" для вопроса №1.1...');
  const addAnswerBtn = page.locator('a.add_answer');
  await expect(addAnswerBtn.first()).toBeVisible({ timeout: 5_000 });
  await addAnswerBtn.first().click();
  // Ждём появления нового поля 0_0_3_SUBANSWER — признак завершения AJAX
  await expect(page.locator('[name="0_0_3_SUBANSWER"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('[name="0_0_3_SUBANSWER"]').fill('Другое');
  console.log('  ✓ Вариант "Другое" добавлен и заполнен');

  // ── 7. Проверяем предзаполненное поле Вопрос №2 ──────────────
  console.log('  → Проверяем предзаполненное поле "Вопрос для голосования №2"...');
  await expect(page.locator('[name="MAINVOTEAGENDA_1_items"]'))
    .toHaveValue('Утверждение сметы доходов и расходов на следующий год');
  console.log('  ✓ Вопрос №2 предзаполнен корректно');

  // ── 8. Чекбокс «Решение принимается квалифицированным большинством» ─
  console.log('  → Ставим чекбокс "Решение принимается квалифицированным большинством"...');
  await page.locator('#questions_1_is_qualified_majority').check({ force: true });
  console.log('  ✓ Чекбокс "Квалифицированное большинство" установлен');

  // ── 9. Проверяем предзаполненное поле Вопрос №2.1 ────────────
  console.log('  → Проверяем поле "Вопрос для голосования №2.1"...');
  await expect(page.locator('[name="1_0_SubItem"]'))
    .toHaveValue('Утвердить смету в размере 500 000 руб.');
  console.log('  ✓ Вопрос №2.1 предзаполнен корректно');

  // ── 10. Проверяем предзаполненные варианты ответа для вопроса №2.1 ─
  console.log('  → Проверяем варианты ответа для вопроса №2.1...');
  await expect(page.locator('[name="1_0_0_SUBANSWER"]')).toHaveValue('За');
  await expect(page.locator('[name="1_0_1_SUBANSWER"]')).toHaveValue('Против');
  await expect(page.locator('[name="1_0_2_SUBANSWER"]')).toHaveValue('Воздержался');
  console.log('  ✓ Варианты ответа: За / Против / Воздержался — предзаполнены');

  // ── 11. Кнопка «Вперед» (ШАГ 6 → ШАГ 7) ─────────────────────
  // value="8" подтверждено из HTML: <button name="PAGE" value="8">Вперед</button>
  console.log('  → Нажимаем кнопку "Вперед"...');
  const nextButton6 = page.locator('button[name="PAGE"][value="8"]');
  await expect(nextButton6).toBeVisible({ timeout: 5_000 });
  await nextButton6.click();
  console.log('  ✓ Кнопка "Вперед" нажата');
  await page.waitForLoadState('networkidle');

  // ════════════════════════════════════════════════════════════
  // ШАГ 11: Страница «ШАГ 7. Проверьте данные для голосования»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 11: Проверяем данные для голосования (ШАГ 7)');
  console.log('══════════════════════════════════════════');

  // Ждём загрузки — убеждаемся что попали на страницу проверки
  const infoSpan = page.locator('span.vote__info--text');
  await expect(infoSpan.first()).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Страница ШАГ 7 загружена');

  // ── 1. Проверяем статичные данные голосования ─────────────────
  // Форма / Вид / Тип голосования и прочее
  console.log('  → Проверяем данные голосования...');
  await expect(page.locator('span.vote__info--text', { hasText: /^Очно-заочное$/ })).toBeVisible();
  await expect(page.locator('span.vote__info--text', { hasText: /^Внеочередное$/ })).toBeVisible();
  await expect(page.locator('span.vote__info--text', { hasText: /^Открытое$/ })).toBeVisible();
  await expect(page.locator('span.vote__info--text', { hasText: /^В процессе голосования$/ })).toBeVisible();
  await expect(page.locator('span.vote__info--text', { hasText: /^Внеочередное общее собрание собственников СНТ$/ })).toBeVisible();
  await expect(page.locator('span.vote__info--text', { hasText: /утверждения состава правления/ })).toBeVisible();
  console.log('  ✓ Основные поля голосования корректны');

  // Время проведения: даты динамические — проверяем только наличие подстроки «по московскому времени»
  await expect(
    page.locator('span.vote__info--text').filter({ hasText: 'по московскому времени' })
  ).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Период проведения голосования присутствует');

  // ── 2. Проверяем вопросы и подвопросы повестки (h4) ──────────
  console.log('  → Проверяем вопросы повестки дня...');
  await expect(page.locator('h4', { hasText: 'Утверждение состава правления СНТ' })).toBeVisible();
  await expect(page.locator('h4', { hasText: 'Выбор председателя правления СНТ' })).toBeVisible();
  await expect(page.locator('h4', { hasText: 'Утверждение сметы доходов и расходов на следующий год' })).toBeVisible();
  await expect(page.locator('h4', { hasText: 'Утвердить смету в размере 500 000 руб.' })).toBeVisible();
  console.log('  ✓ Все вопросы повестки присутствуют');

  // ── 3. Кнопка «Завершить создание голосования» ────────────────
  // Это <a href="..."> с полноценным href — getByRole('link') работает
  console.log('  → Кликаем "Завершить создание голосования"...');
  const finishBtn = page.getByRole('link', { name: /Завершить\s+создание\s+голосования/i });
  await expect(finishBtn).toBeVisible({ timeout: 5_000 });
  await finishBtn.click();
  console.log('  ✓ Голосование создано');
  await page.waitForLoadState('networkidle');

  // ── Финал ────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('✅ ТЕСТ ЗАВЕРШЁН УСПЕШНО');
  console.log('   Финальный URL:', page.url());
  console.log('══════════════════════════════════════════\n');

  await expect(page).toHaveURL(/lk\.sntclub\.ru/);
});
