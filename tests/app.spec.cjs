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

test('exports version 2 backup with a SHA-256 integrity checksum', async ({ page }) => {
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      window.__jarvisBackupBlob = blob;
      return original(blob);
    };
  });
  await page.getByRole('button', { name: 'Резервная копия' }).click();
  await expect(page.locator('#log')).toContainText('Резервная копия истории и заметок подготовлена');
  const data = await page.evaluate(async () => JSON.parse(await window.__jarvisBackupBlob.text()));
  expect(data.app).toBe('JARVIS');
  expect(data.version).toBe(2);
  expect(data.checksum).toMatch(/^[a-f0-9]{64}$/);
});

test('restores a valid version 2 backup after verifying its checksum', async ({ page }) => {
  const backup = await page.evaluate(async () => {
    const payload = {
      app: 'JARVIS',
      version: 2,
      exportedAt: '2026-10-17T00:00:00.000Z',
      history: [{ text: 'Вы: сообщение из проверенной копии', kind: 'me' }],
      notes: [{ text: 'заметка из проверенной копии', date: '2026-10-17T00:00:00.000Z' }]
    };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
    const checksum = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    return { ...payload, checksum };
  });

  await page.getByRole('button', { name: 'Восстановить копию' }).click();
  await page.locator('#restoreFile').setInputFiles({
    name: 'valid-version-2-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup))
  });

  await expect(page.locator('#log')).toContainText('Резервная копия восстановлена');
  await expect(page.locator('#log')).toContainText('сообщение из проверенной копии');
  await page.locator('#inp').fill('покажи заметки');
  await page.locator('#send').click();
  await expect(page.locator('#log')).toContainText('заметка из проверенной копии');
});

test('rejects a modified version 2 backup and preserves current notes', async ({ page }) => {
  await page.locator('#inp').fill('заметка оставить эту запись');
  await page.locator('#send').click();
  const backup = {
    app: 'JARVIS',
    version: 2,
    exportedAt: new Date().toISOString(),
    history: [],
    notes: [{ text: 'подменённая запись', date: '' }],
    checksum: '0'.repeat(64)
  };
  await page.getByRole('button', { name: 'Восстановить копию' }).click();
  await page.locator('#restoreFile').setInputFiles({
    name: 'tampered-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator('#log')).toContainText('Контрольная сумма не совпадает');
  await page.locator('#inp').fill('покажи заметки');
  await page.locator('#send').click();
  await expect(page.locator('#log')).toContainText('оставить эту запись');
  await expect(page.locator('#log')).not.toContainText('подменённая запись');
});

test('does not prefill an old access token when the AI endpoint changes', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('jarvis.ai.endpoint.v1', 'https://old-worker.example/api/chat');
    localStorage.setItem('jarvis.ai.token.v1', 'old-secret-token');
    const responses = ['https://new-worker.example/api/chat', ''];
    window.__jarvisPromptCalls = [];
    window.prompt = (message, defaultValue) => {
      window.__jarvisPromptCalls.push({ message, defaultValue });
      return responses.shift();
    };
  });

  await page.getByRole('button', { name: 'Настройки ИИ' }).click();

  const result = await page.evaluate(() => ({
    prompts: window.__jarvisPromptCalls,
    endpoint: localStorage.getItem('jarvis.ai.endpoint.v1'),
    token: localStorage.getItem('jarvis.ai.token.v1')
  }));
  expect(result.prompts).toHaveLength(2);
  expect(result.prompts[1].defaultValue).toBe('');
  expect(result.prompts[1].message).toContain('локальном хранилище браузера');
  expect(result.prompts[1].message).toContain('доверенном устройстве');
  expect(result.endpoint).toBe('https://new-worker.example/api/chat');
  expect(result.token).toBeNull();
});


test('restores original history and notes if saving the new notes fails', async ({ page }) => {
  const originalHistory = [{ text: 'исходная история', kind: 'me' }];
  const originalNotes = [{ text: 'исходная заметка', date: '2026-10-16T00:00:00.000Z' }];

  await page.evaluate(({ history, notes }) => {
    localStorage.setItem('jarvis.history.v1', JSON.stringify(history));
    localStorage.setItem('jarvis.notes.v1', JSON.stringify(notes));
    const originalSetItem = Storage.prototype.setItem;
    let failedOnce = false;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'jarvis.notes.v1' && !failedOnce) {
        failedOnce = true;
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    };
  }, { history: originalHistory, notes: originalNotes });

  const backup = {
    app: 'JARVIS',
    version: 1,
    exportedAt: '2026-10-17T00:00:00.000Z',
    history: [{ text: 'новая история из копии', kind: 'me' }],
    notes: [{ text: 'новая заметка из копии', date: '2026-10-17T00:00:00.000Z' }]
  };

  await page.getByRole('button', { name: 'Восстановить копию' }).click();
  await page.locator('#restoreFile').setInputFiles({
    name: 'rollback-test-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup))
  });

  await expect(page.locator('#log')).toContainText('Не удалось восстановить копию');
  const saved = await page.evaluate(() => ({
    history: JSON.parse(localStorage.getItem('jarvis.history.v1')),
    notes: JSON.parse(localStorage.getItem('jarvis.notes.v1'))
  }));
  expect(saved.history).toEqual(originalHistory);
  expect(saved.notes).toEqual(originalNotes);
});
