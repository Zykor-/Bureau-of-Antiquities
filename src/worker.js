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

async function authorizeIntelligence(request, env, maxBytes = 4096) {
  const error = ensureAirtable(env);
  if (error) return { error };

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) return { error: json({ error: "Request is too large." }, 413) };

  let body;
  try {
    // Bound the actual stream as well: Content-Length can be absent or inaccurate.
    const reader = request.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            return { error: json({ error: "Request is too large." }, 413) };
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    body = JSON.parse(await new Blob(chunks).text());
  } catch {
    return { error: json({ error: "Enter a valid access code." }, 400) };
  }

  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code || code.length > 120) return { error: json({ error: "Enter a valid access code." }, 400) };

  let authorized;
  try {
    authorized = await hasGuildAccess(env, code);
  } catch {
    return { error: json({ error: "Unable to verify guild access right now." }, 502) };
  }
  if (!authorized) return { error: json({ error: "Invalid access code." }, 403) };
  return { body };
}

async function listAltAccounts(request, env) {
  const { error } = await authorizeIntelligence(request, env);
  if (error) return error;

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

const altListTypes = new Map([
  ["friendly", "Guild Alt — Do Not Attack"],
  ["hunt", "Hunt Target — Non-Guild"],
]);
const accountKey = (value) => String(value || "").trim().toLowerCase();
const validUsername = (value) => typeof value === "string"
  && value.trim().length > 0 && value.trim().length <= 120
  && !/[\u0000-\u001f\u007f,]/.test(value);

async function submitAltAccounts(request, env) {
  const { body, error } = await authorizeIntelligence(request, env, 16384);
  if (error) return error;

  if (!["existing", "new"].includes(body.mode)) return json({ error: "Choose an existing or new main account." }, 400);
  if (!validUsername(body.mainAccount)) return json({ error: "Enter a main username of 1–120 characters." }, 400);
  if (!Array.isArray(body.altAccounts) || !body.altAccounts.length || body.altAccounts.length > 10
      || !body.altAccounts.every(validUsername)) {
    return json({ error: "Enter 1–10 alt usernames, each 1–120 characters, separated by commas or new lines." }, 400);
  }
  if (!altListTypes.has(body.listType)) return json({ error: "Choose Guild Alts or Hunt Targets." }, 400);
  if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 2000)) {
    return json({ error: "Notes must be 2,000 characters or fewer." }, 400);
  }
  const mainKey = accountKey(body.mainAccount);
  if (body.altAccounts.some((alt) => accountKey(alt) === mainKey)) {
    return json({ error: "An alt username must differ from the main username." }, 400);
  }

  const table = env.AIRTABLE_ALTS_TABLE || "Alt Accounts";
  let records;
  try {
    // Include inactive records so hidden pairs are not recreated or reactivated.
    records = await listAllRecords(env, table, ["Main Account", "Alt Account", "Active"]);
  } catch {
    return json({ error: "Unable to check existing accounts. Nothing was saved; please try again." }, 502);
  }
  const mainRecords = records.filter((record) => accountKey(record.fields["Main Account"]) === mainKey);
  if (body.mode === "existing" && !mainRecords.length) {
    return json({ error: "That main account is no longer known. Choose New main account to add it." }, 409);
  }
  const mainAccount = mainRecords.length
    ? String(mainRecords[0].fields["Main Account"]).trim() : body.mainAccount.trim();
  const existing = new Set(mainRecords.map((record) => accountKey(record.fields["Alt Account"])));
  const inactive = new Set(mainRecords.filter((record) => !record.fields.Active)
    .map((record) => accountKey(record.fields["Alt Account"])));
  const uniqueAlts = [...new Map(body.altAccounts.map((alt) => [accountKey(alt), alt.trim()])).values()];
  const additions = uniqueAlts.filter((alt) => !existing.has(accountKey(alt)));
  const result = {
    created: additions.length,
    skipped: body.altAccounts.length - additions.length,
    inactiveSkipped: uniqueAlts.filter((alt) => inactive.has(accountKey(alt))).length,
  };
  if (!additions.length) return json(result);

  try {
    const res = await fetch(tableUrl(env, table), {
      method: "POST",
      headers: airtableHeaders(env),
      body: JSON.stringify({ records: additions.map((alt) => ({ fields: {
        "Main Account": mainAccount,
        "Alt Account": alt,
        "List Type": altListTypes.get(body.listType),
        Active: true,
        ...(body.notes?.trim() ? { Notes: body.notes.trim() } : {}),
      } })) }),
    });
    if (!res.ok) return json({ error: "Unable to save intelligence. Please try again; existing pairs will be skipped." }, 502);
    // Return only counts, never Airtable records, access data, or upstream errors.
    return json(result, 201);
  } catch {
    return json({ error: "Could not confirm the save. Please retry; existing pairs will be skipped." }, 502);
  }
}

