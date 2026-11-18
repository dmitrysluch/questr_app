import { timingSafeEqual } from 'node:crypto';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';
import type { Express, Request, Response, NextFunction } from 'express';
import type { Pool } from 'pg';

/** Operational metrics only. Label values must stay bounded; never add account, event, URL or message data. */
export class OperationalMetrics {
  private registry = new Registry();
  private requests = new Counter({ name: 'questr_http_requests_total', help: 'Completed HTTP requests', labelNames: ['method', 'route', 'status'], registers: [this.registry] });
  private duration = new Histogram({ name: 'questr_http_request_duration_seconds', help: 'HTTP request duration in seconds', labelNames: ['method', 'route'], buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60], registers: [this.registry] });
  private dependencyCalls = new Counter({ name: 'questr_dependency_requests_total', help: 'Outbound provider requests', labelNames: ['service', 'outcome'], registers: [this.registry] });
  private dependencyDuration = new Histogram({ name: 'questr_dependency_request_duration_seconds', help: 'Outbound provider request duration in seconds', labelNames: ['service'], buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60], registers: [this.registry] });
  private dbUp = new Gauge({ name: 'questr_database_up', help: 'PostgreSQL was reachable during the latest metrics collection', registers: [this.registry] });
  private poolConnections = new Gauge({ name: 'questr_db_pool_connections', help: 'PostgreSQL client pool connections', labelNames: ['state'], registers: [this.registry] });
  private poolWaiting = new Gauge({ name: 'questr_db_pool_waiting_requests', help: 'Requests waiting for a PostgreSQL client', registers: [this.registry] });
  private queueRows = new Gauge({ name: 'questr_bot_queue_rows', help: 'Bot inbox and outbox rows by state', labelNames: ['queue', 'state'], registers: [this.registry] });
  private queueOldest = new Gauge({ name: 'questr_bot_queue_oldest_due_age_seconds', help: 'Seconds since the oldest ready bot row became due, zero for an empty queue', labelNames: ['queue'], registers: [this.registry] });

  constructor(private pool: Pool) {
    collectDefaultMetrics({ register: this.registry });
  }

  recordDependency(service: 'telegram' | 'openrouter' | 'brevo', outcome: 'ok' | 'error', startedAt: number) {
    this.dependencyCalls.inc({ service, outcome });
    this.dependencyDuration.observe({ service }, (performance.now() - startedAt) / 1000);
  }

  install(app: Express, path: string, token: string) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === path) return next();
      const startedAt = performance.now();
      res.once('finish', () => {
        const routePath = req.route?.path;
        // Express route templates are bounded; unmatched URLs are never used as labels.
        const route = typeof routePath === 'string' ? `${this.mount(req.originalUrl)}${routePath}` : 'unmatched';
        const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(req.method) ? req.method : 'OTHER';
        this.requests.inc({ method, route, status: String(res.statusCode) });
        this.duration.observe({ method, route }, (performance.now() - startedAt) / 1000);
      });
      next();
    });
    app.get(path, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const supplied = req.get('authorization')?.replace(/^Bearer /i, '') ?? '';
      const expected = Buffer.from(token);
      const actual = Buffer.from(supplied);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).end();
      try {
        await this.refresh();
        res.setHeader('Content-Type', this.registry.contentType);
        res.send(await this.registry.metrics());
      } catch {
        res.status(503).end();
      }
    });
  }

  private mount(originalUrl: string) {
    const match = /^\/api\/(events|places|invites|email-invites)(?:\/|\?|$)/.exec(originalUrl);
    return match ? `/api/${match[1]}` : '';
  }

  private async refresh() {
    this.poolConnections.set({ state: 'total' }, this.pool.totalCount);
    this.poolConnections.set({ state: 'idle' }, this.pool.idleCount);
    this.poolWaiting.set(this.pool.waitingCount);
    try {
      const result = await this.pool.query(`SELECT
        (SELECT count(*)::int FROM bot_inbox WHERE state='pending' AND available_at<=now()) AS inbox_due,
        (SELECT count(*)::int FROM bot_inbox WHERE state='failed') AS inbox_failed,
        (SELECT extract(epoch FROM now()-available_at)::float8 FROM bot_inbox WHERE state='pending' AND available_at<=now() ORDER BY available_at LIMIT 1) AS inbox_age,
        (SELECT count(*)::int FROM bot_outbox WHERE state='pending' AND available_at<=now()) AS outbox_due,
        (SELECT count(*)::int FROM bot_outbox WHERE state='failed') AS outbox_failed,
        (SELECT extract(epoch FROM now()-available_at)::float8 FROM bot_outbox WHERE state='pending' AND available_at<=now() ORDER BY available_at LIMIT 1) AS outbox_age`);
      const row = result.rows[0];
      for (const queue of ['inbox', 'outbox'] as const) {
        this.queueRows.set({ queue, state: 'due' }, row[`${queue}_due`]);
        this.queueRows.set({ queue, state: 'failed' }, row[`${queue}_failed`]);
        this.queueOldest.set({ queue }, row[`${queue}_age`] ?? 0);
      }
      this.dbUp.set(1);
    } catch {
      this.dbUp.set(0);
      this.queueRows.reset();
      this.queueOldest.reset();
    }
  }
}
