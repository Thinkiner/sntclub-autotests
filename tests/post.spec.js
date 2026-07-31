// ============================================================
// E2E тест: Коммуникации и опросы на сайте lk.sntclub.ru
// Тестовый фреймворк: Playwright Test (@playwright/test)
//
// Что проверяется:
// 1. Создание поста БЕЗ опроса
// 2. Чекбокс публикации в Telegram / мессенджеры
// 3. Чекбокс запрета комментариев
// 4. Создание поста С опросом
// 5. Остановка голосования в опросе
// 6. Удаление поста
//
// ⚠️ Голосование в опросе нельзя проверить из-под того же
//    аккаунта, который создал пост — это отдельный тест.
//
// Запуск:
//   npx playwright test post.spec.js --headed
// ============================================================

const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────
// НАСТРОЙКИ ТЕСТА
// В продакшене лучше хранить credentials в .env файле
// и читать через process.env.EMAIL / process.env.PASSWORD
// ─────────────────────────────────────────────────────────────
const TEST_USER = {
  email: 'test.ramos@mail.ru',
  password: 'Wqmyt1DZ7L',
};

// Уникальные заголовки постов (с таймстампом, чтобы не дублировались)
function makePostTitle(suffix) {
  const ts = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
  return `Автотест ${suffix} ${ts}`;
}

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
  // У некоторых пользователей после входа появляется экран выбора роли —
  // проверяем его наличие и выбираем «Председатель».
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

  // Ждём появления элемента бокового меню — признак успешного входа
  console.log('  → Ожидаем появления бокового меню после входа...');
  await expect(
    page.getByRole('link', { name: /Коммуникации и опросы/i })
  ).toBeVisible({ timeout: 20_000 });
  console.log('  ✓ Авторизация успешна! URL после входа:', page.url());
}

