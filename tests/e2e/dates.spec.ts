import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test('date setup lives in character romance settings and photos can be cropped and previewed', async ({ page }) => {
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
  await page.getByRole('link', { name: 'Open Romance settings' }).click();
  await expect(page.getByRole('heading', { name: 'Romance' })).toBeVisible();
  const romance = (await (await page.request.get('/api/me/romance')).json()).romance;
  await page.request.put('/api/me/romance', { data: { revision: romance.revision, gender: 'woman', interestedIn: ['man'], consent: true } });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Join dates' })).toBeVisible();
  await page.getByRole('button', { name: 'Join dates' }).click();
  await expect(page.getByText('Add a photo to create or respond to dates.')).toBeVisible();

  let uploaded: Buffer | null = null;
  await page.route('**/api/dates/me/settings', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const data = await response.json();
    return route.fulfill({ json: { settings: { ...data.settings, storageAvailable: true } } });
  });
  await page.route('**/api/dates/me/photo', async route => {
    if (route.request().method() === 'PUT') {
      uploaded = Buffer.from(route.request().postDataJSON().base64, 'base64');
      return route.fulfill({ json: { photoStatus: 'pending' } });
    }
    if (route.request().method() === 'GET' && uploaded) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: uploaded });
    return route.fulfill({ status: 404, json: { error: 'NOT_FOUND' } });
  });
  await page.reload();
  const source = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#83604f' } }).jpeg().toBuffer();
  await page.locator('.date-file-button input').setInputFiles({ name: 'portrait.jpg', mimeType: 'image/jpeg', buffer: source });
  await expect(page.getByRole('img', { name: 'Photo crop preview' })).toBeVisible();
  await page.getByRole('slider', { name: 'Zoom' }).fill('1.2');
  await page.getByRole('button', { name: 'Use this photo' }).click();
  await expect(page.getByRole('img', { name: 'Your date photo' })).toBeVisible();
  expect(uploaded).not.toBeNull();
  const output = await sharp(uploaded!).metadata();
  expect(output.width).toBe(output.height);
  expect(output.width).toBeGreaterThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Pause dates' }).click();
  await expect(page.getByRole('button', { name: 'Resume dates' })).toBeVisible();
});
