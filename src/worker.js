const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
});

function airtableHeaders(env) {
  return {
    Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function ensureAirtable(env) {
  if (!env.AIRTABLE_TOKEN) return json({ error: "Airtable token is not configured in Cloudflare." }, 500);
  if (!env.AIRTABLE_BASE_ID) return json({ error: "Airtable base ID is not configured." }, 500);
  return null;
}

function tableUrl(env, tableName, recordId = "") {
  const table = encodeURIComponent(tableName);
  const base = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${table}`;
  return recordId ? `${base}/${recordId}` : base;
}

async function airtableError(res, fallback) {
  let detail = "";
  try {
    const data = await res.json();
    detail = data?.error?.message || data?.error?.type || "";
  } catch {
    // Ignore non-JSON error bodies.
  }
  return json({ error: detail ? `${fallback} (${detail})` : fallback }, res.status);
}

async function listAllRecords(env, tableName, fields = [], filterByFormula = "") {
  const records = [];
  let offset = "";

  do {
    const url = new URL(tableUrl(env, tableName));
    url.searchParams.set("pageSize", "100");
    for (const field of fields) url.searchParams.append("fields[]", field);
    if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url, { headers: airtableHeaders(env) });
    if (!res.ok) throw new Error(`${tableName}:${res.status}`);
    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

function recordIds(value) {
  return Array.isArray(value) ? value.filter((id) => typeof id === "string" && /^rec[A-Za-z0-9]{14}$/.test(id)) : [];
}

async function buildCatalog(env) {
  const itemsTable = env.AIRTABLE_ITEMS_TABLE || "Items";
  const assembledTable = env.AIRTABLE_ASSEMBLED_TABLE || "Assembled Items";

  let itemRecords;
  let assembledRecords;
  try {
    [itemRecords, assembledRecords] = await Promise.all([
      listAllRecords(env, itemsTable, ["Name", "Rarity"], "NOT({Assembled Items}=BLANK())"),
      listAllRecords(env, assembledTable, ["Name", "Location", "Components", "Set Components"]),
    ]);
  } catch {
    throw new Error("Unable to load the Airtable item catalog.");
  }

  const itemsById = new Map(itemRecords.map((record) => [record.id, {
    id: record.id,
    name: record.fields.Name || "Unnamed item",
    rarity: record.fields.Rarity || "",
  }]));

  const assembledById = new Map(assembledRecords.map((record) => [record.id, {
    id: record.id,
    name: record.fields.Name || "Unnamed set",
    location: record.fields.Location || "",
    componentIds: recordIds(record.fields.Components),
    setComponentIds: recordIds(record.fields["Set Components"]),
  }]));

  const flatten = (assembledId, trail = new Set()) => {
    if (trail.has(assembledId)) return [];
    const assembled = assembledById.get(assembledId);
    if (!assembled) return [];

    const nextTrail = new Set(trail);
    nextTrail.add(assembledId);
    const found = new Map();

    for (const id of assembled.componentIds) {
      const item = itemsById.get(id);
      if (item) found.set(id, item);
    }

    for (const childId of assembled.setComponentIds) {
      for (const item of flatten(childId, nextTrail)) found.set(item.id, item);
    }

    return [...found.values()];
  };

  return [...assembledById.values()]
    .map((assembled) => ({
      id: assembled.id,
      name: assembled.name,
      location: assembled.location,
      components: flatten(assembled.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listCatalog(env) {
  const error = ensureAirtable(env);
  if (error) return error;

  try {
    return json(await buildCatalog(env));
  } catch (err) {
    return json({ error: err.message || "Unable to load catalog." }, 502);
  }
}

async function listProjects(env) {
  const error = ensureAirtable(env);
  if (error) return error;

  const projectsTable = env.AIRTABLE_PROJECTS_TABLE || "Projects";
  const url = new URL(tableUrl(env, projectsTable));
  url.searchParams.set("filterByFormula", "NOT({Completed})");
  url.searchParams.set("sort[0][field]", "Owner");
  url.searchParams.set("sort[0][direction]", "asc");
  for (const field of ["Owner", "Project", "Items", "Completed", "Q10 Set", "Collected Components", "Assembled Item"]) {
    url.searchParams.append("fields[]", field);
  }

  const res = await fetch(url, { headers: airtableHeaders(env) });
  if (!res.ok) return airtableError(res, "Unable to load projects.");
  const data = await res.json();

  return json((data.records || []).map((record) => ({
    id: record.id,
    owner: record.fields.Owner || "",
    title: record.fields.Project || "",
    legacyItems: record.fields.Items || "",
    q10: Boolean(record.fields["Q10 Set"]),
    assembledItemId: recordIds(record.fields["Assembled Item"])[0] || "",
    collectedComponentIds: recordIds(record.fields["Collected Components"]),
  })));
}

async function createProject(request, env) {
  const error = ensureAirtable(env);
  if (error) return error;

  const body = await request.json();
  const owner = String(body.owner || "").trim();
  const title = String(body.title || "").trim();
  const assembledItemId = String(body.assembledItemId || "").trim();

  if (!owner || !title) return json({ error: "Owner and project are required." }, 400);
  if (!/^rec[A-Za-z0-9]{14}$/.test(assembledItemId)) return json({ error: "Select a valid assembled item." }, 400);

  const fields = {
    Owner: owner,
    Project: title,
    Completed: false,
    "Q10 Set": Boolean(body.q10),
    "Assembled Item": [assembledItemId],
    "Collected Components": [],
  };

  const res = await fetch(tableUrl(env, env.AIRTABLE_PROJECTS_TABLE || "Projects"), {
    method: "POST",
    headers: airtableHeaders(env),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) return airtableError(res, "Unable to create project.");
  return json(await res.json(), 201);
}

async function updateProject(request, env, id) {
  const error = ensureAirtable(env);
  if (error) return error;
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return json({ error: "Invalid project ID." }, 400);

  const body = await request.json();
  const fields = {};

  if ("owner" in body) fields.Owner = String(body.owner || "").trim();
  if ("title" in body) fields.Project = String(body.title || "").trim();
  if ("q10" in body) fields["Q10 Set"] = Boolean(body.q10);
  if ("completed" in body) fields.Completed = Boolean(body.completed);

  if ("assembledItemId" in body) {
    const assembledItemId = String(body.assembledItemId || "").trim();
    if (!/^rec[A-Za-z0-9]{14}$/.test(assembledItemId)) return json({ error: "Select a valid assembled item." }, 400);
    fields["Assembled Item"] = [assembledItemId];
  }

  if ("collectedComponentIds" in body) {
    if (!Array.isArray(body.collectedComponentIds)) return json({ error: "Collected components must be a list." }, 400);
    fields["Collected Components"] = recordIds(body.collectedComponentIds);
  }

  const res = await fetch(tableUrl(env, env.AIRTABLE_PROJECTS_TABLE || "Projects", id), {
    method: "PATCH",
    headers: airtableHeaders(env),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) return airtableError(res, "Unable to update project.");
  return json(await res.json());
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/catalog" && request.method === "GET") return listCatalog(env);
    if (url.pathname === "/api/projects" && request.method === "GET") return listProjects(env);
    if (url.pathname === "/api/projects" && request.method === "POST") return createProject(request, env);

    const match = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (match && request.method === "PATCH") return updateProject(request, env, match[1]);

    return env.ASSETS.fetch(request);
  },
};
