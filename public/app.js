import {
  calculateSetRequirements,
  collectLeafComponents,
  evaluateComponent,
} from "./q10-math.js";
import { formatSetStats } from "./set-stats.js";

const $ = (selector) => document.querySelector(selector);

const projectsEl = $("#projects");
const emptyEl = $("#empty");
const noticeEl = $("#notice");
const dialog = $("#projectDialog");
const form = $("#projectForm");
const template = $("#projectTemplate");
const setSearch = $("#setSearch");
const setId = $("#setId");
const setDropdown = $("#setDropdown");
const setCombo = $("#setCombo");
const componentPreview = $("#componentPreview");
const previewItems = $("#previewItems");
const projectsView = $("#projects-board");
const intelligenceView = $("#field-intelligence");
const accessForm = $("#altAccessForm");
const accessCode = $("#accessCode");
const accessMessage = $("#accessMessage");
const intelligenceLocked = $("#intelligenceLocked");
const intelligenceUnlocked = $("#intelligenceUnlocked");
const altSubmissionForm = $("#altSubmissionForm");
const altSubmissionMessage = $("#altSubmissionMessage");
let intelligenceCode = "";
let intelligenceGeneration = 0;
let knownMainTypes = new Map();

let projects = [];
let catalog = [];
let catalogById = new Map();
let editingProject = null;
let comboResults = [];
let comboIndex = -1;
let noticeTimer = null;
const saveQueues = new Map();

