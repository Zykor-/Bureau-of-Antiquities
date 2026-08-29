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

async function digestText(value) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function constantTimeTextEqual(left, right) {
  const [leftDigest, rightDigest] = await Promise.all([digestText(left), digestText(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index] ^ rightDigest[index];
  }
  return difference === 0;
}

async function hasGuildAccess(env, code) {
  const accessTable = env.AIRTABLE_ACCESS_TABLE || "Guild Access";
  const records = await listAllRecords(
    env,
    accessTable,
    ["Access Code", "Enabled"],
    "{Enabled}=1",
  );

  let matched = false;
  for (const record of records) {
    const storedCode = String(record.fields["Access Code"] || "");
    matched = (await constantTimeTextEqual(code, storedCode)) || matched;
  }
  return matched;
}

function groupAltAccounts(records, listType) {
  const groups = new Map();

  for (const record of records) {
    const recordType = String(record.fields["List Type"] || "").trim().toLowerCase();
    const isFriendly = recordType === "friendly" || recordType.includes("guild alt");
    const isHunt = recordType === "hunt" || recordType.includes("hunt target");
    if ((listType === "friendly" && !isFriendly) || (listType === "hunt" && !isHunt)) continue;

    const mainAccount = String(record.fields["Main Account"] || "").trim();
    const altAccount = String(record.fields["Alt Account"] || "").trim();
    if (!mainAccount || !altAccount) continue;

    if (!groups.has(mainAccount)) groups.set(mainAccount, new Set());
    groups.get(mainAccount).add(altAccount);
  }

  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .map(([mainAccount, altAccounts]) => ({
      mainAccount,
      altAccounts: [...altAccounts].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })),
    }));
}

async function listAltAccounts(request, env) {
  const error = ensureAirtable(env);
  if (error) return error;

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 4096) return json({ error: "Request is too large." }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Enter a valid access code." }, 400);
  }

  const code = String(body?.code || "").trim();
  if (!code || code.length > 120) return json({ error: "Enter a valid access code." }, 400);

  let authorized;
  try {
    authorized = await hasGuildAccess(env, code);
  } catch {
    return json({ error: "Unable to verify guild access right now." }, 502);
  }
  if (!authorized) return json({ error: "Invalid access code." }, 403);

  let records;
  try {
    records = await listAllRecords(
      env,
      env.AIRTABLE_ALTS_TABLE || "Alt Accounts",
      ["Alt Account", "Main Account", "List Type"],
      "{Active}=1",
    );
  } catch {
    return json({ error: "Unable to load field intelligence right now." }, 502);
  }

  return json({
    guildAlts: groupAltAccounts(records, "friendly"),
    huntTargets: groupAltAccounts(records, "hunt"),
  });
}

function recordIds(value) {
  return Array.isArray(value) ? value.filter((id) => typeof id === "string" && /^rec[A-Za-z0-9]{14}$/.test(id)) : [];
}

function parseComponentQualities(value) {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return {};
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};

  const qualities = {};
  for (const [componentId, rawQuality] of Object.entries(source).slice(0, 500)) {
    const quality = Number(rawQuality);
    if (/^rec[A-Za-z0-9]{14}$/.test(componentId) && Number.isInteger(quality) && quality >= 1 && quality <= 10) {
      qualities[componentId] = quality;
    }
  }
  return qualities;
}

function validateComponentQualities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 500) return null;

  for (const [componentId, rawQuality] of entries) {
    const quality = Number(rawQuality);
    if (!/^rec[A-Za-z0-9]{14}$/.test(componentId) || !Number.isInteger(quality) || quality < 1 || quality > 10) {
      return null;
    }
  }
  return parseComponentQualities(value);
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
  for (const field of ["Owner", "Project", "Items", "Completed", "Q10 Set", "Collected Components", "Component Qualities", "Assembled Item"]) {
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
    componentQualities: parseComponentQualities(record.fields["Component Qualities"]),
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
    "Component Qualities": "{}",
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

  if ("componentQualities" in body) {
    const componentQualities = validateComponentQualities(body.componentQualities);
    if (!componentQualities) return json({ error: "Component qualities must use whole numbers from 1 to 10." }, 400);
    fields["Component Qualities"] = JSON.stringify(componentQualities);
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
    if (url.pathname === "/api/alts" && request.method === "POST") return listAltAccounts(request, env);
    if (url.pathname === "/api/alts") return json({ error: "Method not allowed." }, 405);

    const match = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (match && request.method === "PATCH") return updateProject(request, env, match[1]);

    return env.ASSETS.fetch(request);
  },
};
