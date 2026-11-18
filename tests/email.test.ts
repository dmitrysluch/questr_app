import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brevoSender, verificationEmail } from '../server/email-invites.ts';
import { loadConfig } from '../server/config.ts';

test('verification email has readable English and Russian HTML and plain text', () => {
  for (const locale of ['en', 'ru']) {
    const email = verificationEmail('00123456', locale);
    assert.match(email.subject, /QUESTR/);
    assert.match(email.textContent, /00123456/);
    assert.match(email.htmlContent, /00123456/);
    assert.match(email.htmlContent, new RegExp(`<html lang="${locale}"`));
    assert.match(email.htmlContent, /10 (?:minutes|минут)/);
    assert.doesNotMatch(email.htmlContent, /<script|<img/i);
  }
  assert.throws(() => verificationEmail('<script>', 'en'));
});

test('Brevo receives both body variants', async () => {
  let payload: Record<string, unknown> | undefined;
  const sender = brevoSender({ ...loadConfig(), brevoApiKey: 'test', brevoSenderEmail: 'no-reply@questr.test' }, undefined,
    async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return new Response('{}', { status: 201 });
    });
  await sender('member@example.test', '12345678', 'ru');
  assert.equal(payload?.subject, 'Код подтверждения QUESTR');
  assert.match(String(payload?.htmlContent), /12345678/);
  assert.match(String(payload?.textContent), /12345678/);
});