function setView(view) {
  const showIntelligence = view === "intelligence";
  if (!showIntelligence) lockIntelligence();
  projectsView.classList.toggle("hidden", showIntelligence);
  intelligenceView.classList.toggle("hidden", !showIntelligence);
  $("#openAdd").classList.toggle("hidden", showIntelligence);

  for (const link of document.querySelectorAll("[data-view-target]")) {
    const active = link.dataset.viewTarget === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function syncViewFromHash() {
  setView(window.location.hash === "#field-intelligence" ? "intelligence" : "projects");
}

function renderAccountGroups(container, groups, emptyMessage) {
  container.innerHTML = "";

  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "account-empty";
    empty.textContent = emptyMessage;
    container.appendChild(empty);
    return;
  }

  for (const group of groups) {
    const row = document.createElement("section");
    row.className = "account-group";

    const main = document.createElement("h4");
    main.textContent = group.mainAccount;

    const alts = document.createElement("div");
    alts.className = "alt-chips";
    for (const account of group.altAccounts) {
      const chip = document.createElement("span");
      chip.className = "alt-chip";
      chip.textContent = account;
      alts.appendChild(chip);
    }

    row.append(main, alts);
    container.appendChild(row);
  }
}

function lockIntelligence() {
  intelligenceGeneration += 1;
  intelligenceCode = "";
  knownMainTypes.clear();
  altSubmissionForm.reset();
  $("#altKnownMain").replaceChildren(new Option("Select a main account…", ""));
  $("#altEntry").open = false;
  $("#altSubmissionFields").disabled = false;
  $("#submitAltIntelligence").textContent = "Save Intelligence";
  altSubmissionMessage.textContent = "";
  altSubmissionMessage.classList.remove("error");
  syncAltMainMode();
  accessCode.value = "";
  accessMessage.textContent = "";
  accessMessage.classList.remove("error");
  $("#guildAlts").replaceChildren();
  $("#huntTargets").replaceChildren();
  intelligenceUnlocked.classList.add("hidden");
  intelligenceLocked.classList.remove("hidden");
}

function syncAltMainMode() {
  const isNew = $("#altMainMode").value === "new";
  $("#knownMainLabel").classList.toggle("hidden", isNew);
  $("#newMainLabel").classList.toggle("hidden", !isNew);
  $("#altKnownMain").disabled = isNew;
  $("#altKnownMain").required = !isNew;
  $("#altNewMain").disabled = !isNew;
  $("#altNewMain").required = isNew;
}

function renderIntelligence(data) {
  renderAccountGroups($("#guildAlts"), data.guildAlts || [], "No friendly alternate accounts are active.");
  renderAccountGroups($("#huntTargets"), data.huntTargets || [], "No hunt targets are active.");
  const selection = $("#altKnownMain").value;
  knownMainTypes.clear();
  for (const [type, groups] of [["friendly", data.guildAlts || []], ["hunt", data.huntTargets || []]]) {
    for (const { mainAccount } of groups) {
      const key = mainAccount.toLowerCase();
      const known = knownMainTypes.get(key);
      if (known) known.types.add(type);
      else knownMainTypes.set(key, { name: mainAccount, types: new Set([type]) });
    }
  }
  const options = [...knownMainTypes.values()]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .map(({ name }) => new Option(name, name));
  $("#altKnownMain").replaceChildren(new Option("Select a main account…", ""), ...options);
  $("#altKnownMain").value = selection;
  if (!options.length) $("#altMainMode").value = "new";
  syncAltMainMode();
}

function showNotice(message, error = false) {
  window.clearTimeout(noticeTimer);
  noticeEl.textContent = message;
  noticeEl.classList.remove("hidden", "error");
  if (error) noticeEl.classList.add("error");
  noticeTimer = window.setTimeout(() => noticeEl.classList.add("hidden"), 4200);
}

function itemLines(value) {
  return String(value || "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function rarityClass(rarity) {
  return `rarity-${String(rarity || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

function projectAssembled(project) {
  const assembled = catalogById.get(project.assembledItemId);
  if (assembled) return assembled;
  return {
    id: "",
    name: project.title,
    type: "set",
    components: itemLines(project.legacyItems).map((name) => ({ id: "", name, rarity: "", type: "item" })),
  };
}

function projectComponents(project) {
  return projectAssembled(project).components || [];
}

function projectLeafComponents(project) {
  return collectLeafComponents(projectAssembled(project));
}

function componentNames(component) {
  return [component.name, ...(component.components || []).flatMap(componentNames)].filter(Boolean);
}

function updateStats() {
  let stillNeeded = 0;
  for (const project of projects) {
    const found = new Set(project.collectedComponentIds || []);
    stillNeeded += projectLeafComponents(project).filter((component) => !found.has(component.id)).length;
  }
  $("#projectCount").textContent = projects.length;
  $("#itemCount").textContent = stillNeeded;
}

function componentSearchText(project) {
  return projectComponents(project).flatMap(componentNames).join(" ");
}

function renderQ10Progress(node, requirements) {
  const progress = node.querySelector(".q10-progress");
  const main = progress.querySelector(".q10-progress-main");
  const detail = progress.querySelector(".q10-progress-detail");
  progress.className = "q10-progress";

  if (requirements.status === "empty") {
    progress.classList.add("hidden");
    return;
  }

  if (requirements.status === "needs-quality") {
    progress.classList.add("status-warning");
    main.textContent = `Set Q for ${requirements.unknownFoundCount} found direct component${requirements.unknownFoundCount === 1 ? "" : "s"}`;
    detail.textContent = "The remaining Q10 requirements will appear once every found direct component has a quality.";
    return;
  }

  if (requirements.status === "impossible") {
    progress.classList.add("status-impossible");
    main.textContent = "Q10 is no longer possible";
    detail.textContent = "Even Q10 on every missing direct component would finish below the required 9.50 average.";
    return;
  }

  if (requirements.status === "achieved" || requirements.status === "missed") {
    const achieved = requirements.status === "achieved";
    progress.classList.add(achieved ? "status-achieved" : "status-impossible");
    main.textContent = `${achieved ? "Q10 achieved" : "Below Q10"} · Direct average Q${requirements.finalAverage.toFixed(2)}`;
    detail.textContent = achieved
      ? "The completed set's direct components meet the 9.50 average requirement."
      : "The completed set's direct components do not meet the 9.50 average requirement.";
    return;
  }

  const requiredAverage = requirements.requiredRemainingAverage;
  progress.classList.add("status-active");
  main.textContent = requiredAverage <= 1
    ? "Any remaining qualities can still reach Q10"
    : `Missing direct components need Q${requiredAverage.toFixed(2)} average`;
  progress.querySelector(".q10-progress-detail").textContent =
    `Each missing direct component can be as low as Q${requirements.minimumQualityIfOthersTen} if every other missing direct component is Q10.`;
}

function makeQualitySelect(project, component) {
  const select = document.createElement("select");
  select.className = "quality-select";
  select.setAttribute("aria-label", `Quality for ${component.name}`);

  const unknown = document.createElement("option");
  unknown.value = "";
  unknown.textContent = "Q?";
  unknown.disabled = true;
  select.appendChild(unknown);

  for (let quality = 1; quality <= 10; quality += 1) {
    const option = document.createElement("option");
    option.value = String(quality);
    option.textContent = `Q${quality}`;
    select.appendChild(option);
  }

  const currentQuality = Number(project.componentQualities?.[component.id]);
  select.value = Number.isInteger(currentQuality) && currentQuality >= 1 && currentQuality <= 10
    ? String(currentQuality)
    : "";
  select.addEventListener("change", () => setComponentQuality(project, component.id, Number(select.value)));
  return select;
}

function makeMinimumQuality(plan, nestedSet = false) {
  if (!plan || !["in-progress", "impossible"].includes(plan.status)) return null;

  const requirement = document.createElement("span");
  requirement.className = `minimum-quality${plan.status === "impossible" ? " impossible" : ""}`;
  requirement.textContent = plan.status === "impossible"
    ? "NO Q10 PATH"
    : `${nestedSet ? "TARGET" : "MIN"} Q${plan.minimumQualityIfOthersTen}`;
  if (plan.status === "in-progress") {
    requirement.title = "Lowest possible quality if every other missing direct component is Q10";
  }
  return requirement;
}

function targetQualityForNestedSet(parentPlan, evaluation) {
  if (evaluation.complete) return evaluation.quality;
  if (parentPlan?.status === "in-progress") {
    return Math.max(1, Math.min(10, parentPlan.minimumQualityIfOthersTen));
  }
  return 10;
}

function nestedSetStatus(component, evaluation, plan) {
  if (evaluation.complete) {
    return `${component.name}'s direct components average Q${evaluation.average.toFixed(2)}, so it counts as one Q${evaluation.quality} component in its parent set.`;
  }
  if (!plan) {
    return "Complete this subset to calculate the single quality it contributes to its parent set.";
  }
  if (plan.status === "needs-quality") {
    return `Set Q for ${plan.unknownFoundCount} found direct component${plan.unknownFoundCount === 1 ? "" : "s"} to calculate this subset.`;
  }
  if (plan.status === "impossible") {
    return `${component.name} can no longer reach Q${plan.targetQuality} with the recorded direct-component qualities.`;
  }
  if (plan.status === "in-progress") {
    return `To make ${component.name} Q${plan.targetQuality}, its missing direct components need Q${plan.requiredRemainingAverage.toFixed(2)} average.`;
  }
  return `${component.name} currently resolves to Q${plan.resultQuality} from a Q${plan.finalAverage.toFixed(2)} direct-component average.`;
}

function renderItemComponent(project, component, parentPlan, trackQ10) {
  const found = new Set(project.collectedComponentIds || []);
  const isFound = Boolean(component.id && found.has(component.id));
  const li = document.createElement("li");

  if (!component.id) {
    li.className = "legacy-component";
    const name = document.createElement("span");
    name.className = "component-name";
    name.textContent = component.name;
    li.appendChild(name);
    return li;
  }

  li.className = "component-row";
  if (isFound) li.classList.add("is-found");

  const label = document.createElement("label");
  label.className = "component-check";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = isFound;
  checkbox.setAttribute("aria-label", `Mark ${component.name} as ${isFound ? "not found" : "found"}`);
  checkbox.addEventListener("change", () => toggleComponent(project, component.id, checkbox.checked));

  const marker = document.createElement("span");
  marker.className = "check-ui";
  marker.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  name.className = `component-name ${rarityClass(component.rarity)}`;
  name.textContent = component.name;
  if (component.rarity) name.title = component.rarity;

  label.append(checkbox, marker, name);
  li.appendChild(label);

  if (isFound) {
    li.appendChild(makeQualitySelect(project, component));
  } else if (trackQ10) {
    const requirement = makeMinimumQuality(parentPlan);
    if (requirement) li.appendChild(requirement);
  }

  return li;
}

function renderNestedSet(project, component, parentPlan, trackQ10, depth) {
  const evaluation = evaluateComponent(component, project.collectedComponentIds, project.componentQualities);
  const targetQuality = trackQ10 ? targetQualityForNestedSet(parentPlan, evaluation) : null;
  const plan = targetQuality
    ? calculateSetRequirements(component, project.collectedComponentIds, project.componentQualities, targetQuality)
    : null;

  const li = document.createElement("li");
  li.className = `nested-set-row depth-${Math.min(depth, 4)}`;

  const details = document.createElement("details");
  details.open = !evaluation.complete;
  const summary = document.createElement("summary");
  summary.className = "nested-set-summary";

  const identity = document.createElement("span");
  identity.className = "nested-set-identity";
  const kind = document.createElement("span");
  kind.className = "nested-set-kind";
  kind.textContent = "ASSEMBLED SUBSET";
  const name = document.createElement("strong");
  name.className = "nested-set-name";
  name.textContent = component.name;
  identity.append(kind, name);

  const result = document.createElement("span");
  result.className = `nested-set-result${evaluation.complete ? " complete" : ""}`;
  result.textContent = evaluation.complete
    ? `Q${evaluation.quality} · AVG ${evaluation.average.toFixed(2)}`
    : `${evaluation.foundLeafCount}/${evaluation.leafCount} FOUND`;

  summary.append(identity, result);
  if (trackQ10 && !evaluation.complete) {
    const requirement = makeMinimumQuality(parentPlan, true);
    if (requirement) summary.appendChild(requirement);
  }

  const status = document.createElement("p");
  status.className = `nested-set-status${evaluation.complete ? " complete" : ""}`;
  status.textContent = nestedSetStatus(component, evaluation, plan);

  const children = document.createElement("ul");
  children.className = "items nested-items";
  for (const child of component.components || []) {
    children.appendChild(renderProjectComponent(project, child, plan, trackQ10, depth + 1));
  }

  details.append(summary, status, children);
  li.appendChild(details);
  return li;
}

function renderProjectComponent(project, component, parentPlan, trackQ10, depth = 0) {
  if (component.type === "set") {
    return renderNestedSet(project, component, parentPlan, trackQ10, depth);
  }
  return renderItemComponent(project, component, parentPlan, trackQ10);
}

function render() {
  const query = $("#search").value.trim().toLowerCase();
  const filtered = projects.filter((project) => {
    const assembled = projectAssembled(project);
    const text = [
      project.owner,
      project.title,
      componentSearchText(project),
      project.q10 ? "q10" : "q5",
      formatSetStats(assembled, project.q10),
    ]
      .join(" ")
      .toLowerCase();
    return text.includes(query);
  });

  projectsEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", projects.length !== 0 || query.length !== 0);

  if (!filtered.length && projects.length && query) {
    const noResults = document.createElement("div");
    noResults.className = "no-results";
    noResults.textContent = `No dossiers match “${$("#search").value.trim()}”.`;
    projectsEl.appendChild(noResults);
  }

  for (const project of filtered) {
    const node = template.content.cloneNode(true);
    const assembled = projectAssembled(project);
    const components = assembled.components || [];
    const leaves = projectLeafComponents(project);
    const found = new Set(project.collectedComponentIds || []);
    const foundCount = leaves.filter((component) => found.has(component.id)).length;
    const q10Requirements = project.q10
      ? calculateSetRequirements(assembled, project.collectedComponentIds, project.componentQualities, 10)
      : null;

    node.querySelector(".owner").textContent = project.owner;
    node.querySelector(".project-title").textContent = project.title;

    const q10Badge = node.querySelector(".q10-badge");
    q10Badge.classList.toggle("hidden", !project.q10);
    if (q10Requirements) renderQ10Progress(node, q10Requirements);

    const setStats = node.querySelector(".set-stats");
    const setStatsText = formatSetStats(assembled, project.q10);
    setStats.textContent = setStatsText;
    setStats.classList.toggle("hidden", !setStatsText);

    const total = node.querySelector(".item-total");
    total.textContent = leaves.length
      ? `${foundCount}/${leaves.length} FOUND`
      : `${components.length} ${components.length === 1 ? "ITEM" : "ITEMS"}`;
    if (leaves.length && foundCount === leaves.length) total.classList.add("all-found");

    const list = node.querySelector(".items");
    if (!components.length) {
      const li = document.createElement("li");
      li.className = "empty-item";
      li.textContent = "No components linked in Airtable";
      list.appendChild(li);
    } else {
      for (const component of components) {
        list.appendChild(renderProjectComponent(project, component, q10Requirements, project.q10));
      }
    }

    node.querySelector(".edit").addEventListener("click", () => openEdit(project));
    node.querySelector(".complete").addEventListener("click", () => completeProject(project));
    projectsEl.appendChild(node);
  }

  updateStats();
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function loadAll() {
  try {
    const [catalogData, projectData] = await Promise.all([
      fetchJson("/api/catalog"),
      fetchJson("/api/projects"),
    ]);
    catalog = catalogData;
    catalogById = new Map(catalog.map((item) => [item.id, item]));
    projects = projectData;
    render();
  } catch (err) {
    showNotice(err.message, true);
  }
}

async function loadProjects() {
  try {
    projects = await fetchJson("/api/projects");
    render();
  } catch (err) {
    showNotice(err.message, true);
  }
}

function closeCombo() {
  setDropdown.classList.add("hidden");
  setSearch.setAttribute("aria-expanded", "false");
  comboIndex = -1;
}

function setActiveComboOption(index) {
  comboIndex = Math.max(-1, Math.min(index, comboResults.length - 1));
  const options = [...setDropdown.querySelectorAll(".combo-option")];
  options.forEach((option, optionIndex) => option.classList.toggle("active", optionIndex === comboIndex));
  if (comboIndex >= 0) options[comboIndex]?.scrollIntoView({ block: "nearest" });
}

function renderCombo(query = "") {
  const normalized = query.trim().toLowerCase();
  comboResults = catalog
    .filter((item) => !normalized || `${item.name} ${item.location || ""}`.toLowerCase().includes(normalized))
    .slice(0, 80);

  setDropdown.innerHTML = "";
  comboIndex = -1;

  if (!comboResults.length) {
    const empty = document.createElement("div");
    empty.className = "combo-empty";
    empty.textContent = "No assembled items found.";
    setDropdown.appendChild(empty);
  } else {
    for (const item of comboResults) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "combo-option";
      option.setAttribute("role", "option");

      const name = document.createElement("strong");
      name.textContent = item.name;
      const meta = document.createElement("span");
      const itemCount = collectLeafComponents(item).length;
      const subsetCount = countNestedSets(item);
      const componentMeta = `${itemCount} item${itemCount === 1 ? "" : "s"}${subsetCount ? ` + ${subsetCount} subset${subsetCount === 1 ? "" : "s"}` : ""}`;
      meta.textContent = [item.location, componentMeta].filter(Boolean).join(" · ");
      option.append(name, meta);

      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => selectCatalogItem(item));
      setDropdown.appendChild(option);
    }
  }

  setDropdown.classList.remove("hidden");
  setSearch.setAttribute("aria-expanded", "true");
}

