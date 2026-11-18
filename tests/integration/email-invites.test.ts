import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { Express } from 'express';
import { createPool, type Pool } from '../../server/db.ts';
import { migrate } from '../../server/migrate.ts';
import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';

const connection = process.env.TEST_DATABASE_URL;
const locationCatalogPath = fileURLToPath(new URL('../fixtures/locations.json', import.meta.url));
const communityCatalogPath = fileURLToPath(new URL('../fixtures/communities.json', import.meta.url));
const database = `questr_test_${randomUUID().replaceAll('-', '')}`;
let root: Pool, pool: Pool, app: Express;
const sent: { email: string; code: string }[] = [];
before(async () => {
  if (!connection) return;
  root = createPool(connection);
  await root.query(`CREATE DATABASE "${database}"`);
  const url = new URL(connection); url.pathname = `/${database}`;
  pool = createPool(url.toString()); await migrate(pool, locationCatalogPath, communityCatalogPath);
  app = createApp(pool, { ...loadConfig(), authMode: 'demo', aiMode: 'demo', brevoApiKey: 'test', brevoSenderEmail: 'no-reply@questr.test' },
    undefined, undefined, async (email, code) => { sent.push({ email, code }); });
});
after(async () => {
  if (!connection) return;
  await pool?.end(); await root.query(`DROP DATABASE IF EXISTS "${database}"`); await root.end();
});
const integration = (name: string, fn: () => Promise<void>) => test(name, { skip: !connection }, fn);
async function browser() {
  const agent = request.agent(app);
  await agent.post('/api/auth/demo').send({}).expect(200);
  return { agent, state: (await agent.get('/api/me').expect(200)).body };
}
async function active(name: string) {
  const { agent, state } = await browser();
  const draft = (await agent.post('/api/register').send({ displayName: name, invite: state.demoInvite, adult: true, terms: true, locale: 'en' }).expect(200)).body.draft;
  await agent.put('/api/discovery').send({ revision: 0, locationIds: ['online'], languageCodes: ['en'] }).expect(200);
  const saved = (await agent.put('/api/draft').send({ ...draft, avatarId: 'moss' }).expect(200)).body.draft;
  await agent.post('/api/profile/publish').send({ revision: saved.revision }).expect(200);
  return { agent, id: state.user.id };
}

integration('only admins configure exact email domains; verification admits a new character and grants its community', async () => {
  const admin = await active('Domain Admin');
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Test admin')", [admin.id]);
  const newcomer = await browser();
  const rule = { domain: 'School.Example', enabled: true, allowRegistration: true, communityIds: ['ariel_students'] };
  await newcomer.agent.put('/api/email-invites/admin/domains').send(rule).expect(403);
  await admin.agent.put('/api/email-invites/admin/domains').send(rule).expect(200);
  assert.deepEqual((await admin.agent.get('/api/email-invites/admin/domains').expect(200)).body.domains[0].communityIds, ['ariel_students']);
  const before = sent.length;
  await newcomer.agent.post('/api/email-invites/request').send({ email: 'student@school.example.evil' }).expect(400);
  assert.equal(sent.length, before);
  await newcomer.agent.post('/api/email-invites/request').send({ email: 'Student@SCHOOL.EXAMPLE' }).expect(200);
  assert.equal(sent.at(-1)?.email, 'student@school.example');
  const code = sent.at(-1)!.code;
  await newcomer.agent.post('/api/email-invites/verify').send({ email: 'student@school.example', code: code === '00000000' ? '00000001' : '00000000' }).expect(400);
  assert.equal((await pool.query("SELECT attempts FROM email_verification_challenges WHERE email='student@school.example'")).rows[0].attempts, 1);
  await newcomer.agent.post('/api/email-invites/verify').send({ email: 'student@school.example', code }).expect(200);
  await newcomer.agent.post('/api/email-invites/verify').send({ email: 'student@school.example', code }).expect(400);
  assert.equal((await newcomer.agent.get('/api/me').expect(200)).body.emailRegistrationAllowed, true);
  await newcomer.agent.post('/api/register').send({ displayName: 'Student', adult: true, terms: true, locale: 'en' }).expect(200);
  const grants = await pool.query('SELECT community_id FROM user_community_grants WHERE user_id=$1', [newcomer.state.user.id]);
  assert.deepEqual(grants.rows.map(row => row.community_id), ['ariel_students']);
  await newcomer.agent.post('/api/email-invites/request').send({ email: 'stale@school.example' }).expect(200);
  await pool.query("UPDATE email_verification_challenges SET expires_at=now()-interval '1 second' WHERE email='stale@school.example'");
  await newcomer.agent.post('/api/email-invites/verify').send({ email: 'stale@school.example', code: sent.at(-1)!.code }).expect(400);
  const second = await browser();
  await second.agent.post('/api/email-invites/request').send({ email: 'student@school.example' }).expect(409);
});

integration('community-only domain works after registration and a disabled rule blocks new messages', async () => {
  const admin = await active('Second Admin');
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Test admin')", [admin.id]);
  const member = await active('Existing Member');
  const rule = { domain: 'club.example', enabled: true, allowRegistration: false, communityIds: ['university_students'] };
  await admin.agent.put('/api/email-invites/admin/domains').send(rule).expect(200);
  const pending = await browser();
  const before = sent.length;
  await pending.agent.post('/api/email-invites/request').send({ email: 'new@club.example' }).expect(400);
  assert.equal(sent.length, before);
  await member.agent.post('/api/email-invites/request').send({ email: 'member@club.example' }).expect(200);
  const code = sent.at(-1)!.code;
  await member.agent.post('/api/email-invites/request').send({ email: 'member@club.example' }).expect(429);
  await member.agent.post('/api/email-invites/verify').send({ email: 'member@club.example', code }).expect(200);
  assert.deepEqual((await member.agent.get('/api/me').expect(200)).body.profile.communities, ['university_students']);
  await member.agent.post('/api/email-invites/request').send({ email: 'later@club.example' }).expect(200);
  await admin.agent.put('/api/email-invites/admin/domains').send({ ...rule, enabled: false }).expect(200);
  await member.agent.post('/api/email-invites/verify').send({ email: 'later@club.example', code: sent.at(-1)!.code }).expect(400);
  await member.agent.post('/api/email-invites/request').send({ email: 'other@club.example' }).expect(400);
  assert.equal(sent.length, before + 2);
});
