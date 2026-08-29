import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/worker.js";

const componentA = "recABCDEFGHIJKLMN";
const componentB = "recNOPQRSTUVWXYZA";
const projectId = "recPROJECTQUALITY";

const env = {
  AIRTABLE_TOKEN: "test-token",
  AIRTABLE_BASE_ID: "appTestBase",
  AIRTABLE_PROJECTS_TABLE: "Projects",
  ASSETS: { fetch: () => new Response("asset") },
};

test("loads only valid saved component qualities", async () => {
  globalThis.fetch = async () => Response.json({
    records: [{
      id: projectId,
      fields: {
        Owner: "Tester",
        Project: "Quality Set",
        "Q10 Set": true,
        "Collected Components": [componentA, componentB],
        "Component Qualities": JSON.stringify({
          [componentA]: 10,
          [componentB]: 9,
          bad: 7,
        }),
      },
    }],
  });

  const response = await worker.fetch(new Request("https://example.test/api/projects"), env);
  const projects = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(projects[0].componentQualities, {
    [componentA]: 10,
    [componentB]: 9,
  });
});

test("saves collected component IDs and their Q1-Q10 values together", async () => {
  let writtenFields;
  globalThis.fetch = async (_input, options) => {
    writtenFields = JSON.parse(options.body).fields;
    return Response.json({ id: projectId, fields: writtenFields });
  };

  const response = await worker.fetch(new Request(`https://example.test/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      collectedComponentIds: [componentA, componentB],
      componentQualities: { [componentA]: 10, [componentB]: 9 },
    }),
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(writtenFields["Collected Components"], [componentA, componentB]);
  assert.equal(writtenFields["Component Qualities"], JSON.stringify({
    [componentA]: 10,
    [componentB]: 9,
  }));
});

test("rejects qualities outside Q1-Q10", async () => {
  let airtableCalled = false;
  globalThis.fetch = async () => {
    airtableCalled = true;
    return Response.json({});
  };

  const response = await worker.fetch(new Request(`https://example.test/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ componentQualities: { [componentA]: 11 } }),
  }), env);

  assert.equal(response.status, 400);
  assert.equal(airtableCalled, false);
});