function countNestedSets(component) {
  return (component.components || []).reduce((count, child) => (
    count + (child.type === "set" ? 1 + countNestedSets(child) : 0)
  ), 0);
}

function selectCatalogItem(item) {
  setId.value = item.id;
  setSearch.value = item.name;
  setSearch.setCustomValidity("");
  closeCombo();
  renderPreview(item);
}

function renderPreview(item) {
  previewItems.innerHTML = "";
  const components = item?.components || [];
  const itemCount = item ? collectLeafComponents(item).length : 0;
  const subsetCount = item ? countNestedSets(item) : 0;
  $("#previewCount").textContent = subsetCount ? `${itemCount} ITEMS · ${subsetCount} SUBSETS` : String(itemCount);
  componentPreview.classList.toggle("hidden", !item);

  if (!item) return;

  if (!components.length) {
    const li = document.createElement("li");
    li.className = "preview-empty";
    li.textContent = "No component relationships are currently linked for this assembled item.";
    previewItems.appendChild(li);
    return;
  }

  for (const component of components) appendPreviewComponent(previewItems, component);
}

function appendPreviewComponent(parent, component) {
  const li = document.createElement("li");

  if (component.type !== "set") {
    li.className = `preview-item ${rarityClass(component.rarity)}`;
    li.textContent = component.name;
    if (component.rarity) li.title = component.rarity;
    parent.appendChild(li);
    return;
  }

  li.className = "preview-item preview-set";
  const head = document.createElement("div");
  head.className = "preview-set-head";
  const name = document.createElement("strong");
  name.textContent = component.name;
  const kind = document.createElement("span");
  kind.textContent = "ASSEMBLED SUBSET";
  head.append(name, kind);
  li.appendChild(head);

  const children = document.createElement("ul");
  children.className = "preview-nested";
  for (const child of component.components || []) appendPreviewComponent(children, child);
  li.appendChild(children);
  parent.appendChild(li);
}

