import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/worker.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('completed subset badges do not steal the completion button handler', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('const completeButton =');
  const end = source.indexOf('projectsEl.appendChild(node);', start);
  assert.ok(start >= 0 && end > start);
  const badge = { addEventListener() { assert.fail('Handler attached to subset badge'); } };
  const handlers = {};
  const button = { addEventListener(event, handler) { handlers[event] = handler; } };
  const node = { querySelector(selector) {
    // A completed nested-set-result precedes the action button in each affected card.
    if (selector === '.complete') return badge;
    assert.equal(selector, 'button.complete');
    return button;
  } };
  vm.runInNewContext(source.slice(start, end), { node });
  assert.equal(typeof handlers.click, 'function');
});

test('completion archives only the project and active queries exclude it', async (t) => {
  const id = 'recABCDEFGHIJKLMN';
  const fields = { Owner: 'Tester', Project: 'Nested set', Completed: false,
    'Assembled Item': ['recNOPQRSTUVWXYZA'], 'Collected Components': ['recZYXWVUTSRQPONM'],
    'Component Qualities': '{"recZYXWVUTSRQPONM":10}', 'Q10 Set': true };
  const original = structuredClone(fields);
  const calls = [];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    calls.push(options.method || 'GET');
    if (options.method === 'PATCH') {
      assert.ok(url.pathname.endsWith('/Projects/' + id));
      const update = JSON.parse(options.body).fields;
      assert.deepEqual(update, { Completed: true });
      Object.assign(fields, update);
      return Response.json({ id, fields });
    }
    assert.equal(url.searchParams.get('filterByFormula'), 'NOT({Completed})');
    return Response.json({ records: fields.Completed ? [] : [{ id, fields }] });
  };
  const env = { AIRTABLE_TOKEN: 'test', AIRTABLE_BASE_ID: 'appTest', AIRTABLE_PROJECTS_TABLE: 'Projects' };
  const before = await worker.fetch(new Request('https://test/api/projects'), env);
  assert.equal((await before.json()).length, 1);
  const saved = await worker.fetch(new Request('https://test/api/projects/' + id, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completed: true }),
  }), env);
  assert.equal(saved.status, 200);
  assert.deepEqual(fields, { ...original, Completed: true });
  const after = await worker.fetch(new Request('https://test/api/projects'), env);
  assert.deepEqual(await after.json(), []);
  assert.deepEqual(calls, ['GET', 'PATCH', 'GET']);
});