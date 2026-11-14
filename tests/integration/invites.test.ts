import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { createPool, type Pool } from '../../server/db.ts';
import { migrate } from '../../server/migrate.ts';
import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';

const connection = process.env.TEST_DATABASE_URL;
let root: Pool, pool: Pool, app: Express;
const database = `questr_test_${randomUUID().replaceAll('-', '')}`;
before(async () => {
  if (!connection) return;
  root = createPool(connection);
  await root.query(`CREATE DATABASE "${database}"`);
  const url = new URL(connection); url.pathname = `/${database}`;
  pool = createPool(url.toString()); await migrate(pool);
  app = createApp(pool, { ...loadConfig(), authMode: 'demo', aiMode: 'demo' });
});
after(async () => {
  if (!connection) return;
  await pool?.end(); await root.query(`DROP DATABASE IF EXISTS "${database}"`); await root.end();
});
const integration = (name: string, fn: () => Promise<void>) => test(name, { skip: !connection }, fn);
async function browser() {
  const agent = request.agent(app);
  await agent.post('/api/auth/demo').send({}).expect(200);
  const state = (await agent.get('/api/me').expect(200)).body;
  return { agent, state };
}
async function active(name: string) {
  const { agent, state } = await browser();
  const draft = (await agent.post('/api/register').send({ displayName: name, invite: state.demoInvite, adult: true, terms: true, locale: 'en' }).expect(200)).body.draft;
  await agent.put('/api/discovery').send({ revision: 0, locationIds: ['online'], languageCodes: ['en'] }).expect(200);
  const saved = (await agent.put('/api/draft').send({ ...draft, avatarId: 'moss' }).expect(200)).body.draft;
  await agent.post('/api/profile/publish').send({ revision: saved.revision }).expect(200);
  return { agent, id: state.user.id };
}
const code = () => `QUEST-${randomBytes(18).toString('base64url')}`;
const issue = (inviteCode = code(), requestId = randomUUID()) => ({ code: inviteCode, requestId, expiresInDays: 7 });

integration('only invite-capable accounts can issue; retry spends the rolling budget once and never exposes saved codes', async () => {
  const host = await active('Admin Host');
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Test admin')", [host.id]);
  const outsider = await active('Ordinary Member');
  assert.equal((await outsider.agent.get('/api/me')).body.permissions.inviteCreate, false);
  await outsider.agent.get('/api/invites').expect(403);
  await outsider.agent.post('/api/invites').send(issue()).expect(403);
  const first = issue();
  const created = (await host.agent.post('/api/invites').send(first).expect(201)).body;
  assert.ok(created.id);
  assert.equal((await host.agent.post('/api/invites').send(first).expect(201)).body.id, created.id);
  await host.agent.post('/api/invites').send({ ...first, code: code() }).expect(409);
  const list = (await host.agent.get('/api/invites').expect(200)).body;
  assert.equal(list.budget.used, 1); assert.equal(list.budget.maxUses, 3); assert.equal(list.budget.windowDays, 7);
  assert.equal(list.invites.find((invite: any) => invite.id === created.id).status, 'active');
  assert.ok(!JSON.stringify(list).includes(first.code));
  await host.agent.post('/api/invites').send(issue()).expect(201);
  await host.agent.post('/api/invites').send(issue()).expect(201);
  assert.equal((await host.agent.post('/api/invites').send(issue()).expect(429)).body.error, 'BUDGET_EXHAUSTED');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM invites WHERE created_by=$1', [host.id])).rows[0].count, 3);
});

integration('admins can manage inviter access and budgets; inviters see only their own codes', async () => {
  const owner = await active('Invite Admin');
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Test admin')", [owner.id]);
  const inviter = await active('Invite Keeper');
  const other = await active('Other Character');
  await owner.agent.put(`/api/invites/admin/inviters/${inviter.id}`).send({ enabled: true, maxUses: 1, windowDays: 30 }).expect(200);
  await other.agent.put(`/api/invites/admin/inviters/${other.id}`).send({ enabled: true, maxUses: 50, windowDays: 1 }).expect(403);
  const users = (await owner.agent.get('/api/invites/admin/inviters?q=Keeper').expect(200)).body.users;
  assert.equal(users.length, 1); assert.equal(users[0].isInviter, true); assert.equal(users[0].budget.maxUses, 1);
  assert.equal((await inviter.agent.get('/api/me')).body.permissions.inviteCreate, true);
  const adminInvite = (await owner.agent.post('/api/invites').send(issue()).expect(201)).body;
  const ownCode = issue();
  const ownInvite = (await inviter.agent.post('/api/invites').send(ownCode).expect(201)).body;
  assert.equal((await inviter.agent.post('/api/invites').send(issue()).expect(429)).body.error, 'BUDGET_EXHAUSTED');
  const ownList = (await inviter.agent.get('/api/invites').expect(200)).body;
  assert.deepEqual(ownList.invites.map((invite: any) => invite.id), [ownInvite.id]);
  await inviter.agent.get('/api/invites/admin/inviters').expect(403);
  await inviter.agent.post(`/api/invites/${adminInvite.id}/revoke`).send({}).expect(404);
  await owner.agent.put(`/api/invites/admin/inviters/${inviter.id}`).send({ enabled: false, maxUses: 1, windowDays: 30 }).expect(200);
  await inviter.agent.get('/api/invites').expect(403);
  await inviter.agent.post('/api/invites').send(issue()).expect(403);
});

integration('single-use redemption and revocation update status without revealing codes', async () => {
  const owner = await active('Another Admin');
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Test admin')", [owner.id]);
  const used = issue(), revoked = issue();
  const usedId = (await owner.agent.post('/api/invites').send(used).expect(201)).body.id;
  const revokedId = (await owner.agent.post('/api/invites').send(revoked).expect(201)).body.id;
  const newcomer = await browser();
  await newcomer.agent.post('/api/register').send({ displayName: 'New Quester', invite: used.code, adult: true, terms: true, locale: 'en' }).expect(200);
  await owner.agent.post(`/api/invites/${usedId}/revoke`).send({}).expect(409);
  await owner.agent.post(`/api/invites/${revokedId}/revoke`).send({}).expect(200);
  const rejected = await browser();
  await rejected.agent.post('/api/register').send({ displayName: 'Rejected Quester', invite: revoked.code, adult: true, terms: true, locale: 'en' }).expect(400);
  const list = (await owner.agent.get('/api/invites').expect(200)).body.invites;
  assert.equal(list.find((invite: any) => invite.id === usedId).status, 'redeemed');
  assert.equal(list.find((invite: any) => invite.id === revokedId).status, 'revoked');
  assert.ok(!JSON.stringify(list).includes(used.code));
  assert.ok(!JSON.stringify(list).includes(revoked.code));
});