function openAdd() {
  window.location.hash = "projects-board";
  setView("projects");
  editingProject = null;
  $("#dialogTitle").textContent = "File New Project";
  $("#projectId").value = "";
  $("#owner").value = "";
  setId.value = "";
  setSearch.value = "";
  $("#q10Set").checked = false;
  renderPreview(null);
  closeCombo();
  dialog.showModal();
  $("#owner").focus();
}

function openEdit(project) {
  editingProject = project;
  $("#dialogTitle").textContent = "Edit Dossier";
  $("#projectId").value = project.id;
  $("#owner").value = project.owner;
  $("#q10Set").checked = Boolean(project.q10);

  const assembled = catalogById.get(project.assembledItemId);
  if (assembled) {
    selectCatalogItem(assembled);
  } else {
    setId.value = project.assembledItemId || "";
    setSearch.value = project.title || "";
    renderPreview(null);
  }

  closeCombo();
  dialog.showModal();
  $("#owner").focus();
}

async function completeProject(project) {
  if (!confirm(`Mark “${project.title}” complete and remove it from active projects?`)) return;
  try {
    await fetchJson(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    projects = projects.filter((item) => item.id !== project.id);
    render();
    showNotice("Dossier archived as complete.");
  } catch (err) {
    showNotice(err.message, true);
  }
}

function queueCollectedSave(project) {
  const previous = saveQueues.get(project.id) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      await fetchJson(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collectedComponentIds: project.collectedComponentIds || [],
          componentQualities: project.componentQualities || {},
        }),
      });
    })
    .catch(async (err) => {
      showNotice(`Could not save checklist: ${err.message}`, true);
      await loadProjects();
    })
    .finally(() => {
      if (saveQueues.get(project.id) === next) saveQueues.delete(project.id);
    });

  saveQueues.set(project.id, next);
}

