import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyTelegramInitData } from '../server/auth.ts';

const token = 'test-only-bot-token';
const now = 1794427200000;
function signed(fields: Record<string, string>) {
  const check = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const signature = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash: signature }).toString();
}
const valid = () => ({ auth_date: String(now / 1000), user: JSON.stringify({ id: 555444333222, first_name: 'Private', username: 'never_public' }), query_id: 'test-query' });
test('Telegram signed identity is verified without exposing the rest of the user object', () => {
  assert.equal(verifyTelegramInitData(signed(valid()), token, now), '555444333222');
});
test('Telegram authentication rejects tampering, duplicate parameters, wrong token and malformed signatures', () => {
  const raw = signed(valid());
  assert.throws(() => verifyTelegramInitData(raw.replace('555444333222', '555444333223'), token, now));
  assert.throws(() => verifyTelegramInitData(`${raw}&auth_date=1`, token, now));
  assert.throws(() => verifyTelegramInitData(raw, 'wrong', now));
  assert.throws(() => verifyTelegramInitData('hash=123', token, now));
});
test('Telegram authentication rejects stale, future and invalid identities even when correctly signed', () => {
  for (const seconds of [-301, 31]) assert.throws(() => verifyTelegramInitData(signed({ ...valid(), auth_date: String(now / 1000 + seconds) }), token, now));
  for (const id of [0, -1, '123', 1.5, 9007199254740992]) assert.throws(() => verifyTelegramInitData(signed({ ...valid(), user: JSON.stringify({ id }) }), token, now));
});
