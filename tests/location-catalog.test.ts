import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocationCatalog } from '../server/location-catalog.ts';

test('external location catalog requires unique IDs and valid country parents', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/locations.json', import.meta.url));
  const locations = await loadLocationCatalog(fixture);
  assert.equal(locations.length, 7);
  assert.equal(locations.find(location => location.id === 'city:294801')?.parentId, 'country:IL');

  const directory = await mkdtemp(join(tmpdir(), 'questr-locations-'));
  const path = join(directory, 'locations.json');
  try {
    await assert.rejects(loadLocationCatalog(path), /Cannot read location catalog/);
    await writeFile(path, JSON.stringify([...locations, locations[0]]));
    await assert.rejects(loadLocationCatalog(path), /Duplicate location ID/);
    await writeFile(path, JSON.stringify(locations.filter(location => location.id !== 'country:IL')));
    await assert.rejects(loadLocationCatalog(path), /Invalid city .* or parent/);
    await writeFile(path, '{broken');
    await assert.rejects(loadLocationCatalog(path), /Cannot read location catalog/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
