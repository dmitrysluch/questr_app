import { test, expect } from '@playwright/test';

test('one place search offers saved venues and Google points', async ({ page }) => {
  await expect.poll(async () => (await page.request.get('/api/config')).status()).toBe(200);
  await page.request.post('/api/auth/demo', { data: {} });
  const state = await (await page.request.get('/api/me')).json();
  const registered = await (await page.request.post('/api/register', { data: {
    displayName: 'Place scout', invite: state.demoInvite, adult: true, terms: true, locale: 'en',
  } })).json();
  const saved = await (await page.request.put('/api/draft', { data: {
    ...registered.draft, avatarId: 'moss', spokenLanguages: ['en'], introMarkdown: 'I like coffee and places.',
  } })).json();
  await page.request.put('/api/discovery', { data: { revision: 0, locationIds: ['country:IL'], languageCodes: ['en'] } });
  await page.request.post('/api/profile/publish', { data: { revision: saved.draft.revision } });

  await page.route('**/api/config', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), googleMapsBrowserKey: 'fake-test-key' } });
  });
  await page.route('**/api/places?**', route => route.fulfill({ json: { places: [{
    id: '00000000-0000-4000-8000-000000000001', cityLocationId: 'city:294801', cityName: 'Haifa',
    name: 'Saved Cafe', address: '12 Sample Street', active: true, revision: 0,
  }] } }));
  await page.addInitScript(() => {
    (window as any).google = { maps: { importLibrary: async () => ({
      AutocompleteSessionToken: class {},
      AutocompleteSuggestion: { fetchAutocompleteSuggestions: async () => ({ suggestions: [{ placePrediction: {
        text: { toString: () => 'Google Coffee Shop, Haifa' },
        toPlace: () => ({ id: 'ChIJtestCoffee', displayName: 'Google Coffee Shop',
          fetchFields: async () => undefined }),
      } }] }) },
    }) } };
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Create adventure', exact: true }).click();
  const editor = page.getByRole('dialog');
  const startBox = await editor.getByLabel('Starts', { exact: true }).boundingBox();
  const endBox = await editor.getByLabel('Ends', { exact: true }).boundingBox();
  if (!startBox || !endBox) throw new Error('Time inputs are missing');
  expect(Math.abs(startBox.y - endBox.y)).toBeLessThan(5);
  expect(startBox.x + startBox.width).toBeLessThan(endBox.x);
  const startDate = await editor.getByLabel('Date', { exact: true }).inputValue();
  await editor.getByLabel('Starts', { exact: true }).fill('23:00');
  await expect(editor.getByLabel('Ends', { exact: true })).toHaveValue('01:00');
  const endDate = await editor.getByLabel('End date').inputValue();
  expect(endDate > startDate).toBe(true);
  await editor.getByRole('combobox', { name: 'City or online' }).fill('Haifa');
  await editor.getByRole('option', { name: 'Haifa Israel', exact: true }).click();
  const search = editor.getByRole('combobox', { name: 'Place (optional)' });
  await expect(editor.getByRole('combobox', { name: 'City or online' })).toHaveCount(0);
  await expect(search).toBeFocused();
  await editor.getByRole('button', { name: 'Change' }).click();
  await expect(editor.getByRole('combobox', { name: 'City or online' })).toBeFocused();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await search.fill('cafe');
  const savedOption = editor.getByRole('option', { name: /Saved Cafe.*12 Sample Street/ });
  const googleOption = editor.getByRole('option', { name: /Google Coffee Shop.*Google Maps/ });
  await expect(savedOption).toBeVisible();
  await expect(googleOption).toBeVisible();
  await savedOption.click();
  await expect(editor.getByText('Saved Cafe', { exact: true })).toBeVisible();
  await search.fill('cafe');
  await googleOption.click();
  await expect(editor.getByText('Google Maps points are visible only to accepted party members.')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Remove Google Coffee Shop' })).toBeVisible();
  await expect(editor.getByLabel('District or area')).toHaveCount(0);
  await editor.getByRole('textbox', { name: 'Adventure title' }).fill('Coffee map walk');
  await editor.getByRole('textbox', { name: 'What will the party do?' }).fill('Walk through the city and compare coffee shops.');
  await editor.getByRole('button', { name: 'Publish adventure' }).click();
  await expect(page.getByRole('heading', { name: 'Coffee map walk', level: 1 })).toBeVisible();
});
