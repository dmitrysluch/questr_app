import { Router } from 'express';
import { z } from 'zod';
import { Adventures } from './events.ts';
import type { Config } from './config.ts';
import { AppError } from './errors.ts';
import { eventCalendar } from './event-calendar.ts';

export function eventRoutes(events: Adventures, config: Config) {
  const router = Router();
  const id = (value: unknown) => z.uuid().parse(value);
  router.get('/', async (req, res) => {
    const query = z.object({ view: z.enum(['discover', 'mine']).default('discover'), offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict().parse(req.query);
    res.json(await events.list(res.locals.user.id, query.view, query.offset));
  });
  router.post('/', async (req, res) => res.status(201).json({ event: await events.create(res.locals.user.id, req.body) }));
  router.get('/:id', async (req, res) => res.json({ event: await events.detail(res.locals.user.id, id(req.params.id)) }));
  router.get('/:id/calendar.ics', async (req, res) => {
    const calendar = eventCalendar(await events.detail(res.locals.user.id, id(req.params.id)));
    res.type('text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="questr-adventure.ics"');
    res.send(calendar);
  });
  router.put('/:id', async (req, res) => res.json({ event: await events.edit(res.locals.user.id, id(req.params.id), req.body) }));
  router.post('/:id/applications', async (req, res) => {
    if (config.authMode !== 'demo') throw new AppError(403, 'USE_BOT_TO_APPLY');
    res.json({ event: await events.apply(res.locals.user.id, id(req.params.id), req.body) });
  });
  router.post('/:id/members/:userId', async (req, res) => {
    const { action } = z.object({ action: z.enum(['accept', 'decline', 'remove']) }).strict().parse(req.body);
    res.json({ event: await events.membership(res.locals.user.id, id(req.params.id), id(req.params.userId), action) });
  });
  router.post('/:id/leave', async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json({ event: await events.membership(res.locals.user.id, id(req.params.id), res.locals.user.id, 'leave') });
  });
  router.put('/:id/reminder', async (req, res) => {
    const { minutesBefore } = z.object({ minutesBefore: z.union([z.literal(15), z.literal(60), z.literal(1440), z.null()]) }).strict().parse(req.body);
    res.json({ event: await events.setReminder(res.locals.user.id, id(req.params.id), minutesBefore) });
  });
  router.post('/:id/status', async (req, res) => {
    const { status, revision } = z.object({ status: z.enum(['cancelled', 'completed']), revision: z.number().int().nonnegative() }).strict().parse(req.body);
    res.json({ event: await events.transition(res.locals.user.id, id(req.params.id), revision, status) });
  });
  router.get('/:id/profiles/:userId', async (req, res) => res.json({ profile: await events.profile(res.locals.user.id, id(req.params.id), id(req.params.userId)) }));
  return router;
}