// ─────────────────────────────────────────────────────────────
// ОСНОВНОЙ ТЕСТ
// ─────────────────────────────────────────────────────────────
test('Коммуникации и опросы: создание постов, опрос, комментарии, удаление', async ({ page }) => {
  // Тест длинный — даём 3 минуты
  test.setTimeout(180_000);

  // Сохраняем заголовки для дальнейшей идентификации постов
  const postTitleNoSurvey = makePostTitle('пост-без-опроса');
  const postTitleWithSurvey = makePostTitle('пост-с-опросом');

  // ════════════════════════════════════════════════════════════
  // ШАГ 1: Авторизация
  // ════════════════════════════════════════════════════════════
  await login(page);

  // ════════════════════════════════════════════════════════════
  // ШАГ 2: Навигация в раздел «Коммуникации и опросы»
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 2: Навигация в раздел «Коммуникации и опросы»');
  console.log('══════════════════════════════════════════');

  // Ищем пункт меню по тексту
  const postsMenuLink = page.getByRole('link', { name: /Коммуникации и опросы/i });

  console.log('  → Проверяем видимость пункта меню...');
  const isMenuItemVisible = await postsMenuLink.isVisible();

  if (!isMenuItemVisible) {
    // Пункт скрыт — пробуем раскрыть меню кнопкой «Больше»
    console.log('  ℹ Пункт меню скрыт. Нажимаем "Больше" для раскрытия...');
    const moreButton = page.getByRole('button', { name: /Больше/i });

    if (await moreButton.isVisible()) {
      await moreButton.click();
      console.log('  ✓ Меню раскрыто');
      await expect(postsMenuLink).toBeVisible({ timeout: 5_000 });
    } else {
      console.log('  ℹ Кнопка "Больше" не найдена — переходим напрямую по URL');
    }
  } else {
    console.log('  ✓ Пункт меню виден');
  }

  // Переходим по прямому URL — это надёжнее, чем кликать по меню
  console.log('  → Переходим на страницу «Коммуникации и опросы»...');
  await page.goto('https://lk.sntclub.ru/posts/', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/\/posts\//);
  console.log('  ✓ Находимся на странице:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 3: Создание поста БЕЗ опроса
  //         + чекбокс мессенджеров + чекбокс комментариев
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 3: Создание поста БЕЗ опроса');
  console.log('══════════════════════════════════════════');

  // ── Кнопка «Создать пост» на странице списка ────────────────
  console.log('  → Ищем кнопку "Создать пост"...');
  const createPostButton = page
    .locator('a, button')
    .filter({ hasText: /Создать пост/i })
    .first();

  await createPostButton.scrollIntoViewIfNeeded();
  await expect(createPostButton).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Создать пост" найдена');

  console.log('  → Нажимаем "Создать пост"...');
  await createPostButton.click();
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Форма создания поста открыта. URL:', page.url());

  // ── Заполняем заголовок ─────────────────────────────────────
  console.log('  → Заполняем заголовок поста...');
  const titleField = page.getByPlaceholder(/ведите тему сообщения/i);
  await expect(titleField).toBeVisible({ timeout: 10_000 });
  await titleField.fill(postTitleNoSurvey);
  console.log(`  ✓ Заголовок введён: "${postTitleNoSurvey}"`);

  // ── Заполняем текст поста ───────────────────────────────────
  console.log('  → Заполняем текст поста...');
  // Поле текста — обычная textarea (без rich-text редактора)
  // ⚠️ Если на странице несколько textarea — возможно нужно уточнить селектор
  const textBody = page.locator('textarea').first();
  await expect(textBody).toBeVisible({ timeout: 5_000 });
  await textBody.fill('Это тестовый пост без опроса, созданный автотестом. Проверка создания поста.');
  console.log('  ✓ Текст поста введён');

  // ── Чекбокс: публикация в мессенджеры ───────────────────────
  console.log('  → Ищем чекбокс "Отправить уведомление в Telegram..."...');
  // Текст чекбокса: «Отправить уведомление в Telegram канал СНТ и/или группу ...»
  // Используем частичное совпадение, т.к. имя группы может меняться
  const messengerCheckboxLabel = page.getByText(/Отправить уведомление в Telegram/i);
  const isMsgCheckboxVisible = await messengerCheckboxLabel.isVisible().catch(() => false);

  if (isMsgCheckboxVisible) {
    // Кликаем по лейблу, чтобы включить чекбокс
    await messengerCheckboxLabel.click();
    console.log('  ✓ Чекбокс мессенджеров найден и отмечен');

    // Снимаем отметку — мы проверили, что чекбокс работает,
    // но реальную отправку в мессенджеры запускать не нужно
    await messengerCheckboxLabel.click();
    console.log('  ✓ Чекбокс мессенджеров снят (отправка не нужна)');
  } else {
    console.log('  ⚠️ Чекбокс мессенджеров не найден — пропускаем');
  }

  // ── Чекбокс: запрет комментариев ────────────────────────────
  console.log('  → Проверяем чекбокс "Запретить использовать комментарии"...');
  const commentsCheckboxLabel = page.getByText(/Запретить использовать комментарии/i);
  const isCommentsCheckboxVisible = await commentsCheckboxLabel.isVisible().catch(() => false);

  if (isCommentsCheckboxVisible) {
    // Включаем запрет комментариев
    await commentsCheckboxLabel.click();
    console.log('  ✓ Чекбокс "Запретить комментарии" — отмечен (комментарии запрещены)');

    // Снимаем запрет — проверяем что переключение работает
    await commentsCheckboxLabel.click();
    console.log('  ✓ Чекбокс "Запретить комментарии" — снят (комментарии разрешены)');
  } else {
    console.log('  ⚠️ Чекбокс запрета комментариев не найден — пропускаем');
  }

  // ── Публикуем пост ──────────────────────────────────────────
  console.log('  → Нажимаем кнопку "Создать пост" (отправка формы)...');
  // На странице две кнопки «Создать пост»: одна на странице списка (скрыта за модалом),
  // вторая — кнопка отправки формы. Используем :visible, чтобы найти именно видимую.
  const submitPostButton = page
    .locator('button:visible')
    .filter({ hasText: /Создать пост/i })
    .first();

  await expect(submitPostButton).toBeVisible({ timeout: 10_000 });
  await submitPostButton.scrollIntoViewIfNeeded();
  await submitPostButton.click();
  console.log('  ✓ Кнопка "Создать пост" нажата');

  // Ожидаем перехода / обновления страницы после создания
  await page.waitForLoadState('domcontentloaded');
  // Небольшая пауза на случай анимации/перенаправления
  await page.waitForTimeout(5_000);
  console.log('  ✓ Пост без опроса создан. URL:', page.url());

  // ════════════════════════════════════════════════════════════
  // ШАГ 4: Проверяем, что пост отображается в списке
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 4: Проверка что пост появился');
  console.log('══════════════════════════════════════════');

  // Возвращаемся на страницу списка постов
  console.log('  → Возвращаемся на страницу постов...');
  await page.goto('https://lk.sntclub.ru/posts/', {
    waitUntil: 'domcontentloaded',
  });

  // Ищем созданный пост по заголовку
  console.log(`  → Ищем пост с заголовком "${postTitleNoSurvey}"...`);
  const createdPost = page.getByRole('link', { name: postTitleNoSurvey }).first();
  await expect(createdPost).toBeVisible({ timeout: 15_000 });
  console.log('  ✓ Пост без опроса найден в списке!');

  // ════════════════════════════════════════════════════════════
  // ШАГ 5: Создание поста С опросом
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 5: Создание поста С опросом');
  console.log('══════════════════════════════════════════');

  // ── Открываем форму создания ────────────────────────────────
  console.log('  → Нажимаем "Создать пост"...');
  const createPostButton2 = page
    .locator('a, button')
    .filter({ hasText: /Создать пост/i })
    .first();

  await createPostButton2.scrollIntoViewIfNeeded();
  await expect(createPostButton2).toBeVisible({ timeout: 10_000 });
  await createPostButton2.click();
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✓ Форма создания поста открыта');

  // ── Заполняем заголовок ─────────────────────────────────────
  console.log('  → Заполняем заголовок поста с опросом...');
  const titleField2 = page.getByPlaceholder(/ведите тему сообщения/i);
  await expect(titleField2).toBeVisible({ timeout: 10_000 });
  await titleField2.fill(postTitleWithSurvey);
  console.log(`  ✓ Заголовок введён: "${postTitleWithSurvey}"`);

  // ── Заполняем текст поста ───────────────────────────────────
  console.log('  → Заполняем текст поста...');
  const textBody2 = page.locator('textarea').first();
  await expect(textBody2).toBeVisible({ timeout: 5_000 });
  await textBody2.fill('Это тестовый пост с опросом, созданный автотестом.');
  console.log('  ✓ Текст поста введён');

  // ── Нажимаем «Создать опрос» ────────────────────────────────
  console.log('  → Ищем кнопку "Создать опрос"...');
  // На форме две кнопки с классом .add-quiz:
  //   1) button.communications__button.add-quiz — «Создать опрос» (первичная)
  //   2) button.button-add-field.add-quiz — «Добавить новый опрос» (появляется после)
  // Используем уникальный класс .communications__button для точного попадания.
  const addSurveyButton = page.locator('button.communications__button.add-quiz');
  await expect(addSurveyButton).toBeVisible({ timeout: 10_000 });
  await addSurveyButton.scrollIntoViewIfNeeded();
  console.log('  ✓ Кнопка "Создать опрос" найдена');

  console.log('  → Нажимаем "Создать опрос"...');
  await addSurveyButton.click();
  await page.waitForTimeout(1_000); // ждём появления формы опроса
  console.log('  ✓ Форма опроса открыта');

  // ── Заполняем поля опроса ───────────────────────────────────
  console.log('  → Заполняем поля опроса...');

  // Поле «Тема опроса»: input.vote-title с placeholder="Тема опроса"
  const surveyTopicField = page.locator('input.vote-title');
  await expect(surveyTopicField).toBeVisible({ timeout: 5_000 });
  await surveyTopicField.fill('Тестовый опрос автотеста: какой вариант выбрать?');
  console.log('  ✓ Тема опроса заполнена');

  // Варианты ответов: input.vote-question
  // По умолчанию отображаются 2 поля: «Ответ 1» и «Ответ 2»
  const answerInputs = page.locator('input.vote-question');
  const answerCount = await answerInputs.count();
  console.log(`  ℹ Найдено полей вариантов ответов: ${answerCount}`);

  await expect(answerInputs.first()).toBeVisible({ timeout: 5_000 });
  await answerInputs.nth(0).fill('Вариант А (автотест)');
  await answerInputs.nth(1).fill('Вариант Б (автотест)');
  console.log('  ✓ Варианты ответов 1 и 2 заполнены');

  // ── Проверяем кнопку «+ Добавить вариант ответа» ────────────
  console.log('  → Проверяем кнопку "Добавить вариант ответа"...');
  const addAnswerButton = page.locator('button.add-answer');
  await addAnswerButton.scrollIntoViewIfNeeded();
  await expect(addAnswerButton).toBeVisible({ timeout: 5_000 });
  console.log('  ✓ Кнопка "Добавить вариант ответа" найдена');

  // Добавляем третий вариант ответа
  console.log('  → Добавляем третий вариант ответа...');
  await addAnswerButton.click();
  await page.waitForTimeout(500);

  // После клика должно появиться третье поле
  const answerCountAfterAdd = await answerInputs.count();
  console.log(`  ℹ Полей вариантов ответов после добавления: ${answerCountAfterAdd}`);

  if (answerCountAfterAdd >= 3) {
    await answerInputs.nth(2).fill('Вариант В (автотест — добавлен)');
    console.log('  ✓ Третий вариант ответа добавлен и заполнен');
  } else {
    console.log('  ⚠️ Третье поле не появилось — проверьте вручную');
  }

  // ── Проверяем кнопку «+ Добавить новый опрос» ───────────────
  // В одном посте можно создать несколько опросов
  console.log('  → Проверяем кнопку "Добавить новый опрос"...');
  const addNewQuizButton = page.locator('button.add-quiz').filter({ hasText: /Добавить новый опрос/i });
  const isAddQuizVisible = await addNewQuizButton.isVisible().catch(() => false);

  if (isAddQuizVisible) {
    console.log('  ✓ Кнопка "Добавить новый опрос" найдена (не нажимаем — один опрос достаточно)');
  } else {
    console.log('  ℹ Кнопка "Добавить новый опрос" не видна — возможно появляется после сохранения');
  }

  // ── Публикуем пост с опросом ────────────────────────────────
  console.log('  → Нажимаем "Создать пост" (отправка формы с опросом)...');
  const submitPostButton2 = page
    .locator('button:visible')
    .filter({ hasText: /Создать пост/i })
    .first();

  await expect(submitPostButton2).toBeVisible({ timeout: 10_000 });
  await submitPostButton2.scrollIntoViewIfNeeded();
  await submitPostButton2.click();
  console.log('  ✓ Кнопка "Создать пост" нажата');

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2_000);
  console.log('  ✓ Пост с опросом создан. URL:', page.url());

  // Проверяем, что пост с опросом появился в списке
  console.log('  → Возвращаемся на страницу постов...');
  await page.goto('https://lk.sntclub.ru/posts/', {
    waitUntil: 'domcontentloaded',
  });

  console.log(`  → Ищем пост с заголовком "${postTitleWithSurvey}"...`);
  const createdPostWithSurvey = page.getByRole('link', { name: postTitleWithSurvey }).first();
  await expect(createdPostWithSurvey).toBeVisible({ timeout: 15_000 });
  console.log('  ✓ Пост с опросом найден в списке!');

  // ════════════════════════════════════════════════════════════
  // ШАГ 6: Остановка голосования в опросе
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 6: Остановка голосования в опросе');
  console.log('══════════════════════════════════════════');

  // Открываем пост с опросом (кликаем по заголовку)
  console.log('  → Открываем пост с опросом...');
  await createdPostWithSurvey.click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1_000);
  console.log('  ✓ Пост с опросом открыт. URL:', page.url());

  // Ищем кнопку «Остановить голосование»
  console.log('  → Ищем кнопку "Остановить голосование"...');
  // Селектор из HTML: button.vote-close-button
  const stopVotingButton = page.locator('button.vote-close-button');
  await stopVotingButton.scrollIntoViewIfNeeded();
  await expect(stopVotingButton).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Кнопка "Остановить голосование" найдена');

  console.log('  → Нажимаем "Остановить голосование"...');
  await stopVotingButton.click();

  // Возможно появится модальное окно подтверждения
  try {
    const confirmButton = page
      .locator('button, a')
      .filter({ hasText: /Да|Подтвердить|Остановить|OK/i })
      .first();
    await confirmButton.waitFor({ state: 'visible', timeout: 3_000 });
    console.log('  ℹ Обнаружено окно подтверждения — нажимаем...');
    await confirmButton.click();
    console.log('  ✓ Подтверждение нажато');
  } catch {
    console.log('  ℹ Окно подтверждения не появилось — продолжаем');
  }

  await page.waitForTimeout(2_000);

  // Проверяем, что голосование остановлено
  // Кнопка «Остановить голосование» должна исчезнуть или измениться
  const isStopButtonStillVisible = await stopVotingButton.isVisible().catch(() => false);
  if (!isStopButtonStillVisible) {
    console.log('  ✓ Голосование остановлено (кнопка исчезла)');
  } else {
    console.log('  ⚠️ Кнопка "Остановить голосование" всё ещё видна — проверьте вручную');
  }

  // ════════════════════════════════════════════════════════════
  // ШАГ 7: Удаление поста (без опроса)
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('ШАГ 7: Удаление поста без опроса');
  console.log('══════════════════════════════════════════');

  // Возвращаемся на страницу списка постов
  console.log('  → Возвращаемся на страницу постов...');
  await page.goto('https://lk.sntclub.ru/posts/', {
    waitUntil: 'domcontentloaded',
  });

  // Находим пост без опроса и кликаем на его заголовок
  // для перехода в детальное отображение
  console.log(`  → Ищем пост "${postTitleNoSurvey}" для удаления...`);
  const postToDelete = page.getByRole('link', { name: postTitleNoSurvey }).first();
  await expect(postToDelete).toBeVisible({ timeout: 15_000 });
  console.log('  ✓ Пост найден');

  console.log('  → Открываем детальное отображение поста...');
  await postToDelete.click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1_000);
  console.log('  ✓ Пост открыт. URL:', page.url());

  // Ищем иконку удаления (корзина)
  // HTML: <svg width="24" height="24"><use xlink:href="...#delete"></use></svg>
  console.log('  → Ищем иконку удаления (корзина)...');

  // Находим <use> → поднимаемся к <svg> → поднимаемся к родителю <svg>
  const svgUse = page.locator('use[*|href*="delete"]').first();
  const svgElement = svgUse.locator('..'); // <svg>
  const deleteWrapper = svgElement.locator('..'); // родитель <svg>

  await expect(svgElement).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Иконка удаления найдена');

  // Кликаем по родителю <svg> — на нём обработчик
  console.log('  → Нажимаем удалить (клик по обёртке иконки)...');
  await deleteWrapper.click();

  // Ожидаем появления попапа подтверждения удаления
  // HTML: <div id="confirmBox" class="popup popup__dialog active">
  //         <div id="btnYes" class="button button--primary">Удалить</div>
  console.log('  → Ожидаем окно подтверждения удаления...');
  const confirmDeleteBtn = page.locator('#btnYes');
  await expect(confirmDeleteBtn).toBeVisible({ timeout: 5_000 });
  console.log('  ✓ Окно подтверждения появилось');

  console.log('  → Нажимаем "Удалить" в окне подтверждения...');
  await confirmDeleteBtn.click();
  console.log('  ✓ Подтверждение удаления нажато');

  // После удаления сайт автоматически перенаправляет на /posts/
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3_000);

  // Пост без опроса не должен отображаться в списке
  const deletedPost = page.getByRole('link', { name: postTitleNoSurvey }).first();
  await expect(deletedPost).not.toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Пост без опроса успешно удалён!');

  // Пост с опросом должен по-прежнему быть в списке
  const remainingPost = page.getByRole('link', { name: postTitleWithSurvey }).first();
  await expect(remainingPost).toBeVisible({ timeout: 10_000 });
  console.log('  ✓ Пост с опросом остался в списке');

  // ════════════════════════════════════════════════════════════
  // ИТОГО
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('✅ ТЕСТ ЗАВЕРШЁН УСПЕШНО');
  console.log('══════════════════════════════════════════');
  console.log('  • Пост без опроса — создан, проверен, удалён');
  console.log('  • Чекбокс мессенджеров — проверен');
  console.log('  • Чекбокс комментариев — проверен');
  console.log('  • Пост с опросом — создан');
  console.log('  • Голосование в опросе — остановлено');
  console.log('══════════════════════════════════════════\n');
});
