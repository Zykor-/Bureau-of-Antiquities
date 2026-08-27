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
  window.setTimeout(() => noticeEl.classList.add("hidden"), 3500);
}

function itemLines(value) {
  return String(value || "").split(/\r?\n|,/).map(x => x.trim()).filter(Boolean);
}

function render() {
  const q = $("#search").value.trim().toLowerCase();
  const filtered = projects.filter(p => [p.owner, p.title, p.items].join(" ").toLowerCase().includes(q));
  projectsEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", filtered.length !== 0);

  for (const project of filtered) {
    const node = template.content.cloneNode(true);
    node.querySelector(".owner").textContent = project.owner;
    node.querySelector(".project-title").textContent = project.title;
    const list = node.querySelector(".items");
    const items = itemLines(project.items);
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
  $("#dialogTitle").textContent = "Add Project";
  $("#projectId").value = "";
  $("#owner").value = "";
  $("#title").value = "";
  $("#items").value = "";
  dialog.showModal();
  $("#owner").focus();
}

function openEdit(project) {
  $("#dialogTitle").textContent = "Edit Project";
  $("#projectId").value = project.id;
  $("#owner").value = project.owner;
  $("#title").value = project.title;
  $("#items").value = project.items;
  dialog.showModal();
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
    showNotice("Project archived as complete.");
  } catch (err) {
    showNotice(err.message, true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#projectId").value;
  const payload = {
    owner: $("#owner").value,
    title: $("#title").value,
    items: $("#items").value,
  };
  try {
    const res = await fetch(id ? `/api/projects/${id}` : "/api/projects", {
      method: id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to save project.");
    dialog.close();
    await loadProjects();
    showNotice(id ? "Project updated." : "Project added.");
  } catch (err) {
    showNotice(err.message, true);
  }
});

$("#openAdd").addEventListener("click", openAdd);
$("#closeDialog").addEventListener("click", () => dialog.close());
$("#cancelDialog").addEventListener("click", () => dialog.close());
$("#refresh").addEventListener("click", loadProjects);
$("#search").addEventListener("input", render);

loadProjects();
