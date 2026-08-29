import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/worker.js";

const env = {
  AIRTABLE_TOKEN: "test-token",
  AIRTABLE_BASE_ID: "appTestBase",
  AIRTABLE_ACCESS_TABLE: "Guild Access",
  AIRTABLE_ALTS_TABLE: "Alt Accounts",
  ASSETS: { fetch: () => new Response("asset") },
};

function apiRequest(code) {
  return new Request("https://example.test/api/alts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

function installAirtableMock() {
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requests.push(url);
    const table = decodeURIComponent(url.pathname.split("/").at(-1));

    if (table === "Guild Access") {
      return Response.json({
        records: [
          { id: "recAccessOne0001", fields: { "Access Code": "ExactCase", Enabled: true } },
          { id: "recAccessTwo0002", fields: { "Access Code": "AnotherCode", Enabled: true } },
        ],
      });
    }

    if (table === "Alt Accounts") {
      return Response.json({
        records: [
          { id: "recAltOne0000001", fields: { "Alt Account": "Sidekick", "Main Account": "GuildMain", "List Type": "Guild Alt — Do Not Attack" } },
          { id: "recAltTwo0000002", fields: { "Alt Account": "TargetB", "Main Account": "WatchMain", "List Type": "Hunt Target — Non-Guild" } },
          { id: "recAltThree00003", fields: { "Alt Account": "TargetA", "Main Account": "WatchMain", "List Type": "Hunt Target — Non-Guild" } },
        ],
      });
    }

    return new Response("Not found", { status: 404 });
  };
  return requests;
}

test("rejects an invalid or incorrectly cased code without loading alt accounts", async () => {
  for (const code of ["wrong", "exactcase"]) {
    const requests = installAirtableMock();
    const response = await worker.fetch(apiRequest(code), env);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Invalid access code." });
    assert.equal(requests.length, 1);
    assert.match(decodeURIComponent(requests[0].pathname), /Guild Access$/);
  }
});

test("accepts trimmed exact-case access and returns only grouped intelligence", async () => {
  const requests = installAirtableMock();
  const response = await worker.fetch(apiRequest("  ExactCase  "), env);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(data, {
    guildAlts: [{ mainAccount: "GuildMain", altAccounts: ["Sidekick"] }],
    huntTargets: [{ mainAccount: "WatchMain", altAccounts: ["TargetA", "TargetB"] }],
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get("filterByFormula"), "{Enabled}=1");
  assert.equal(requests[1].searchParams.get("filterByFormula"), "{Active}=1");
  assert.doesNotMatch(JSON.stringify(data), /ExactCase|AnotherCode|Enabled/);
});

test("requires POST for the protected endpoint", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/alts"), env);
  assert.equal(response.status, 405);
});
