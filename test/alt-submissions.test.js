import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/worker.js";

const env = {
  AIRTABLE_TOKEN: "private-token",
  AIRTABLE_BASE_ID: "appTestBase",
  ASSETS: { fetch: () => new Response("asset") },
};
const fields = (main, alt, active = true) => ({ fields: {
  "Main Account": main, "Alt Account": alt, Active: active,
} });
const payload = (overrides = {}) => ({
  code: "ExactCase", mode: "new", mainAccount: "NewMain",
  altAccounts: ["NewAlt"], listType: "friendly", ...overrides,
});
function request(body = payload(), options = {}) {
  return new Request("https://example.test/api/alts/submit", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), ...options,
  });
}
function mockAirtable(t, { records = [], enabled = true, failRead = false, failWrite = false, failAccess = false } = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(input);
    const table = decodeURIComponent(url.pathname.split("/").at(-1));
    calls.push({ url, table, ...options });
    if (table === "Guild Access") {
      assert.equal(url.searchParams.get("filterByFormula"), "{Enabled}=1");
      if (failAccess) throw new Error("private access failure");
      return Response.json({ records: enabled ? [{ fields: { "Access Code": "ExactCase", Enabled: true } }] : [] });
    }
    assert.equal(table, "Alt Accounts");
    if (options.method === "POST") {
      if (failWrite) return Response.json({ error: { message: "private-token or Guild Access data" } }, { status: 403 });
      const added = JSON.parse(options.body).records;
      records.push(...added);
      return Response.json({ records: added });
    }
    assert.equal(url.searchParams.has("filterByFormula"), false, "deduplication includes inactive records");
    if (failRead) throw new Error("private read failure");
    // Exercise pagination; a duplicate on page two must still be found.
    return Response.json(url.searchParams.has("offset")
      ? { records: records.slice(1) }
      : { records: records.slice(0, 1), ...(records.length > 1 ? { offset: "page-two" } : {}) });
  });
  return calls;
}

test("writes require an enabled, exact-case access code before any alt lookup", async (t) => {
  const calls = mockAirtable(t);
  for (const code of ["wrong", "exactcase"]) {
    const response = await worker.fetch(request(payload({ code })), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.ok(calls.every((call) => call.table === "Guild Access"));
});

test("a revoked code cannot write even after it previously unlocked the archive", async (t) => {
  const calls = mockAirtable(t, { enabled: false });
  assert.equal((await worker.fetch(request(), env)).status, 403);
  assert.equal(calls.length, 1);
});

test("validates malformed, missing and oversized bodies before contacting Airtable", async (t) => {
  const calls = mockAirtable(t);
  for (const body of [null, {}, { code: 123 }, { code: " " }]) {
    assert.equal((await worker.fetch(request(body), env)).status, 400);
  }
  assert.equal((await worker.fetch(request(null, { body: "{" }), env)).status, 400);
  assert.equal((await worker.fetch(request(payload({ notes: "a".repeat(17000) })), env)).status, 413);
  assert.equal(calls.length, 0);
});

test("rejects invalid fields and self-alts without reading or writing accounts", async (t) => {
  const calls = mockAirtable(t);
  for (const overrides of [
    { mode: "edit" }, { mainAccount: {} }, { mainAccount: " " },
    { mainAccount: "a".repeat(121) }, { mainAccount: "bad\nname" },
    { altAccounts: [] }, { altAccounts: "one" }, { altAccounts: [123] },
    { altAccounts: [" "] }, { altAccounts: ["one,two"] },
    { altAccounts: ["a".repeat(121)] }, { altAccounts: Array(11).fill("Alt") },
    { altAccounts: [" newMAIN "] }, { listType: "__proto__" },
    { notes: {} }, { notes: "a".repeat(2001) },
  ]) assert.equal((await worker.fetch(request(payload(overrides)), env)).status, 400);
  assert.ok(calls.every((call) => call.table === "Guild Access"));
});

test("creates one row per alt using the existing schema and returns only counts", async (t) => {
  const calls = mockAirtable(t);
  const response = await worker.fetch(request(payload({
    code: " ExactCase ", mainAccount: " NewMain ", altAccounts: [" First ", "Second"],
    listType: "hunt", notes: " Reported by a guildmate ",
    fields: { Enabled: true, "Access Code": "injection" },
  })), env);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { created: 2, skipped: 0, inactiveSkipped: 0 });
  const writes = calls.filter((call) => call.method === "POST");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].headers.Authorization, "Bearer private-token");
  assert.deepEqual(JSON.parse(writes[0].body), { records: ["First", "Second"].map((alt) => ({ fields: {
    "Main Account": "NewMain", "Alt Account": alt, "List Type": "Hunt Target — Non-Guild",
    Active: true, Notes: "Reported by a guildmate",
  } })) });
});

test("existing mains retain spelling; duplicates include all pages, inactive pairs and the input batch", async (t) => {
  const records = [fields("GuildMain", "First"), fields("GuildMain", "Hidden", false)];
  const calls = mockAirtable(t, { records });
  const response = await worker.fetch(request(payload({
    mode: "existing", mainAccount: " guildMAIN ", altAccounts: ["first", "HIDDEN", "Third", " third "],
  })), env);
  assert.deepEqual(await response.json(), { created: 1, skipped: 3, inactiveSkipped: 1 });
  const added = JSON.parse(calls.find((call) => call.method === "POST").body).records;
  assert.equal(added[0].fields["Main Account"], "GuildMain");
  assert.equal(added[0].fields["List Type"], "Guild Alt — Do Not Attack");
  assert.equal(records[1].fields.Active, false);
  assert.equal(records[1].fields.Notes, undefined);
});

test("new mode recognizes known names and retries skip already saved pairs", async (t) => {
  const records = [fields("GuildMain", "First")];
  const calls = mockAirtable(t, { records });
  const body = payload({ mainAccount: "guildmain", altAccounts: ["First", "Second"] });
  assert.equal((await worker.fetch(request(body), env)).status, 201);
  const retry = await worker.fetch(request(body), env);
  assert.deepEqual(await retry.json(), { created: 0, skipped: 2, inactiveSkipped: 0 });
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(records[1].fields["Main Account"], "GuildMain");
});

test("an alt linked to another main does not incorrectly block a new pair", async (t) => {
  mockAirtable(t, { records: [fields("OtherMain", "NewAlt")] });
  assert.equal((await worker.fetch(request(), env)).status, 201);
});

test("missing existing mains are rejected without writes", async (t) => {
  const calls = mockAirtable(t);
  assert.equal((await worker.fetch(request(payload({ mode: "existing" })), env)).status, 409);
  assert.ok(calls.every((call) => call.method !== "POST"));
});

test("access and duplicate lookup failures fail closed", async (t) => {
  for (const option of ["failRead", "failAccess"]) {
    await t.test(option, async (t) => {
      const calls = mockAirtable(t, { [option]: true });
      const response = await worker.fetch(request(), env);
      assert.equal(response.status, 502);
      assert.doesNotMatch(await response.text(), /private/);
      assert.ok(calls.every((call) => call.method !== "POST"));
    });
  }
});

test("upstream write errors do not leak secrets or private data", async (t) => {
  mockAirtable(t, { failWrite: true });
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private-token|Guild Access|ExactCase/);
});

test("submission route rejects non-POST methods", async () => {
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await worker.fetch(new Request("https://example.test/api/alts/submit", { method }), env);
    assert.equal(response.status, 405);
  }
});