function toggleComponent(project, componentId, checked) {
  const found = new Set(project.collectedComponentIds || []);
  project.componentQualities = { ...(project.componentQualities || {}) };
  if (checked) {
    found.add(componentId);
    if (!project.componentQualities[componentId]) project.componentQualities[componentId] = 10;
  } else {
    found.delete(componentId);
    delete project.componentQualities[componentId];
  }
  project.collectedComponentIds = [...found];
  render();
  queueCollectedSave(project);
}

function setComponentQuality(project, componentId, quality) {
  if (!Number.isInteger(quality) || quality < 1 || quality > 10) return;
  const found = new Set(project.collectedComponentIds || []);
  found.add(componentId);
  project.collectedComponentIds = [...found];
  project.componentQualities = { ...(project.componentQualities || {}), [componentId]: quality };
  render();
  queueCollectedSave(project);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const id = $("#projectId").value;
  const selected = catalogById.get(setId.value);
  if (!selected) {
    setSearch.setCustomValidity("Choose an assembled item from the list.");
    setSearch.reportValidity();
    setSearch.focus();
    renderCombo(setSearch.value);
    return;
  }

  const submit = form.querySelector('button[type="submit"]');
  const originalText = submit.textContent;
  const payload = {
    owner: $("#owner").value,
    title: selected.name,
    assembledItemId: selected.id,
    q10: $("#q10Set").checked,
  };

  if (id && editingProject && editingProject.assembledItemId !== selected.id) {
    payload.collectedComponentIds = [];
    payload.componentQualities = {};
  }

  try {
    submit.disabled = true;
    submit.textContent = "Saving…";
    await fetchJson(id ? `/api/projects/${id}` : "/api/projects", {
      method: id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    dialog.close();
    await loadProjects();
    showNotice(id ? "Dossier updated." : "Project filed to the archive.");
  } catch (err) {
    showNotice(err.message, true);
  } finally {
    submit.disabled = false;
    submit.textContent = originalText;
  }
});

accessForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const generation = ++intelligenceGeneration;
  const code = accessCode.value.trim();
  const submit = accessForm.querySelector('button[type="submit"]');
  const originalText = submit.textContent;
  accessMessage.textContent = "";
  accessMessage.classList.remove("error");

  try {
    submit.disabled = true;
    submit.textContent = "Verifying…";
    const data = await fetchJson("/api/alts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });

    if (generation !== intelligenceGeneration) return;
    intelligenceCode = code;
    accessCode.value = "";
    renderIntelligence(data);
    intelligenceLocked.classList.add("hidden");
    intelligenceUnlocked.classList.remove("hidden");
    $("#lockIntelligence").focus();
  } catch (err) {
    if (generation !== intelligenceGeneration) return;
    accessMessage.textContent = err.message;
    accessMessage.classList.add("error");
    accessCode.select();
  } finally {
    submit.disabled = false;
    submit.textContent = originalText;
  }
});

