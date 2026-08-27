const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

function airtableHeaders(env) {
  return {
    Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function tableUrl(env, recordId = "") {
  const table = encodeURIComponent(env.AIRTABLE_PROJECTS_TABLE || "Projects");
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

async function listProjects(env) {
  if (!env.AIRTABLE_TOKEN) return json({ error: "Airtable token is not configured in Cloudflare." }, 500);
  if (!env.AIRTABLE_BASE_ID) return json({ error: "Airtable base ID is not configured." }, 500);

  const url = new URL(tableUrl(env));
  url.searchParams.set("filterByFormula", "NOT({Completed})");
  url.searchParams.set("sort[0][field]", "Owner");
  url.searchParams.set("sort[0][direction]", "asc");
  const res = await fetch(url, { headers: airtableHeaders(env) });
  if (!res.ok) return airtableError(res, "Unable to load projects.");
  const data = await res.json();
  return json(data.records.map((record) => ({
    id: record.id,
    owner: record.fields.Owner || "",
    title: record.fields.Project || "",
    items: record.fields.Items || "",
  })));
}

async function createProject(request, env) {
  if (!env.AIRTABLE_TOKEN) return json({ error: "Airtable token is not configured in Cloudflare." }, 500);
  if (!env.AIRTABLE_BASE_ID) return json({ error: "Airtable base ID is not configured." }, 500);

  const body = await request.json();
  const fields = {
    Owner: String(body.owner || "").trim(),
    Project: String(body.title || "").trim(),
    Items: String(body.items || "").trim(),
    Completed: false,
  };
  if (!fields.Owner || !fields.Project) return json({ error: "Owner and project are required." }, 400);
  const res = await fetch(tableUrl(env), {
    method: "POST",
    headers: airtableHeaders(env),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) return airtableError(res, "Unable to create project.");
  return json(await res.json(), 201);
}

async function updateProject(request, env, id) {
  if (!env.AIRTABLE_TOKEN) return json({ error: "Airtable token is not configured in Cloudflare." }, 500);
  if (!env.AIRTABLE_BASE_ID) return json({ error: "Airtable base ID is not configured." }, 500);

  const body = await request.json();
  const fields = {};
  if ("owner" in body) fields.Owner = String(body.owner || "").trim();
  if ("title" in body) fields.Project = String(body.title || "").trim();
  if ("items" in body) fields.Items = String(body.items || "").trim();
  if ("completed" in body) fields.Completed = Boolean(body.completed);
  const res = await fetch(tableUrl(env, id), {
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
    if (url.pathname === "/api/projects" && request.method === "GET") return listProjects(env);
    if (url.pathname === "/api/projects" && request.method === "POST") return createProject(request, env);
    const match = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (match && request.method === "PATCH") return updateProject(request, env, match[1]);
    return env.ASSETS.fetch(request);
  },
};
