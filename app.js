const COMPLETED_PATH = "/Completed";
const ORIGINS = ["https://app.connect.trimble.com","https://app21.connect.trimble.com","https://app31.connect.trimble.com","https://app32.connect.trimble.com","https://app22.connect.trimble.com"];
let workspace, token, project, origin, cwas = [], ifcs = [];
const $ = id => document.getElementById(id);
const status = (text, error = false) => { $("status").textContent = text; $("status").classList.toggle("error", error); };
const projectId = () => project?.id || project?.projectId || project?.ProjectId;
const label = item => item.name || item.fileName || item.displayName || "Unnamed";
const identifier = item => item.id || item.fileId || item.versionId || item.uuid;
const isFolder = item => item.type === "folder" || item.type === "Folder" || item.isFolder === true || item.folder === true;
const isIfc = item => /\.ifc$/i.test(label(item));
function options(id, placeholder, values, value = identifier, text = label) {
  const select = $(id);
  select.replaceChildren(new Option(placeholder, ""), ...values.map(item => new Option(text(item), value(item))));
  select.disabled = values.length === 0;
}
function eventHandler(event, args) {
  if (event === "extension.accessToken" && typeof args?.data === "string") { token = args.data; loadCwas(); }
  if (event === "extension.command") workspace?.ui?.setActiveMenuItem?.(args?.data || "PROJECT_PLANNER");
}
async function request(path, asText = false) {
  if (!token) throw new Error("Approve the Trimble access-token permission, then press Refresh.");
  const messages = [];
  const candidates = origin ? [origin, ...ORIGINS.filter(item => item !== origin)] : ORIGINS;
  for (const base of candidates) {
    try {
      const response = await fetch(`${base}/tc/api/2.0${path}`, { headers: { authorization: `Bearer ${token}`, accept: asText ? "application/octet-stream,text/plain" : "application/json" } });
      if (response.ok) { origin = base; return asText ? response.text() : response.json(); }
      messages.push(`${base}: ${response.status}`);
    } catch (error) { messages.push(`${base}: ${error.message}`); }
  }
  throw new Error(`Trimble request failed (${messages.join(", ")}).`);
}
function records(data) {
  if (Array.isArray(data)) return data;
  return data?.items || data?.files || data?.folders || data?.data || [];
}
function nextPage(data, path) {
  const next = data?.next || data?.nextPage || data?.nextPageToken || data?.continuationToken || data?.links?.next || data?.pagination?.next;
  if (!next) return null;
  if (typeof next !== "string") return null;
  if (/^https?:\/\//i.test(next)) {
    const url = new URL(next);
    return `${url.pathname}${url.search}`.replace(/^\/tc\/api\/2\.0/, "");
  }
  return next.startsWith("/") ? next : `${path.split("?")[0]}?page=${encodeURIComponent(next)}`;
}
async function list(path) {
  const result = [];
  const seen = new Set();
  let endpoint = `/projects/${encodeURIComponent(projectId())}/files?path=${encodeURIComponent(path)}`;
  while (endpoint && !seen.has(endpoint)) {
    seen.add(endpoint);
    const data = await request(endpoint);
    result.push(...records(data));
    endpoint = nextPage(data, endpoint);
  }
  return result;
}
async function loadCwas() {
  try {
    status("Loading CWA folders from Completed...");
    cwas = (await list(COMPLETED_PATH)).filter(isFolder).sort((a,b) => label(a).localeCompare(label(b)));
    options("cwaSelect", cwas.length ? "Select CWA..." : "No folders found in Completed", cwas);
    options("ifcSelect", "Select a CWA folder first", []);
    options("productSelect", "Select an IFC file first", []);
    status(cwas.length ? "Choose a CWA folder." : "No folders were found directly inside /Completed.", !cwas.length);
  } catch (error) { status(error.message, true); }
}
async function loadIfcs() {
  const cwa = cwas.find(item => identifier(item) === $("cwaSelect").value);
  if (!cwa) return;
  try {
    status(`Loading IFC files for ${label(cwa)}...`);
    const cwaPath = cwa.path || cwa.fullPath || `${COMPLETED_PATH}/${label(cwa)}`;
    ifcs = (await list(cwaPath)).filter(isIfc).sort((a,b) => label(a).localeCompare(label(b)));
    options("ifcSelect", ifcs.length ? "Select IFC file..." : "No IFC files found", ifcs);
    options("productSelect", "Select an IFC file first", []);
    status(ifcs.length ? "Choose an IFC file." : `No IFC files were found in ${label(cwa)}.`, !ifcs.length);
  } catch (error) { status(error.message, true); }
}
function productNames(text) {
  const types = "BUILDINGELEMENTPROXY|WALL(?:STANDARDCASE)?|SLAB|BEAM|COLUMN|MEMBER|PLATE|FOOTING|PILE|ROOF|STAIR|DOOR|WINDOW|CURTAINWALL|ELEMENTASSEMBLY|PIPESEGMENT|DUCTSEGMENT|CABLECARRIERSEGMENT|FLOWTERMINAL|FURNISHINGELEMENT";
  const pattern = new RegExp(`IFC(?:${types})\\s*\\(\\s*'[^']*'\\s*,\\s*#[^,]+,\\s*'((?:''|[^'])*)'`, "gi");
  const names = new Set(); let found;
  while ((found = pattern.exec(text))) { const name = found[1].replace(/''/g, "'").trim(); if (name && name !== "$") names.add(name); }
  return [...names].sort((a,b) => a.localeCompare(b));
}
async function loadProducts() {
  const file = ifcs.find(item => identifier(item) === $("ifcSelect").value);
  if (!file) return;
  try {
    status(`Reading product names from ${label(file)}...`);
    let text;
    const url = file.downloadUrl || file.downloadURL || file.url;
    if (url) { const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } }); if (response.ok) text = await response.text(); }
    if (!text) text = await request(`/projects/${encodeURIComponent(projectId())}/files/${encodeURIComponent(identifier(file))}/download`, true);
    const names = productNames(text);
    options("productSelect", names.length ? "Select product name..." : "No product names found", names, item => item, item => item);
    status(names.length ? `${names.length} product name${names.length === 1 ? "" : "s"} found.` : "No product names were found in this IFC.", !names.length);
  } catch (error) { status(`Could not read the IFC: ${error.message}`, true); }
}
$("refreshButton").addEventListener("click", loadCwas);
$("cwaSelect").addEventListener("change", loadIfcs);
$("ifcSelect").addEventListener("change", loadProducts);
(async () => {
  try {
    workspace = await TrimbleConnectWorkspace.connect(window.parent, eventHandler, 30000);
    project = await (workspace.project.getCurrentProject?.() || workspace.project.getProject());
    $("projectName").textContent = project.name || "Current Trimble Connect project";
    await workspace.ui.setMenu({ title: "Project Planner", icon: "https://venkateshvupputuri-droid.github.io/ProjectPlanner/icon.svg", command: "PROJECT_PLANNER" });
    await workspace.ui.setActiveMenuItem("PROJECT_PLANNER");
    const permission = await workspace.extension.requestPermission("accesstoken");
    if (typeof permission === "string" && !["pending", "denied"].includes(permission)) { token = permission; await loadCwas(); }
    else status("Approve access-token permission in Trimble Connect, then press Refresh.", true);
  } catch (error) { status(`Could not connect to Trimble Connect: ${error.message}`, true); }
})();