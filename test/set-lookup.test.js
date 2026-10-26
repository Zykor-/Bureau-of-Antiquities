import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSetSearch, findProjectSet } from '../public/set-lookup.js';
import worker from '../src/worker.js';
const set = { id: 'recABCDEFGHIJKLMN', name: "Reflections' End" };
const catalog = [set];
const byId = new Map(catalog.map(item => [item.id, item]));
const variants = ["Reflections' End", "Reflection's End", 'Reflections’ End', 'Reflection’s End', 'reflections end', '  REFLECTIONS’   END '];
test('all reported spellings match one canonical set without adding records', () => {
  for (const title of variants) {
    assert.equal(normalizeSetSearch(title), 'reflections end');
    assert.equal(catalog.filter(item => normalizeSetSearch(item.name).includes(normalizeSetSearch(title))).length, 1);
    assert.equal(findProjectSet({ title }, catalog, byId), set);
  }
});
test('record IDs win over names; missing explicit links and ambiguous names are not guessed', () => {
  assert.equal(findProjectSet({ assembledItemId: set.id, title: 'Different title' }, catalog, byId), set);
  assert.equal(findProjectSet({ assembledItemId: 'recMissing', title: set.name }, catalog, byId), undefined);
  assert.equal(findProjectSet({ title: set.name }, [...catalog, { id: 'other', name: "Reflection's End" }], byId), undefined);
  assert.equal(findProjectSet({ title: '' }, catalog, byId), undefined);
});
test('project creation writes the selected record ID regardless of title spelling', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, options) => {
    const { fields } = JSON.parse(options.body);
    assert.deepEqual(fields['Assembled Item'], [set.id]);
    assert.equal(fields.Project, 'Reflections’ End');
    return Response.json({ id: 'recProjectFixture', fields });
  };
  const response = await worker.fetch(new Request('https://test/api/projects', {
    method: 'POST', body: JSON.stringify({ owner: 'Test', title: 'Reflections’ End', assembledItemId: set.id }),
  }), { AIRTABLE_TOKEN: 'test', AIRTABLE_BASE_ID: 'appTest' });
  assert.equal(response.status, 201);
});
