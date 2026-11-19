import { test, expect } from '@playwright/test';

test('date opt-in is separate from romance and fits the Mini App', async ({ page }) => {
  test.skip(!process.env.DATABASE_URL, 'A local PostgreSQL URL is required.');
  await expect.poll(async () => (await page.request.get('/api/health')).status()).toBe(200);
  await page.request.post('/api/auth/demo', { data: {} });
  const state = await (await page.request.get('/api/me')).json();
  const registered = await (await page.request.post('/api/register', { data: { displayName: 'Date explorer', invite: state.demoInvite, adult: true, terms: true, locale: 'en' } })).json();
  const saved = await (await page.request.put('/api/draft', { data: { ...registered.draft, avatarId: 'moss', introMarkdown: 'I like coffee, films and long walks.', spokenLanguages: ['en'] } })).json();
  await page.request.put('/api/discovery', { data: { revision: 0, locationIds: ['country:IL'], languageCodes: ['en'] } });
  await page.request.post('/api/profile/publish', { data: { revision: saved.draft.revision } });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Dates' }).click();
  await expect(page.getByRole('heading', { name: 'Dates' })).toBeVisible();
  await expect(page.getByText('Set up romance first')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join dates' })).toBeDisabled();
  const romance = (await page.request.get('/api/me/romance')).json();
  const revision = (await romance).romance.revision;
  await page.request.put('/api/me/romance', { data: { revision, gender: 'woman', interestedIn: ['man'], consent: true } });
  await page.reload();
  await page.getByRole('button', { name: 'Join dates' }).click();
  await expect(page.getByText('Add a photo to create or respond to dates.')).toBeVisible();
  await expect(page.getByText('Location, language and community filters also apply to adventures.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Pause dates' }).click();
  await expect(page.getByRole('button', { name: 'Resume dates' })).toBeVisible();
});