$("#altMainMode").addEventListener("change", () => {
  syncAltMainMode();
  $("#altListType").value = "";
});
$("#altKnownMain").addEventListener("change", () => {
  const known = knownMainTypes.get($("#altKnownMain").value.toLowerCase());
  $("#altListType").value = known?.types.size === 1 ? [...known.types][0] : "";
});
altSubmissionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!intelligenceCode || $("#altSubmissionFields").disabled) return;
  const generation = intelligenceGeneration;
  const altAccounts = itemLines($("#altUsernames").value);
  altSubmissionMessage.classList.remove("error");
  if (!altAccounts.length || altAccounts.length > 10) {
    altSubmissionMessage.textContent = "Enter 1–10 alt usernames, separated by commas or new lines.";
    altSubmissionMessage.classList.add("error");
    return;
  }
  const body = {
    code: intelligenceCode,
    mode: $("#altMainMode").value,
    mainAccount: $("#altMainMode").value === "new" ? $("#altNewMain").value : $("#altKnownMain").value,
    altAccounts,
    listType: $("#altListType").value,
    notes: $("#altNotes").value,
  };
  $("#altSubmissionFields").disabled = true;
  $("#submitAltIntelligence").textContent = "Saving…";
  altSubmissionMessage.textContent = "";
  try {
    const response = await fetch("/api/alts/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (generation !== intelligenceGeneration) return;
    if (response.status === 403) {
      lockIntelligence();
      accessMessage.textContent = "Access is no longer valid. Enter an enabled guild codeword to continue.";
      accessMessage.classList.add("error");
      accessCode.focus();
      return;
    }
    const result = await response.json();
    if (generation !== intelligenceGeneration) return;
    if (!response.ok) throw new Error(result.error || "Unable to save intelligence.");
    const message = `${result.created} alt${result.created === 1 ? "" : "s"} added. ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped.`
      + (result.inactiveSkipped ? " Some pairs already exist as inactive records and remain hidden." : "");
    $("#altUsernames").value = "";
    $("#altNotes").value = "";
    altSubmissionMessage.textContent = message;
    try {
      const data = await fetchJson("/api/alts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: intelligenceCode }),
      });
      if (generation !== intelligenceGeneration) return;
      renderIntelligence(data);
    } catch {
      if (generation !== intelligenceGeneration) return;
      altSubmissionMessage.textContent = `${message} The registry could not refresh. Lock and unlock the archive to reload it.`;
    }
  } catch (err) {
    if (generation !== intelligenceGeneration) return;
    altSubmissionMessage.textContent = err.message;
    altSubmissionMessage.classList.add("error");
  } finally {
    if (generation === intelligenceGeneration) {
      $("#altSubmissionFields").disabled = false;
      $("#submitAltIntelligence").textContent = "Save Intelligence";
    }
  }
});

