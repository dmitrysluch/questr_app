import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { s3DatePhotoStorage } from '../server/date-photo-storage.ts';
import { loadConfig } from '../server/config.ts';

test('private photo adapter uses configurable S3 endpoint, bucket and signed object operations', async () => {
  const objects = new Map<string, Buffer>();
  const requests: Array<{ method: string; path: string; authorized: boolean }> = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    requests.push({ method: req.method ?? '', path, authorized: /^AWS4-HMAC-SHA256 /.test(req.headers.authorization ?? '') });
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(path, Buffer.concat(chunks)); res.writeHead(200, { ETag: '"test"' }); res.end();
    } else if (req.method === 'GET') {
      const body = objects.get(path);
      if (!body) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': body.length }); res.end(body);
    } else if (req.method === 'DELETE') { objects.delete(path); res.writeHead(204); res.end(); }
    else { res.writeHead(405); res.end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP test server did not start');
    const config = { ...loadConfig(), datePhotoS3Endpoint: `http://127.0.0.1:${address.port}`,
      datePhotoS3Region: 'test-region', datePhotoS3Bucket: 'private-date-photos',
      datePhotoS3AccessKeyId: 'test-access-key', datePhotoS3SecretAccessKey: 'test-secret-key' };
    const storage = s3DatePhotoStorage(config);
    assert.ok(storage);
    const body = Buffer.from('small JPEG placeholder');
    await storage.put('date-photos/person/photo/thumb.jpg', body);
    assert.deepEqual(await storage.get('date-photos/person/photo/thumb.jpg'), body);
    await storage.delete('date-photos/person/photo/thumb.jpg');
    assert.equal(objects.size, 0);
    assert.deepEqual(requests.map(r => [r.method, r.path]), [
      ['PUT', '/private-date-photos/date-photos/person/photo/thumb.jpg'],
      ['GET', '/private-date-photos/date-photos/person/photo/thumb.jpg'],
      ['DELETE', '/private-date-photos/date-photos/person/photo/thumb.jpg'],
    ]);
    assert.ok(requests.every(r => r.authorized));
  } finally { server.close(); await once(server, 'close'); }
});
