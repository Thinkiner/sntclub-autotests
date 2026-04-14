const { test, expect } = require('@playwright/test');

test('Открытие страницы авторизации', async ({ page }) => {
    await page.goto('https://lk.sntclub.ru', {
        waitUntil: 'domcontentloaded',
    });

    const title = await page.title();
    console.log('Заголовок:', title);

    await expect(page).toHaveTitle(/Авторизация/);
});