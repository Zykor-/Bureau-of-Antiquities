const $ = (s) => document.querySelector(s);
const projectsEl = $("#projects");
const emptyEl = $("#empty");
const noticeEl = $("#notice");
const dialog = $("#projectDialog");
const form = $("#projectForm");
const template = $("#projectTemplate");
let projects = [];

function showNotice(message, error = false) {
  noticeEl.textContent = message;
  noticeEl.classList.remove("hidden", "error");
  if (error) noticeEl.classList.add("error");
  window.setTimeout(() => noticeEl.classList.add("hidden"), 4200);
}

function itemLines(value) {
  return String(value || "").split(/\r?\n|,/).map(x => x.trim()).filter(Boolean);
}

function updateStats() {
  const projectCount = projects.length;
  const itemCount = projects.reduce((total, project) => total + itemLines(project.items).length, 0);
  $("#projectCount").textContent = projectCount;
  $("#itemCount").textContent = itemCount;
}

function render() {
  const q = $("#search").value.trim().toLowerCase();
  const filtered = projects.filter(p => [p.owner, p.title, p.items].join(" ").toLowerCase().includes(q));
  projectsEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", filtered.length !== 0 || q.length !== 0);

  for (const project of filtered) {
    const node = template.content.cloneNode(true);
    const items = itemLines(project.items);

    node.querySelector(".owner").textContent = project.owner;
    node.querySelector(".project-title").textContent = project.title;
    node.querySelector(".item-total").textContent = `${items.length} ${items.length === 1 ? "ITEM" : "ITEMS"}`;

    const list = node.querySelector(".items");
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "empty-item";
      li.textContent = "No items listed";
      list.appendChild(li);
    } else {
      for (const item of items) {
        const li = document.createElement("li");
        li.textContent = item;
        list.appendChild(li);
      }
    }

    node.querySelector(".edit").addEventListener("click", () => openEdit(project));
    node.querySelector(".complete").addEventListener("click", () => completeProject(project));
    projectsEl.appendChild(node);
  }

  updateStats();
}

async function loadProjects() {
  try {
    const res = await fetch("/api/projects");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to load projects.");
    projects = data;
    render();
  } catch (err) {
    showNotice(err.message, true);
  }
}

function openAdd() {
  $("#dialogTitle").textContent = "File New Project";
  $("#projectId").value = "";
  $("#owner").value = "";
  $("#title").value = "";
  $("#items").value = "";
  dialog.showModal();
  $("#owner").focus();
}

function openEdit(project) {
  $("#dialogTitle").textContent = "Edit Dossier";
  $("#projectId").value = project.id;
  $("#owner").value = project.owner;
  $("#title").value = project.title;
  $("#items").value = project.items;
  dialog.showModal();
  $("#owner").focus();
}

async function completeProject(project) {
  if (!confirm(`Mark “${project.title}” complete and remove it from active projects?`)) return;
  try {
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to complete project.");
    projects = projects.filter(p => p.id !== project.id);
    render();
    showNotice("Dossier archived as complete.");
  } catch (err) {
    showNotice(err.message, true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#projectId").value;
  const submit = form.querySelector('button[type="submit"]');
  const originalText = submit.textContent;
  const payload = {
    owner: $("#owner").value,
    title: $("#title").value,
    items: $("#items").value,
  };

  try {
    submit.disabled = true;
    submit.textContent = "Saving…";
    const res = await fetch(id ? `/api/projects/${id}` : "/api/projects", {
      method: id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to save project.");
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

$("#openAdd").addEventListener("click", openAdd);
$("#closeDialog").addEventListener("click", () => dialog.close());
$("#cancelDialog").addEventListener("click", () => dialog.close());
$("#refresh").addEventListener("click", loadProjects);
$("#search").addEventListener("input", render);

loadProjects();
