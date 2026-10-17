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

test('backup export contains chat history and notes', async ({ page }) => {
  const fs = require('node:fs/promises');
  await page.locator('#inp').fill('заметка резервная заметка');
  await page.locator('#send').click();
  await expect(page.locator('#log')).toContainText('Заметка сохранена');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Резервная копия' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^jarvis-backup-.*\.json$/);

  const data = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(data.app).toBe('JARVIS');
  expect(data.version).toBe(1);
  expect(data.notes).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: 'резервная заметка' })
  ]));
  expect(data.history).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: 'Вы: заметка резервная заметка', kind: 'me' })
  ]));
});

test('restores a valid backup and makes its notes available', async ({ page }) => {
  const backup = {
    app: 'JARVIS',
    version: 1,
    exportedAt: '2026-10-17T00:00:00.000Z',
    history: [{ text: 'Вы: сообщение из копии', kind: 'me' }],
    notes: [{ text: 'заметка из резервной копии', date: '2026-10-17T00:00:00.000Z' }]
  };

  await page.getByRole('button', { name: 'Восстановить копию' }).click();
  await page.locator('#restoreFile').setInputFiles({
    name: 'jarvis-test-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup))
  });

  await expect(page.locator('#log')).toContainText('Резервная копия восстановлена');
  await page.locator('#inp').fill('покажи заметки');
  await page.locator('#send').click();
  await expect(page.locator('#log')).toContainText('заметка из резервной копии');
});

test('rejects an invalid backup without replacing existing notes', async ({ page }) => {
  await page.locator('#inp').fill('заметка сохранить текущую запись');
  await page.locator('#send').click();
  await expect(page.locator('#log')).toContainText('Заметка сохранена');

  await page.getByRole('button', { name: 'Восстановить копию' }).click();
  await page.locator('#restoreFile').setInputFiles({
    name: 'invalid-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'other-app', version: 99, history: [], notes: [] }))
  });

  await expect(page.locator('#log')).toContainText('Файл не похож на корректную резервную копию JARVIS');
  await page.locator('#inp').fill('покажи заметки');
  await page.locator('#send').click();
  await expect(page.locator('#log')).toContainText('сохранить текущую запись');
});
