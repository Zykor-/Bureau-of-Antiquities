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
  accessCode.value = "";
  accessMessage.textContent = "";
  accessMessage.classList.remove("error");
  $("#guildAlts").replaceChildren();
  $("#huntTargets").replaceChildren();
  intelligenceUnlocked.classList.add("hidden");
  intelligenceLocked.classList.remove("hidden");
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

function projectComponents(project) {
  const assembled = catalogById.get(project.assembledItemId);
  if (assembled) return assembled.components || [];
  return itemLines(project.legacyItems).map((name) => ({ id: "", name, rarity: "" }));
}

function updateStats() {
  let stillNeeded = 0;
  for (const project of projects) {
    const found = new Set(project.collectedComponentIds || []);
    stillNeeded += projectComponents(project).filter((component) => !component.id || !found.has(component.id)).length;
  }
  $("#projectCount").textContent = projects.length;
  $("#itemCount").textContent = stillNeeded;
}

function componentSearchText(project) {
  return projectComponents(project).map((component) => component.name).join(" ");
}

function render() {
  const query = $("#search").value.trim().toLowerCase();
  const filtered = projects.filter((project) => {
    const text = [project.owner, project.title, componentSearchText(project), project.q10 ? "q10" : ""]
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
    const components = projectComponents(project);
    const found = new Set(project.collectedComponentIds || []);
    const foundCount = components.filter((component) => component.id && found.has(component.id)).length;

    node.querySelector(".owner").textContent = project.owner;
    node.querySelector(".project-title").textContent = project.title;

    const q10Badge = node.querySelector(".q10-badge");
    q10Badge.classList.toggle("hidden", !project.q10);

    const total = node.querySelector(".item-total");
    total.textContent = components.some((component) => component.id)
      ? `${foundCount}/${components.length} FOUND`
      : `${components.length} ${components.length === 1 ? "ITEM" : "ITEMS"}`;
    if (components.length && foundCount === components.length) total.classList.add("all-found");

    const list = node.querySelector(".items");
    if (!components.length) {
      const li = document.createElement("li");
      li.className = "empty-item";
      li.textContent = "No components linked in Airtable";
      list.appendChild(li);
    } else {
      for (const component of components) {
        const li = document.createElement("li");
        const isFound = Boolean(component.id && found.has(component.id));
        if (isFound) li.classList.add("is-found");

        if (component.id) {
          li.classList.add("component-row");
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
        } else {
          li.classList.add("legacy-component");
          const name = document.createElement("span");
          name.className = "component-name";
          name.textContent = component.name;
          li.appendChild(name);
        }

        list.appendChild(li);
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
      const count = item.components?.length || 0;
      meta.textContent = [item.location, `${count} component${count === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
      option.append(name, meta);

      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => selectCatalogItem(item));
      setDropdown.appendChild(option);
    }
  }

  setDropdown.classList.remove("hidden");
  setSearch.setAttribute("aria-expanded", "true");
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
  $("#previewCount").textContent = components.length;
  componentPreview.classList.toggle("hidden", !item);

  if (!item) return;

  if (!components.length) {
    const li = document.createElement("li");
    li.className = "preview-empty";
    li.textContent = "No component relationships are currently linked for this assembled item.";
    previewItems.appendChild(li);
    return;
  }

  for (const component of components) {
    const li = document.createElement("li");
    li.className = `preview-item ${rarityClass(component.rarity)}`;
    li.textContent = component.name;
    if (component.rarity) li.title = component.rarity;
    previewItems.appendChild(li);
  }
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
        body: JSON.stringify({ collectedComponentIds: project.collectedComponentIds || [] }),
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
  if (checked) found.add(componentId);
  else found.delete(componentId);
  project.collectedComponentIds = [...found];
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

    accessCode.value = "";
    renderAccountGroups($("#guildAlts"), data.guildAlts || [], "No friendly alternate accounts are active.");
    renderAccountGroups($("#huntTargets"), data.huntTargets || [], "No hunt targets are active.");
    intelligenceLocked.classList.add("hidden");
    intelligenceUnlocked.classList.remove("hidden");
    $("#lockIntelligence").focus();
  } catch (err) {
    accessMessage.textContent = err.message;
    accessMessage.classList.add("error");
    accessCode.select();
  } finally {
    submit.disabled = false;
    submit.textContent = originalText;
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

dialog.addEventListener("close", () => {
  closeCombo();
  editingProject = null;
});

syncViewFromHash();
lockIntelligence();
loadAll();
