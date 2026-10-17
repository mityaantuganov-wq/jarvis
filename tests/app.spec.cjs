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

test('malformed backup JSON reports a file-format error', async ({ page }) => {
  await page.getByRole('button', { name: 'Восстановить копию' }).click();
  await page.locator('#restoreFile').setInputFiles({
    name: 'malformed-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ this is not valid JSON')
  });
  await expect(page.locator('#log')).toContainText('Файл содержит некорректный JSON');
});

test('invalid note entries are rejected without replacing current notes', async ({ page }) => {
  await page.locator('#inp').fill('заметка оставить эту запись');
  await page.locator('#send').click();
  await expect(page.locator('#log')).toContainText('Заметка сохранена');

  const invalidBackup = {
    app: 'JARVIS',
    version: 1,
    exportedAt: '2026-10-17T00:00:00.000Z',
    history: [],
    notes: [{ text: '   ', date: '2026-10-17T00:00:00.000Z' }]
  };
  await page.getByRole('button', { name: 'Восстановить копию' }).click();
  await page.locator('#restoreFile').setInputFiles({
    name: 'invalid-note-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(invalidBackup))
  });
  await expect(page.locator('#log')).toContainText('Файл не похож на корректную резервную копию JARVIS версии 1');
  await page.locator('#inp').fill('покажи заметки');
  await page.locator('#send').click();
  await expect(page.locator('#log')).toContainText('оставить эту запись');
});
