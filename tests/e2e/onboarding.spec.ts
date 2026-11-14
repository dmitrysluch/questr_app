import { tags } from '../../shared/catalog.ts';
import { test, expect, type Page } from '@playwright/test';

async function register(page: Page, withDiscovery = true) {
  await expect.poll(async () => (await page.request.get('/api/health')).status()).toBe(200);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Alex');
  await page.getByLabel('I am 18 or older.').check();
  await page.getByLabel('I agree to the community guidelines.').check();
  await page.getByRole('button', { name: 'Create my character' }).click();
  await page.getByRole('button', { name: 'Choose Moss', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('tab', { name: 'Write' })).toBeVisible();
  if (withDiscovery) {
    await page.getByRole('navigation', { name: 'Character creation' }).getByRole('button', { name: 'Languages & filters' }).click();
    await page.getByRole('combobox', { name: 'Where', exact: true }).fill('Israel');
    await page.getByRole('option', { name: /^All Israel/ }).click();
    await page.getByRole('combobox', { name: 'Adventure languages' }).fill('English');
    await page.getByRole('option', { name: /^English/ }).click();
    await page.getByRole('button', { name: 'Save filters' }).click();
    await expect(page.getByRole('button', { name: 'Save filters' })).toBeDisabled();
    await page.getByRole('navigation', { name: 'Character creation' }).getByRole('button', { name: 'Bio' }).click();
  }
}
async function preview(page: Page) {
  await page.getByRole('navigation', { name: 'Character creation' }).getByRole('button', { name: 'Preview' }).click();
}
async function markdown(page: Page, content: string) {
  await page.getByLabel('Markdown', { exact: true }).click();
  const editor = page.locator('.cm-content[contenteditable=true]');
  await editor.click();
  await editor.press('ControlOrMeta+a');
  await page.keyboard.insertText(content);
  await expect(editor).toHaveText(content.replaceAll('\n', ''));
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function highlightedText(page: Page) {
  return page.evaluate(() => [...(CSS.highlights.get('questr-explicit') ?? [])].map(range => range.toString()).join('\n'));
}

test('Ask me topics are optional, capped at three and appear only after saving the character', async ({ page }) => {
  await register(page);
  const field = page.getByRole('textbox', { name: 'Conversation topic' });
  const add = page.getByRole('button', { name: 'Add topic' });
  for (const topic of ['Ask me how I found the jam', 'Ask me about my climbing puzzle', 'Ask me about my train game']) {
    await field.fill(topic);
    await add.click();
  }
  await expect(field).toHaveCount(0);
  await noOverflow(page);
  await preview(page);
  await expect(page.locator('.profile-ask-me li')).toHaveCount(3);
  await noOverflow(page);
  expect((await (await page.request.get('/api/me')).json()).profile).toBeNull();
  await page.getByRole('button', { name: 'Save character' }).click();
  await expect.poll(async () => (await (await page.request.get('/api/me')).json()).profile?.askMeTopics).toEqual([
    'Ask me how I found the jam', 'Ask me about my climbing puzzle', 'Ask me about my train game',
  ]);
});

test('new characters must choose and save both adventure filters before previewing', async ({ page }) => {
  await register(page, false);
  await preview(page);
  await expect(page.getByRole('alert')).toContainText('Choose and save at least one adventure location and language');
  await page.getByRole('combobox', { name: 'Where', exact: true }).fill('Israel');
  await page.getByRole('option', { name: /^All Israel/ }).click();
  await page.getByRole('navigation', { name: 'Character creation' }).getByRole('button', { name: 'Bio' }).click();
  await page.getByRole('navigation', { name: 'Character creation' }).getByRole('button', { name: 'Languages & filters' }).click();
  await expect(page.getByRole('button', { name: 'Remove All Israel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save filters' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Adventure languages' }).fill('English');
  await page.getByRole('option', { name: /^English/ }).click();
  await page.getByRole('button', { name: 'Save filters' }).click();
  await preview(page);
  await expect(page.getByRole('heading', { name: 'Preview character', exact: true })).toBeVisible();
});

test('explicit bio passages are highlighted in both editor modes, kept privately, and must be corrected', async ({ page }, info) => {
  await register(page);
  const text = 'I enjoy **coffee**.\n\nI want to have **sex** with you.\n\nI am gay and open to dating.';
  await markdown(page, text);
  await preview(page);
  await expect(page.getByRole('alert')).toContainText('Rephrase the marked text.');
  await expect.poll(() => highlightedText(page)).toContain('I want to have **sex** with you.');
  expect((await (await page.request.get('/api/me')).json()).profile).toBeNull();
  await page.getByLabel('Visual', { exact: true }).click();
  await expect.poll(() => highlightedText(page)).toContain('I want to have sex with you.');
  expect((await (await page.request.get('/api/me')).json()).draft.introMarkdown).toBe(text);
  await noOverflow(page);
  await page.screenshot({ path: `.artifacts/${info.project.name}-content-review.png`, fullPage: true });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Rephrase the marked text.');
  await expect.poll(() => highlightedText(page)).toContain('I want to have sex with you.');
  await markdown(page, 'I enjoy **coffee**. I am gay and open to dating.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => highlightedText(page)).toBe('');
  await preview(page);
  await page.getByRole('button', { name: 'Save character' }).click();
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Character', exact: true }).click();
  await expect(page.locator('.profile-body')).toContainText('I am gay and open to dating.');
});

test('explicit answers receive muted highlights and a gentle change of topic, including after reload', async ({ page }, info) => {
  await register(page);
  await page.getByRole('tab', { name: 'Ask me questions' }).click();
  await page.getByRole('button', { name: 'Start chat' }).click();
  const text = 'I want to have sex with you.';
  await page.getByRole('textbox', { name: 'Your reply…' }).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('log').locator('mark')).toHaveText(text);
  await expect(page.locator('.chat-message.assistant').last()).toContainText('Please keep explicitly sexual messages out of your profile.');
  await expect(page.locator('.chat-message.assistant').last()).not.toContainText(text);
  await noOverflow(page);
  await page.screenshot({ path: `.artifacts/${info.project.name}-chat-content-review.png`, fullPage: true });
  await page.reload();
  await expect(page.getByRole('log').locator('mark')).toHaveText(text);
  await expect(page.getByRole('textbox', { name: 'Your reply…' })).toBeEnabled();
  expect(await page.locator('.chat-message.user').count()).toBe(1);
});

test('registration, avatar, custom tags, Markdown, profile editing and reload', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await register(page);
  await page.getByRole('combobox', { name: 'Search interests' }).fill('EDM');
  await page.getByRole('option', { name: 'EDM', exact: true }).click();
  await page.getByRole('button', { name: 'Create tag' }).click();
  await page.getByLabel('Tag name', { exact: true }).fill('Tiny indie games');
  await page.getByLabel('Emoji', { exact: true }).fill('🕹️');
  await page.getByRole('button', { name: 'Add tag', exact: true }).click();
  const bio = '## Things I like\n\nI love **tiny indie games**, coffee, and strange films.\n\n- Bouldering on Tuesdays\n- EDM on weekends\n\n> Always up for trying something new.';
  await markdown(page, bio);
  await page.getByLabel('Visual', { exact: true }).click();
  await expect(page.locator('[contenteditable=true]').first().locator('strong')).toHaveText('tiny indie games');
  await noOverflow(page);
  await page.screenshot({ path: `.artifacts/${info.project.name}-editor.png`, fullPage: true });
  await preview(page);
  await expect(page.locator('.profile-body strong')).toHaveText('tiny indie games');
  await page.getByRole('button', { name: 'Save character' }).click();
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Character', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Character saved' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.profile-body')).toContainText('Bouldering on Tuesdays');
  await expect(page.locator('.profile-identity')).toContainText('Tiny indie games');
  await noOverflow(page);
  await page.screenshot({ path: `.artifacts/${info.project.name}-profile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Edit character' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Your display name', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Alex Coffee');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByRole('button', { name: 'Choose Ember', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await preview(page);
  await page.getByRole('button', { name: 'Save character' }).click();
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Character', exact: true }).click();
  await expect(page.locator('.profile-identity h2')).toHaveText('Alex Coffee');
  expect(errors).toEqual([]);
});

test('interview drafts retain the existing bio and support comparison, discard, resume and approval', async ({ page }, info) => {
  await register(page);
  const existing = 'I make **tiny train games**. Coffee is non-negotiable.';
  await markdown(page, existing);
  await page.getByRole('tab', { name: 'Ask me questions' }).click();
  await expect(page.getByText('You review the draft before it changes your bio.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Start chat' }).click();
  const first = 'I climb badly, enthusiastically. Mostly bouldering — the puzzles get me.';
  const second = 'I like figuring out one move for an hour. A coffee afterwards is part of the ritual.';
  await page.getByRole('textbox', { name: 'Your reply…' }).fill(first);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('log')).toContainText('What was one fun moment from your last climbing session?');
  await page.getByRole('textbox', { name: 'Your reply…' }).fill(second);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: 'Update my bio' })).toBeEnabled();
  await page.screenshot({ path: `.artifacts/${info.project.name}-interview.png`, fullPage: true });
  await page.getByRole('button', { name: 'Update my bio' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.proposal-preview')).toContainText(first);
  await expect(dialog.locator('.proposal-preview')).toContainText(second);
  await dialog.getByRole('tab', { name: 'Current bio' }).click();
  await expect(dialog.locator('.proposal-preview')).toContainText('tiny train games');
  await expect(dialog.locator('.proposal-preview')).not.toContainText(first);
  await dialog.getByRole('button', { name: 'Keep current bio' }).click();
  expect((await (await page.request.get('/api/me')).json()).draft.introMarkdown).toBe(existing);
  await page.getByRole('button', { name: 'Update my bio' }).click();
  await expect(dialog.locator('.proposal-preview')).toContainText(first);
  await page.reload();
  await expect(dialog.locator('.proposal-preview')).toContainText('tiny train games');
  await dialog.getByRole('button', { name: 'Apply selected changes' }).click();
  await expect(page.getByRole('tab', { name: 'Write' })).toHaveAttribute('aria-selected', 'true');
  await preview(page);
  await expect(page.locator('.profile-body')).toContainText(first);
  await expect(page.locator('.profile-body')).toContainText(second);
  await expect(page.locator('.profile-body')).toContainText('Coffee is non-negotiable.');
  await page.getByRole('button', { name: 'Save character' }).click();
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Character', exact: true }).click();
  await page.reload();
  await expect(page.locator('.profile-body')).toContainText(first);
  await noOverflow(page);
});

test('Markdown preview does not execute HTML or unsafe links; raw draft survives reload', async ({ page }) => {
  await register(page);
  const raw = '## My story\n\nSafe original words.\n\n<script>window.questrInjected=true</script>\n\n[unsafe](javascript:alert(1))\n\n**Bold stays bold**';
  await markdown(page, raw);
  await preview(page);
  await expect(page.locator('.profile-body strong')).toHaveText('Bold stays bold');
  await expect(page.getByRole('button', { name: 'Save character' })).toBeEnabled();
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
  await expect(page.locator('.save-status')).toHaveText('Saved');
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
  await preview(page);
  await expect(page.locator('.profile-body strong')).toHaveText('Words with weight.');
  await expect(page.getByRole('button', { name: 'Save character' })).toBeEnabled();
  const state = await (await page.request.get('/api/me')).json();
  expect(state.draft.introMarkdown).toBe('**Words with weight.**');
});

test('Change topic asks elsewhere, preserves unsent text, and survives reload without becoming a bio answer', async ({ page }, info) => {
  await register(page);
  await markdown(page, 'I like bouldering with friends.');
  await page.getByRole('tab', { name: 'Ask me questions' }).click();
  await page.getByRole('button', { name: 'Start chat' }).click();
  await expect(page.getByRole('log')).toContainText('climbing');
  const answer = page.getByRole('textbox', { name: 'Your reply…' });
  await answer.fill('An unfinished thought I want to keep.');
  await page.getByRole('button', { name: 'Change topic', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Topic changed');
  await expect(page.locator('.chat-message.assistant').last()).toContainText('coffee');
  await expect(answer).toHaveValue('An unfinished thought I want to keep.');
  await noOverflow(page);
  await page.screenshot({ path: `.artifacts/${info.project.name}-change-topic.png`, fullPage: true });
  await page.getByRole('button', { name: 'Update my bio' }).click();
  await expect(page.getByRole('dialog').locator('.proposal-preview')).toHaveText('I like bouldering with friends.');
  await page.getByRole('button', { name: 'Keep current bio' }).click();
  await page.reload();
  await expect(page.getByRole('log')).toContainText('Topic changed');
  await expect(page.locator('.chat-message.assistant').last()).toContainText('coffee');
  const state = await (await page.request.get('/api/me')).json();
  expect(state.conversation.messages.filter((m: any) => m.kind === 'change_topic')).toHaveLength(1);
  expect(state.conversation.messages.filter((m: any) => m.role === 'user' && m.kind === 'text')).toHaveLength(0);
});

test('interest search supports niche aliases, keyboard selection, filters, removal and reload', async ({ page }, info) => {
  await register(page);
  await expect(page.locator('aside')).toHaveCount(0);
  const search = page.getByRole('combobox', { name: 'Search interests' });
  const options = page.getByRole('listbox', { name: 'Matching interests' }).getByRole('option');
  await search.fill('shor');
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', /shors_algorithm/);
  await search.press('Enter');
  await expect(page.getByRole('button', { name: 'Remove Shor’s algorithm' })).toBeVisible();
  await search.fill('Charlotte Ginsbourg');
  await page.getByRole('option', { name: 'Charlotte Gainsbourg', exact: true }).click();
  await search.fill('molecular coctails');
  await page.getByRole('option', { name: 'Molecular cocktails', exact: true }).click();
  await search.fill('pole');
  await page.getByRole('option', { name: 'Pole dancing', exact: true }).click();
  await search.fill("Shor's algorithm");
  await expect(options).toHaveCount(0);
  await search.press('Escape');
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await search.click();
  await expect(search).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Remove Pole dancing' }).click();
  await search.fill('pole fitness');
  await expect(page.getByRole('option', { name: 'Pole dancing' })).toBeVisible();
  await search.fill('');
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Music', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(options).toHaveCount(8);
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(options).toHaveCount(16);
  await search.fill('shor');
  await expect(options).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await search.fill('ambient');
  await expect(page.getByRole('option', { name: 'Ambient' })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: `.artifacts/${info.project.name}-interest-search.png`, fullPage: true });
  await search.press('Escape');
  await preview(page);
  await page.getByRole('button', { name: 'Save character' }).click();
  await page.reload();
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Character', exact: true }).click();
  const profile = (await (await page.request.get('/api/me')).json()).profile;
  expect(profile.tags.map((tag: any) => tag.code).sort()).toEqual(['charlotte_gainsbourg', 'molecular_cocktails', 'shors_algorithm']);
  await expect(page.locator('.profile-identity')).toContainText('Charlotte Gainsbourg');
  await expect(page.locator('.profile-identity')).not.toContainText('Pole dancing');
  expect(await page.locator('.pixel-emoji').first().evaluate((node: HTMLCanvasElement) =>
    node.getContext('2d')!.getImageData(0, 0, 16, 16).data.some((value, index) => index % 4 === 3 && value > 0)
  )).toBe(true);
});

test('interest limit blocks additions until a selected tag is removed', async ({ page }) => {
  await register(page);
  await expect(page.locator('.save-status.saved')).toBeVisible();
  const state = (await (await page.request.get('/api/me')).json());
  const selected = tags.slice(0, 30).map(tag => ({ kind: 'catalog', code: tag.code }));
  expect((await page.request.put('/api/draft', { data: { ...state.draft, tags: selected } })).status()).toBe(200);
  await page.reload();
  const search = page.getByRole('combobox', { name: 'Search interests' });
  await search.fill('coffee');
  const coffee = page.getByRole('option', { name: 'Coffee', exact: true });
  await expect(coffee).toHaveAttribute('aria-disabled', 'true');
  await coffee.dispatchEvent('click');
  await expect(page.getByRole('button', { name: 'Remove Coffee', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create tag', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: `Remove ${tags[0].label}`, exact: true }).click();
  await search.fill('coffee');
  await expect(coffee).toHaveAttribute('aria-disabled', 'false');
  await coffee.click();
  await expect(page.getByRole('button', { name: 'Remove Coffee', exact: true })).toBeVisible();
  await search.press('Escape');
  await preview(page);
  await expect(page.getByRole('heading', { name: 'Preview character', exact: true })).toBeVisible();
  const updated = (await (await page.request.get('/api/me')).json()).draft;
  expect(updated.tags).toHaveLength(30);
  expect(updated.tags.some((tag: any) => tag.code === 'coffee')).toBe(true);
});

test('spoken languages and private country/city/online adventure filters persist independently', async ({ page }, info) => {
  await register(page);
  await page.getByRole('navigation', { name: 'Character creation' }).getByRole('button', { name: 'Languages & filters' }).click();
  const spoken = page.getByRole('combobox', { name: 'Languages I speak', exact: true });
  await spoken.fill('рус');
  await page.getByRole('option', { name: /^Russian/ }).click();
  await spoken.fill('English');
  await spoken.press('Enter');
  await expect(page.locator('.profile-languages').getByRole('button', { name: 'Remove English', exact: true })).toBeVisible();
  await spoken.press('Escape');
  const where = page.getByRole('combobox', { name: 'Where', exact: true });
  await page.getByRole('button', { name: 'Use languages I speak' }).click();
  await page.getByRole('button', { name: 'Save filters' }).click();
  await expect(page.getByRole('button', { name: 'Save filters' })).toBeDisabled();
  let state = await (await page.request.get('/api/me')).json();
  expect(state.discovery.locationIds).toEqual(['country:IL']);
  expect(state.discovery.languageCodes).toEqual(['en', 'ru']);
  await page.getByRole('button', { name: 'Remove All Israel' }).click();
  for (const [query, name] of [['Хайфа', /^Haifa/], ['Tel-Aviv', /^Tel Aviv/], ['Online', /^Online/]] as const) {
    await where.fill(query);
    await page.getByRole('option', { name }).click();
  }
  await page.getByRole('button', { name: 'Save filters' }).click();
  await expect(page.getByRole('button', { name: 'Save filters' })).toBeDisabled();
  await noOverflow(page);
  await page.screenshot({ path: `.artifacts/${info.project.name}-discovery-filters.png`, fullPage: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Languages & filters' })).toBeVisible();
  await expect(page.locator('.profile-languages').getByRole('button', { name: 'Remove Russian', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Haifa' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Tel Aviv' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Online' })).toBeVisible();
  state = await (await page.request.get('/api/me')).json();
  expect(state.user.locale).toBe('en');
  expect(state.draft.spokenLanguages).toEqual(['ru', 'en']);
  expect(state.discovery.locationIds).toEqual(['city:293397', 'city:294801', 'online']);
  await preview(page);
  await page.getByRole('button', { name: 'Save character' }).click();
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Character', exact: true }).click();
  await expect(page.locator('.profile-card .spoken-languages')).toContainText('Russian · English');
  await expect(page.locator('.profile-card')).not.toContainText('Haifa');
  await expect(page.locator('.profile-card')).not.toContainText('Online');
  await noOverflow(page);
  await page.screenshot({ path: `.artifacts/${info.project.name}-profile-languages.png`, fullPage: true });
});