setSearch.addEventListener("focus", () => renderCombo(setSearch.value));
setSearch.addEventListener("input", () => {
  setId.value = "";
  setSearch.setCustomValidity("");
  renderPreview(null);
  renderCombo(setSearch.value);
});
setSearch.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (setDropdown.classList.contains("hidden")) renderCombo(setSearch.value);
    setActiveComboOption(comboIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveComboOption(comboIndex <= 0 ? comboResults.length - 1 : comboIndex - 1);
  } else if (event.key === "Enter" && !setDropdown.classList.contains("hidden") && comboIndex >= 0) {
    event.preventDefault();
    selectCatalogItem(comboResults[comboIndex]);
  } else if (event.key === "Escape") {
    closeCombo();
  }
});

document.addEventListener("click", (event) => {
  if (!setCombo.contains(event.target)) closeCombo();
});

$("#openAdd").addEventListener("click", openAdd);
$("#emptyAdd").addEventListener("click", openAdd);
$("#closeDialog").addEventListener("click", () => dialog.close());
$("#cancelDialog").addEventListener("click", () => dialog.close());
$("#refresh").addEventListener("click", loadAll);
$("#search").addEventListener("input", render);
$("#lockIntelligence").addEventListener("click", () => {
  lockIntelligence();
  accessCode.focus();
});
window.addEventListener("hashchange", syncViewFromHash);
window.addEventListener("pagehide", lockIntelligence);

dialog.addEventListener("close", () => {
  closeCombo();
  editingProject = null;
});

syncViewFromHash();
lockIntelligence();
loadAll();

