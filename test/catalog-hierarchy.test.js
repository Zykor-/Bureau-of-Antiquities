import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/worker.js";

const itemA = "recITEMAAAAAAAAAA";
const itemB = "recITEMBBBBBBBBBB";
const itemC = "recITEMCCCCCCCCCC";
const childSet = "recSETCHILDABCDEF";
const parentSet = "recSETPARENTABCDE";

const env = {
  AIRTABLE_TOKEN: "test-token",
  AIRTABLE_BASE_ID: "appTestBase",
  AIRTABLE_ITEMS_TABLE: "Items",
  AIRTABLE_ASSEMBLED_TABLE: "Assembled Items",
  ASSETS: { fetch: () => new Response("asset") },
};

test("catalog preserves assembled subsets instead of flattening their items into the parent", async () => {
  globalThis.fetch = async (input) => {
    const table = decodeURIComponent(new URL(input).pathname.split("/").at(-1));

    if (table === "Items") {
      return Response.json({ records: [
        { id: itemA, fields: { Name: "Potato", Rarity: "Common" } },
        { id: itemB, fields: { Name: "Peeler", Rarity: "Uncommon" } },
        { id: itemC, fields: { Name: "Steak", Rarity: "Rare" } },
      ] });
    }

    if (table === "Assembled Items") {
      return Response.json({ records: [
        { id: childSet, fields: { Name: "Mashed Potatoes", Components: [itemA, itemB] } },
        { id: parentSet, fields: { Name: "Delicious Meal", Components: [itemC], "Set Components": [childSet] } },
      ] });
    }

    return new Response("Not found", { status: 404 });
  };

  const response = await worker.fetch(new Request("https://example.test/api/catalog"), env);
  const catalog = await response.json();
  const meal = catalog.find((entry) => entry.id === parentSet);

  assert.equal(response.status, 200);
  assert.equal(meal.components.length, 2);
  assert.deepEqual(meal.components.map((component) => component.name), ["Steak", "Mashed Potatoes"]);
  assert.equal(meal.components[1].type, "set");
  assert.deepEqual(meal.components[1].components.map((component) => component.name), ["Potato", "Peeler"]);
});
