import { test, expect, type Page } from '@playwright/test';
import { createPool } from '../../server/db.ts';

const databaseUrl = process.env.DATABASE_URL;

async function character(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByLabel('I am 18 or older.').check();
  await page.getByLabel('I agree to the community guidelines.').check();
  await page.getByRole('button', { name: 'Create my character' }).click();
  const state = await (await page.request.get('/api/me')).json();
  await page.getByRole('tab', { name: 'Presets' }).click();
  await page.getByRole('button', { name: 'Choose Moss', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('navigation', { name: 'Character creation' }).getByRole('button', { name: 'Languages & filters' }).click();
  await page.getByRole('combobox', { name: 'Where', exact: true }).fill('Online');
  await page.getByRole('option', { name: /^Online/ }).click();
  await page.getByRole('combobox', { name: 'Adventure languages' }).fill('English');
  await page.getByRole('option', { name: /^English/ }).click();
  await page.getByRole('button', { name: 'Save filters' }).click();
  await expect(page.getByRole('button', { name: 'Save filters' })).toBeDisabled();
  await page.getByRole('navigation', { name: 'Character creation' }).getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: 'Save character' }).click();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  return state.user.id as string;
}

test('admin issues and revokes an invite, then grants a one-per-week inviter budget', async ({ page, browser }) => {
  test.skip(!databaseUrl, 'A local PostgreSQL URL is required for the admin browser test.');
  const pool = createPool(databaseUrl!);
  const guestContext = await browser.newContext();
  try {
    const adminId = await character(page, 'Admin Quester');
    await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Browser test')", [adminId]);
    await page.reload();
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Admin' }).click();
    await expect(page.getByRole('heading', { name: 'Invites', exact: true })).toBeVisible();
    await page.getByLabel('Invite chain', { exact: true }).selectOption('2');
    await page.getByRole('button', { name: 'Create invite' }).click();
    await expect(page.locator('.issued-invite code')).toHaveText(/^QUEST-[A-Za-z0-9_-]{24}$/);
    const newest = page.locator('.invite-list li').first();
    await expect(newest.locator('.invite-status.active')).toBeVisible();
    await expect(newest).toContainText('Invite chain: 2');
    await newest.getByRole('button', { name: 'Revoke', exact: true }).click();
    await newest.getByRole('button', { name: 'Confirm revoke' }).click();
    await expect(newest.locator('.invite-status.revoked')).toBeVisible();

    const guest = await guestContext.newPage();
    const friendName = `Invite Friend ${crypto.randomUUID().slice(0, 8)}`;
    await character(guest, friendName);
    await page.getByRole('textbox', { name: 'Search characters' }).fill(friendName);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const card = page.locator('.admin-user').filter({ hasText: friendName });
    await expect(card).toBeVisible();
    await card.getByLabel('Create adventures').uncheck();
    await card.getByLabel('Can issue invites').check();
    await card.getByLabel('Maximum invite chain').selectOption('2');
    await card.getByLabel('Invites per window').fill('1');
    await card.getByRole('button', { name: 'Save access' }).click();
    await expect(card.getByLabel('Create adventures')).not.toBeChecked();
    await expect(card.getByLabel('Maximum invite chain')).toHaveValue('2');
    await guest.reload();
    await expect(guest.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Invites' })).toBeVisible();
    await guest.getByRole('button', { name: 'Invites', exact: true }).click();
    await expect(guest.getByText('0 of 1 issued in 7 days')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await guestContext.close(); await pool.end(); }
});