function recordIds(value) {
  return Array.isArray(value) ? value.filter((id) => typeof id === "string" && /^rec[A-Za-z0-9]{14}$/.test(id)) : [];
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
      listAllRecords(env, assembledTable, [
        "Name",
        "Location",
        "Components",
        "Set Components",
        "Difficulty",
        "Q5 Attack",
        "Q5 Defense",
        "Q10 Attack",
        "Q10 Defense",
      ]),
    ]);
  } catch {
    throw new Error("Unable to load the Airtable item catalog.");
  }

  const itemsById = new Map(itemRecords.map((record) => [record.id, {
    id: record.id,
    name: record.fields.Name || "Unnamed item",
    rarity: record.fields.Rarity || "",
    type: "item",
  }]));

  const assembledById = new Map(assembledRecords.map((record) => [record.id, {
    id: record.id,
    name: record.fields.Name || "Unnamed set",
    location: record.fields.Location || "",
    difficulty: optionalNumber(record.fields.Difficulty),
    q5Attack: optionalNumber(record.fields["Q5 Attack"]),
    q5Defense: optionalNumber(record.fields["Q5 Defense"]),
    q10Attack: optionalNumber(record.fields["Q10 Attack"]),
    q10Defense: optionalNumber(record.fields["Q10 Defense"]),
    componentIds: recordIds(record.fields.Components),
    setComponentIds: recordIds(record.fields["Set Components"]),
  }]));

  const buildAssembled = (assembledId, trail = new Set()) => {
    const assembled = assembledById.get(assembledId);
    if (!assembled) return null;
    if (trail.has(assembledId)) {
      return {
        id: assembled.id,
        name: assembled.name,
        location: assembled.location,
        difficulty: assembled.difficulty,
        q5Attack: assembled.q5Attack,
        q5Defense: assembled.q5Defense,
        q10Attack: assembled.q10Attack,
        q10Defense: assembled.q10Defense,
        rarity: "Assembled",
        type: "set",
        cycle: true,
        components: [],
      };
    }

    const nextTrail = new Set(trail);
    nextTrail.add(assembledId);
    const itemComponents = assembled.componentIds.map((id) => itemsById.get(id)).filter(Boolean);
    const setComponents = assembled.setComponentIds
      .map((id) => buildAssembled(id, nextTrail))
      .filter(Boolean);

    return {
      id: assembled.id,
      name: assembled.name,
      location: assembled.location,
      difficulty: assembled.difficulty,
      q5Attack: assembled.q5Attack,
      q5Defense: assembled.q5Defense,
      q10Attack: assembled.q10Attack,
      q10Defense: assembled.q10Defense,
      rarity: "Assembled",
      type: "set",
      components: [...itemComponents, ...setComponents],
    };
  };

  return [...assembledById.values()]
    .map((assembled) => buildAssembled(assembled.id))
    .filter(Boolean)
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
    if (url.pathname === "/api/alts/submit" && request.method === "POST") return submitAltAccounts(request, env);
    if (url.pathname === "/api/alts/submit") return json({ error: "Method not allowed." }, 405);

    const match = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (match && request.method === "PATCH") return updateProject(request, env, match[1]);

    return env.ASSETS.fetch(request);
  },
};

