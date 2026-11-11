import { test, expect, type Page } from '@playwright/test';

async function register(page: Page) {
  await expect.poll(async () => (await page.request.get('/api/health')).status()).toBe(200);
  await page.goto('/');
  await page.getByLabel('What should we call you?').fill('Alex');
  await page.getByLabel('I am 18 or older.').check();
  await page.getByLabel('I agree to the community guidelines.').check();
  await page.getByRole('button', { name: 'Create my character' }).click();
  await page.getByRole('button', { name: 'Choose Moss', exact: true }).click();
  await page.getByRole('button', { name: 'Give them a story' }).click();
  await expect(page.getByRole('tab', { name: 'Write myself' })).toBeVisible();
}
async function markdown(page: Page, content: string) {
  await page.getByLabel('Markdown', { exact: true }).click();
  await page.locator('.cm-content[contenteditable=true]').fill(content);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('registration, avatar, custom tags, Markdown, profile editing and reload', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await register(page);
  await page.getByRole('button', { name: 'EDM', exact: true }).click();
  await page.getByRole('button', { name: 'Add your own' }).click();
  await page.getByLabel('Your tag', { exact: true }).fill('Tiny indie games');
  await page.getByLabel('Emoji', { exact: true }).fill('🕹️');
  await page.getByRole('button', { name: 'Add tag', exact: true }).click();
  const bio = '## Things I like\n\nI love **tiny indie games**, coffee, and strange films.\n\n- Bouldering on Tuesdays\n- EDM on weekends\n\n> Always up for trying something new.';
  await markdown(page, bio);
  await page.getByLabel('Visual', { exact: true }).click();
  await expect(page.locator('[contenteditable=true]').first().locator('strong')).toHaveText('tiny indie games');
  await noOverflow(page);
  await page.screenshot({ path: `.artifacts/${info.project.name}-editor.png`, fullPage: true });
  await page.getByRole('button', { name: 'Preview my profile' }).click();
  await expect(page.locator('.profile-body strong')).toHaveText('tiny indie games');
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page.getByRole('heading', { name: 'Your character is ready.' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.profile-body')).toContainText('Bouldering on Tuesdays');
  await expect(page.locator('.profile-identity')).toContainText('Tiny indie games');
  await noOverflow(page);
  await page.screenshot({ path: `.artifacts/${info.project.name}-profile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Edit my profile' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Your display name', exact: true }).click();
  await page.getByLabel('What should we call you?').fill('Alex Coffee');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByRole('button', { name: 'Choose Ember', exact: true }).click();
  await page.getByRole('button', { name: 'Give them a story' }).click();
  await page.getByRole('button', { name: 'Preview my profile' }).click();
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page.locator('.profile-identity h2')).toHaveText('Alex Coffee');
  expect(errors).toEqual([]);
});

test('Ask me questions produces a reviewable bio with exact original answers', async ({ page }, info) => {
  await register(page);
  await page.getByRole('tab', { name: 'Ask me questions' }).click();
  await expect(page.getByText('Your phrasing stays yours.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Let’s talk' }).click();
  const first = 'I climb badly, enthusiastically. Mostly bouldering — the puzzles get me.';
  const second = 'I like figuring out one move for an hour. A coffee afterwards is part of the ritual.';
  await page.getByRole('textbox', { name: 'Whatever comes to mind…' }).fill(first);
  await page.getByRole('button', { name: 'Send answer' }).click();
  await expect(page.getByRole('log')).toContainText('What do you enjoy most about climbing');
  await page.getByRole('textbox', { name: 'Whatever comes to mind…' }).fill(second);
  await page.getByRole('button', { name: 'Send answer' }).click();
  await expect(page.getByRole('button', { name: 'Put my answers together' })).toBeEnabled();
  await page.screenshot({ path: `.artifacts/${info.project.name}-interview.png`, fullPage: true });
  await page.getByRole('button', { name: 'Put my answers together' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.proposal-preview')).toContainText(first);
  await expect(dialog.locator('.proposal-preview')).toContainText(second);
  await dialog.getByRole('button', { name: 'Use this bio & selected tags' }).click();
  await expect(page.getByRole('tab', { name: 'Write myself' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Preview my profile' }).click();
  await expect(page.locator('.profile-body')).toContainText(first);
  await expect(page.locator('.profile-body')).toContainText(second);
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await page.reload();
  await expect(page.locator('.profile-body')).toContainText(first);
  await noOverflow(page);
});

test('Markdown preview does not execute HTML or unsafe links; raw draft survives reload', async ({ page }) => {
  await register(page);
  const raw = '## My story\n\nSafe original words.\n\n<script>window.questrInjected=true</script>\n\n[unsafe](javascript:alert(1))\n\n**Bold stays bold**';
  await markdown(page, raw);
  await page.getByRole('button', { name: 'Preview my profile' }).click();
  await expect(page.locator('.profile-body strong')).toHaveText('Bold stays bold');
  await expect(page.getByRole('button', { name: 'Save my profile' })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).questrInjected)).toBeUndefined();
  await expect(page.locator('.profile-body a')).not.toHaveAttribute('href', /^javascript:/);
  const state = await (await page.request.get('/api/me')).json();
  expect(state.draft.introMarkdown).toBe(raw);
  await page.reload();
  await expect(page.locator('.profile-body strong')).toHaveText('Bold stays bold');
});

test('a concurrent draft update preserves local text and reports the conflict', async ({ page }) => {
  await register(page);
  await markdown(page, 'A first saved line.');
  await expect(page.getByRole('status')).toHaveText('All changes saved');
  const state = await (await page.request.get('/api/me')).json();
  await page.request.put('/api/draft', { data: { ...state.draft, introMarkdown: 'Saved from another session.' } });
  await page.locator('.cm-content[contenteditable=true]').fill('My unsaved local words are important.');
  await expect(page.getByRole('alert')).toContainText('Your draft changed in another session');
  await expect(page.locator('.cm-content[contenteditable=true]')).toContainText('My unsaved local words are important.');
  const server = await (await page.request.get('/api/me')).json();
  expect(server.draft.introMarkdown).toBe('Saved from another session.');
});

test('the visual formatting toolbar saves real Markdown', async ({ page }) => {
  await register(page);
  const editor = page.getByRole('textbox', { name: 'editable markdown', exact: true });
  await editor.fill('Words with weight.');
  // Mobile browsers do not implement desktop Home/End selection consistently.
  await editor.evaluate(element => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Words with weight.');
  await page.getByLabel('Bold', { exact: true }).click();
  await expect(editor.locator('strong')).toHaveText('Words with weight.');
  await page.getByRole('button', { name: 'Preview my profile' }).click();
  await expect(page.locator('.profile-body strong')).toHaveText('Words with weight.');
  await expect(page.getByRole('button', { name: 'Save my profile' })).toBeEnabled();
  const state = await (await page.request.get('/api/me')).json();
  expect(state.draft.introMarkdown).toBe('**Words with weight.**');
});
