const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  page.on('dialog', dialog => dialog.accept());
});

test('loads app and shows help commands', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('J.A.R.V.I.S.');
  await page.getByRole('button', { name: 'Команды' }).click();
  await expect(page.locator('#log')).toContainText('Доступные команды');
});

test('saves a note and finds it', async ({ page }) => {
  await page.locator('#inp').fill('заметка купить молоко');
  await page.locator('#send').click();
  await expect(page.locator('#log')).toContainText('Заметка сохранена');
  await page.locator('#inp').fill('найди заметку молоко');
  await page.locator('#send').click();
  await expect(page.locator('#log')).toContainText('купить молоко');
});

test('notes persist after page reload', async ({ page }) => {
  await page.locator('#inp').fill('заметка проверить сохранение');
  await page.locator('#send').click();
  await page.reload();
  await page.locator('#inp').fill('покажи заметки');
  await page.locator('#send').click();
  await expect(page.locator('#log')).toContainText('проверить сохранение');
});

test('deletes a selected note after confirmation', async ({ page }) => {
  await page.locator('#inp').fill('заметка временная запись');
  await page.locator('#send').click();
  await page.locator('#inp').fill('удали заметку 1');
  await page.locator('#send').click();
  await expect(page.locator('#log')).toContainText('Заметка удалена');
  await page.locator('#inp').fill('покажи заметки');
  await page.locator('#send').click();
  await expect(page.locator('#log')).toContainText('Сохранённых заметок пока нет');
});

test('diagnostics reports local mode without a configured AI endpoint', async ({ page }) => {
  await page.getByRole('button', { name: 'Состояние' }).click();
  await expect(page.locator('#log')).toContainText('Подключение к ИИ: не настроено');
});
