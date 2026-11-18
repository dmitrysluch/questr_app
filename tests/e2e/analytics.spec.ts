import { expect, test } from '@playwright/test';
import { gunzipSync } from 'node:zlib';

test.use({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });

test('registration emits a PostHog event without form text or page URL', async ({ page }) => {
  const sent: string[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
  });
  await page.route('**/api/config', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), posthogProjectKey: 'phc_browser_test' } });
  });
  await page.route('https://eu.i.posthog.com/**', async route => {
    const body = route.request().postDataBuffer();
    if (body) sent.push((body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body) : body).toString('utf8'));
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' });
  });
  await page.goto('/');
  await page.getByLabel('Name', { exact: true }).fill('Private registration name');
  await page.getByLabel('I am 18 or older.').check();
  await page.getByLabel('I agree to the community guidelines.').check();
  await page.getByRole('button', { name: 'Create my character' }).click();
  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expect.poll(() => sent.join('\n')).toContain('registration_completed');
  await expect.poll(() => sent.join('\n')).toContain('screen_viewed');
  const payload = sent.join('\n');
  expect(payload).toContain('$identify');
  expect(payload).not.toContain('Private registration name');
  expect(payload).not.toContain('$current_url');
  expect(payload).not.toContain('$referrer');

  const registrationIds = () => sent.flatMap(body => {
    const data = JSON.parse(body);
    return Array.isArray(data) ? data : Array.isArray(data.batch) ? data.batch : [data];
  }).filter(event => event.event === 'registration_completed').map(event => event.properties.distinct_id as string);
  await page.context().clearCookies();
  await page.reload();
  await page.getByLabel('Name', { exact: true }).fill('Second private name');
  await page.getByLabel('I am 18 or older.').check();
  await page.getByLabel('I agree to the community guidelines.').check();
  await page.getByRole('button', { name: 'Create my character' }).click();
  await expect.poll(() => registrationIds().length).toBe(2);
  expect(registrationIds()[0]).not.toBe(registrationIds()[1]);
  expect(sent.join('\n')).not.toContain('Second private name');
});
