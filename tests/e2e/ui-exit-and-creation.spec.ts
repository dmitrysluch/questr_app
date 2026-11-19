import { test, expect, type Page } from '@playwright/test';

async function publishedCharacter(page: Page) {
  await expect.poll(async () => (await page.request.get('/api/health')).status()).toBe(200);
  await page.request.post('/api/auth/demo', { data: {} });
  const state = await (await page.request.get('/api/me')).json();
  const registration = await (await page.request.post('/api/register', { data: {
    displayName: 'UI explorer', invite: state.demoInvite, adult: true, terms: true, locale: 'en',
  } })).json();
  const saved = await (await page.request.put('/api/draft', { data: {
    ...registration.draft, avatarId: 'moss', spokenLanguages: ['en'], introMarkdown: 'I like coffee and records.',
  } })).json();
  expect((await page.request.put('/api/discovery', { data: {
    revision: 0, locationIds: ['country:IL'], languageCodes: ['en'],
  } })).status()).toBe(200);
  expect((await page.request.post('/api/profile/publish', { data: { revision: saved.draft.revision } })).status()).toBe(200);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Adventures', exact: true })).toBeVisible();
}

test('leaving character editor offers save, discard and cancel for changed filters', async ({ page }) => {
  await publishedCharacter(page);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Character' }).click();
  await page.getByRole('button', { name: 'Edit character' }).click();
  const steps = page.getByRole('navigation', { name: 'Character creation' });
  await steps.getByRole('button', { name: 'Languages & filters' }).click();
  const where = page.getByRole('combobox', { name: 'Where' });
  await where.fill('Online');
  await page.locator('.selection-results [role=option]').filter({ hasText: 'Online' }).click();
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Adventures' }).click();
  const dialog = page.getByRole('dialog', { name: 'Unsaved adventure filters' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await (await page.request.get('/api/me')).json()).discovery.locationIds).toEqual(['country:IL']);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Adventures' }).click();
  await dialog.getByRole('button', { name: 'Save and leave' }).click();
  await expect(page.getByRole('heading', { name: 'Adventures', exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/me')).json()).discovery.locationIds).toEqual(['country:IL', 'online']);

  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Character' }).click();
  await page.getByRole('button', { name: 'Edit character' }).click();
  await steps.getByRole('button', { name: 'Languages & filters' }).click();
  await page.getByRole('button', { name: 'Remove Online' }).click();
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Adventures' }).click();
  await dialog.getByRole('button', { name: 'Discard changes' }).click();
  expect((await (await page.request.get('/api/me')).json()).discovery.locationIds).toEqual(['country:IL', 'online']);
});

test('community filters persist in the profile while Discover can override them for one search', async ({ page }) => {
  await publishedCharacter(page);
  const temporary = page.locator('.adhoc-discovery');
  await temporary.locator('summary').click();
  const request = page.waitForRequest(request => request.url().includes('/api/events?') && new URL(request.url()).searchParams.has('filters'));
  await temporary.getByRole('combobox', { name: 'Community' }).selectOption('mine');
  const filters = JSON.parse(new URL((await request).url()).searchParams.get('filters')!);
  expect(filters.communityFilter).toEqual({ mode: 'mine' });
  expect((await (await page.request.get('/api/me')).json()).discovery.communityFilter).toEqual({ mode: 'all' });
  await page.reload();
  await temporary.locator('summary').click();
  await expect(temporary.getByRole('combobox', { name: 'Community' })).toHaveValue('all');

  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Character' }).click();
  await page.getByRole('button', { name: 'Edit character' }).click();
  await page.getByRole('navigation', { name: 'Character creation' }).getByRole('button', { name: 'Languages & filters' }).click();
  const saved = page.locator('.discovery-onboarding');
  await saved.getByRole('combobox', { name: 'Community' }).selectOption('community:university_students');
  await saved.getByRole('button', { name: 'Save filters' }).click();
  await expect.poll(async () => (await (await page.request.get('/api/me')).json()).discovery.communityFilter).toEqual({ mode: 'community', communityId: 'university_students' });
  await page.reload();
  const profileFilters = page.locator('.discovery-settings');
  await profileFilters.locator('summary').click();
  await expect(profileFilters.getByRole('combobox', { name: 'Community' })).toHaveValue('community:university_students');
});

test('event location replaces in one selection and keeps offline details separate from call link', async ({ page }) => {
  await publishedCharacter(page);
  await expect(page.getByText('2 of 2 adventures left in 7 days')).toBeVisible();
  await page.getByRole('button', { name: 'Create adventure' }).click();
  const editor = page.getByRole('dialog', { name: 'Create adventure' });
  const where = editor.getByRole('combobox', { name: 'City or online' });
  const locations = editor.locator('.selection-results [role=option]');
  await where.fill('Haifa');
  await locations.filter({ hasText: 'Haifa' }).first().click();
  await editor.locator('summary').click();
  await editor.locator('#event-meeting').fill('Café by the station');
  await editor.locator('.event-location-picker').first().getByRole('button').click();
  await where.fill('Online');
  await locations.filter({ hasText: 'Online' }).click();
  await expect(editor.locator('#event-meeting')).toHaveAttribute('type', 'url');
  await expect(editor.locator('#event-meeting')).toHaveValue('');
  await editor.locator('#event-meeting').fill('https://meet.example/call');
  await editor.locator('.event-location-picker').first().getByRole('button').click();
  await where.fill('Haifa');
  await locations.filter({ hasText: 'Haifa' }).first().click();
  await expect(editor.locator('#event-meeting')).toHaveValue('Café by the station');
  await editor.locator('.event-location-picker').first().getByRole('button').click();
  await where.fill('Tel Aviv');
  await locations.filter({ hasText: 'Tel Aviv' }).first().click();
  await expect(editor.locator('#event-meeting')).toHaveValue('');
  await editor.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('dialog', { name: 'Discard changes?' }).getByRole('button', { name: 'Confirm' }).click();
  await page.route('**/api/events/create-access', route => route.fulfill({ json: { hasRole: false, canCreate: false, budget: null } }));
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('button', { name: 'Create adventure' })).toHaveCount(0);
});

test('quick adventure creation uses visible essentials and editable defaults', async ({ page }) => {
  await publishedCharacter(page);
  await page.getByRole('button', { name: 'Create adventure' }).click();
  const editor = page.getByRole('dialog', { name: 'Create adventure' });
  await expect(editor.locator('.event-options')).not.toHaveAttribute('open');
  await editor.getByLabel('Adventure title').fill('A slow café afternoon');
  await editor.getByLabel('What will the party do?').fill('Bring a book or just come chat over coffee.');
  await editor.getByLabel('Date', { exact: true }).fill('2030-06-15');
  await editor.getByLabel('Starts').fill('19:30');
  await editor.getByLabel('Ends').fill('21:30');
  await editor.getByRole('combobox', { name: 'City or online' }).fill('Haifa');
  await editor.locator('.selection-results [role=option]').filter({ hasText: 'Haifa' }).first().click();
  await editor.getByRole('button', { name: 'Publish adventure' }).click();
  await expect(page.getByRole('heading', { name: 'A slow café afternoon', level: 1 })).toBeVisible();
  await expect(page.locator('.event-facts')).toContainText('Free');
  await expect(page.locator('.event-experience')).toContainText('Beginners welcome');
});
