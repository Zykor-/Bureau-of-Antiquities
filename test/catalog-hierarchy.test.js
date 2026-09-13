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
        { id: childSet, fields: {
          Name: "Mashed Potatoes",
          Components: [itemA, itemB],
          Difficulty: 3.125,
          "Q5 Attack": 40,
          "Q5 Defense": 50,
        } },
        { id: parentSet, fields: {
          Name: "Delicious Meal",
          Components: [itemC],
          "Set Components": [childSet],
          Difficulty: 6.64,
          "Q5 Attack": 95,
          "Q5 Defense": 101,
          "Q10 Attack": 245,
          "Q10 Defense": 245,
        } },
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
  assert.equal(meal.difficulty, 6.64);
  assert.equal(meal.q5Attack, 95);
  assert.equal(meal.q5Defense, 101);
  assert.equal(meal.q10Attack, 245);
  assert.equal(meal.q10Defense, 245);
  assert.equal(meal.components[1].difficulty, 3.125);
});

