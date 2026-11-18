import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { Express } from 'express';
import { createPool, type Pool } from '../../server/db.ts';
import { migrate } from '../../server/migrate.ts';
import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';
import { can } from '../../server/permissions.ts';

const connection = process.env.TEST_DATABASE_URL;
const locationCatalogPath = fileURLToPath(new URL('../fixtures/locations.json', import.meta.url));
let root: Pool, pool: Pool, app: Express;
const database = `questr_test_${randomUUID().replaceAll('-', '')}`;
before(async () => {
  if (!connection) return;
  root = createPool(connection);
  await root.query(`CREATE DATABASE "${database}"`);
  const url = new URL(connection); url.pathname = `/${database}`;
  pool = createPool(url.toString()); await migrate(pool, locationCatalogPath);
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
async function activeWithInvite(name: string, invite: string) {
  const { agent, state } = await browser();
  const draft = (await agent.post('/api/register').send({ displayName: name, invite, adult: true, terms: true, locale: 'en' }).expect(200)).body.draft;
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

integration('invite grants become roles, depth shrinks each generation, and issuers cannot escalate rights', async () => {
  const owner = await active('Role Admin');
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Test admin')", [owner.id]);
  const firstCode = code();
  const firstRequest = { ...issue(firstCode), eventCreator: false, inviteDepth: 2 };
  const first = (await owner.agent.post('/api/invites').send(firstRequest).expect(201)).body;
  assert.equal((await owner.agent.post('/api/invites').send(firstRequest).expect(201)).body.id, first.id);
  await owner.agent.post('/api/invites').send({ ...firstRequest, inviteDepth: 1 }).expect(409);
  const firstUser = await activeWithInvite('First Inviter', firstCode);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM role_assignments WHERE user_id=$1 AND role_code='event_creator'", [firstUser.id])).rows[0].n, 0);
  assert.equal(await can(pool, firstUser.id, 'events.create', { type: 'location', id: 'online' }), false);
  assert.equal((await pool.query("SELECT invite_depth FROM role_assignments WHERE user_id=$1 AND role_code='inviter'", [firstUser.id])).rows[0].invite_depth, 2);
  const firstList = (await firstUser.agent.get('/api/invites').expect(200)).body;
  assert.deepEqual(firstList.grantOptions, { eventCreator: false, maxInviteDepth: 1 });
  await firstUser.agent.post('/api/invites').send({ ...issue(), eventCreator: true }).expect(403);
  await firstUser.agent.post('/api/invites').send({ ...issue(), inviteDepth: 2 }).expect(403);
  const childCode = code();
  await firstUser.agent.post('/api/invites').send({ ...issue(childCode), eventCreator: false, inviteDepth: 1 }).expect(201);
  const child = await activeWithInvite('Second Inviter', childCode);
  assert.deepEqual((await child.agent.get('/api/invites').expect(200)).body.grantOptions, { eventCreator: false, maxInviteDepth: 0 });
  const lastCode = code();
  await child.agent.post('/api/invites').send({ ...issue(lastCode), eventCreator: false, inviteDepth: 0 }).expect(201);
  const last = await activeWithInvite('Final Member', lastCode);
  await last.agent.get('/api/invites').expect(403);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM role_assignments WHERE user_id=$1 AND role_code='inviter'", [last.id])).rows[0].n, 0);
});

integration('admins grant and revoke global roles and budgets without resetting usage', async () => {
  const owner = await active('Grant Admin');
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Test admin')", [owner.id]);
  const target = await active('Grant Target');
  const settings = { eventCreator: false, eventMaxUses: 0, eventWindowDays: 7, inviter: true, inviteDepth: 2,
    inviteMaxUses: 1, inviteWindowDays: 30, admin: false };
  await target.agent.put(`/api/invites/admin/roles/${target.id}`).send(settings).expect(403);
  await owner.agent.put(`/api/invites/admin/roles/${target.id}`).send(settings).expect(200);
  assert.equal(await can(pool, target.id, 'events.create', { type: 'location', id: 'online' }), false);
  const users = (await owner.agent.get('/api/invites/admin/inviters?q=Grant%20Target').expect(200)).body.users;
  assert.equal(users.length, 1);
  assert.equal(users[0].isEventCreator, false);
  assert.equal(users[0].isInviter, true);
  assert.equal(users[0].inviteDepth, 2);
  assert.equal(users[0].budget.maxUses, 1);
  assert.equal(users[0].eventBudget.maxUses, 0);
  await owner.agent.put(`/api/invites/admin/roles/${target.id}`).send({ ...settings, eventCreator: true, eventMaxUses: 1 }).expect(200);
  assert.equal(await can(pool, target.id, 'events.create', { type: 'location', id: 'online' }), true);
  await target.agent.post('/api/invites').send(issue()).expect(201);
  await target.agent.post('/api/invites').send(issue()).expect(429);
  await owner.agent.put(`/api/invites/admin/roles/${target.id}`).send({ ...settings, inviter: false, admin: true }).expect(200);
  assert.equal((await target.agent.get('/api/me')).body.permissions.admin, true);
  await owner.agent.put(`/api/invites/admin/roles/${target.id}`).send({ ...settings, inviter: false, admin: false }).expect(200);
  assert.equal((await target.agent.get('/api/me')).body.permissions.inviteCreate, false);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM capability_usage WHERE user_id=$1 AND capability='invite.create'", [target.id])).rows[0].n, 1);
  await owner.agent.put(`/api/invites/admin/roles/${owner.id}`).send({ ...settings, admin: false }).expect(400);
});

integration('an active character can redeem several invites for communities and roles', async () => {
  const admin = await active('Community Admin');
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Test admin')", [admin.id]);
  const firstCode = code();
  const firstRequest = { ...issue(firstCode), eventCreator: false, communityIds: ['ariel_students'] };
  const first = (await admin.agent.post('/api/invites').send(firstRequest).expect(201)).body;
  assert.equal((await admin.agent.post('/api/invites').send(firstRequest).expect(201)).body.id, first.id);
  await admin.agent.post('/api/invites').send({ ...firstRequest, communityIds: [] }).expect(409);
  const member = await activeWithInvite('Ariel Member', firstCode);
  assert.deepEqual((await member.agent.get('/api/me').expect(200)).body.profile.communities, ['ariel_students']);
  const secondCode = code();
  await admin.agent.post('/api/invites').send({ ...issue(secondCode), eventCreator: true, inviteDepth: 1,
    communityIds: ['israeli_university_students'] }).expect(201);
  const firstRedeem = (await member.agent.post('/api/invites/redeem').send({ code: secondCode }).expect(200)).body;
  assert.equal(firstRedeem.alreadyRedeemed, false);
  assert.equal((await member.agent.post('/api/invites/redeem').send({ code: secondCode }).expect(200)).body.alreadyRedeemed, true);
  assert.deepEqual((await member.agent.get('/api/me').expect(200)).body.profile.communities,
    ['ariel_students', 'israeli_university_students']);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM user_community_grants WHERE user_id=$1', [member.id])).rows[0].n, 2);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM role_assignments WHERE user_id=$1 AND role_code='member' AND revoked_at IS NULL", [member.id])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM capability_budgets WHERE user_id=$1 AND capability='invite.create'", [member.id])).rows[0].n, 1);
  assert.equal(await can(pool, member.id, 'invite.create', { type: 'global' }), true);
  const other = await active('Other Invite User');
  await other.agent.post('/api/invites/redeem').send({ code: secondCode }).expect(400);
  await member.agent.post('/api/invites').send({ ...issue(), communityIds: ['ariel_students'] }).expect(403);
});
