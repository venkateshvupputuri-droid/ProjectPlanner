const COMPLETED_PATH = "/Completed";
const ORIGINS = ["https://app.connect.trimble.com","https://app21.connect.trimble.com","https://app31.connect.trimble.com","https://app32.connect.trimble.com","https://app22.connect.trimble.com"];
let workspace, token, project, origin, cwas = [], ifcs = [], projectEntries = [];
const FABRICATION_API = window.FABRICATION_API_URL || "";
const $ = id => document.getElementById(id);
const status = (text, error = false) => { $("status").textContent = text; $("status").classList.toggle("error", error); };
const projectId = () => project?.id || project?.projectId || project?.ProjectId;
const label = item => item.name || item.fileName || item.displayName || "Unnamed";
const identifier = item => item.id || item.fileId || item.versionId || item.uuid;
const entryIdentifiers = item => [item.id, item.fileId, item.folderId, item.uuid].filter(Boolean).map(String);
const fileIdentifier = item => item.fileId || item.id || item.versionId || item.uuid;
const isFolder = item => item.directory === true || item.type === "folder" || item.type === "Folder" || item.isFolder === true || item.folder === true;
const isIfc = item => /\.ifc$/i.test(label(item));
let assemblies = [], selectedMark = "", selectedSequence = 0;
function options(id, placeholder, values, value = identifier, text = label) {
  const select = $(id);
  select.replaceChildren(new Option(placeholder, ""), ...values.map(item => new Option(text(item), value(item))));
  select.disabled = values.length === 0;
}
function splitIfcArguments(value) {
  const result = []; let current = ""; let depth = 0; let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'" && value[index + 1] === "'") { current += "''"; index += 1; continue; }
    if (character === "'") quoted = !quoted;
    if (!quoted && character === "(") depth += 1;
    if (!quoted && character === ")") depth -= 1;
    if (character === "," && !quoted && depth === 0) { result.push(current.trim()); current = ""; }
    else current += character;
  }
  result.push(current.trim());
  return result;
}
function ifcString(value) {
  const match = String(value || "").match(/^'((?:''|[^'])*)'$/);
  return match ? match[1].replace(/''/g, "'").trim() : "";
}
function propertyKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function extractIfcData(text) {
  const entities = new Map(); const properties = new Map(); const relations = [];
  const entityPattern = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([^;]*?)\)\s*;/gis;
  let match;
  while ((match = entityPattern.exec(text))) entities.set(`#${match[1]}`, { type: match[2].toUpperCase(), args: splitIfcArguments(match[3]) });
  for (const [id, entity] of entities) {
    if (entity.type === "IFCPROPERTYSINGLEVALUE") {
      const name = ifcString(entity.args[0]);
      const valueMatch = entity.args.slice(2).join(",").match(/IFC(?:LABEL|TEXT|IDENTIFIER|INTEGER|REAL)\s*\(\s*'((?:''|[^'])*)'/i);
      if (name && valueMatch) properties.set(id, { name: propertyKey(name), value: valueMatch[1].replace(/''/g, "'").trim() });
    }
    if (entity.type === "IFCRELDEFINESBYPROPERTIES") {
      const propertySet = [...String(entity.args.at(-1)).matchAll(/#\d+/g)].map(item => item[0]).at(-1); const propertyEntity = entities.get(propertySet);
      const objects = [...String(entity.args[4] || "").matchAll(/#\d+/g)].map(item => item[0]);
      if (propertyEntity?.type === "IFCPROPERTYSET") relations.push({ objects, properties: propertyEntity.args.flatMap(argument => [...String(argument).matchAll(/#\d+/g)].map(item => item[0])) });
    }
  }
  const valuesByObject = new Map();
  for (const relation of relations) for (const objectId of relation.objects) valuesByObject.set(objectId, { ...(valuesByObject.get(objectId) || {}), ...Object.fromEntries(relation.properties.map(id => [properties.get(id)?.name, properties.get(id)?.value]).filter(([name]) => name)) });
  const result = [];
  for (const [id, entity] of entities) {
    const values = valuesByObject.get(id) || {}; const name = ifcString(entity.args[2]);
    const assemblyName = values.ASSEMBLYNAME || values.ASSEMBLY || (entity.type === "IFCELEMENTASSEMBLY" ? name : "");
    const mark = values.ASSEMBLYCASTUNITMARK || values.CASTUNITMARK || values.ASSEMBLYMARK || values.MARK || values.TAG || (entity.type === "IFCELEMENTASSEMBLY" ? ifcString(entity.args[3]) : "");
    if (assemblyName && mark) result.push({ id, type: entity.type, assemblyName, mark });
  }
  const grouped = new Map();
  for (const item of result) { if (!grouped.has(item.assemblyName)) grouped.set(item.assemblyName, new Set()); grouped.get(item.assemblyName).add(item.mark); }
  return [...grouped].map(([assemblyName, marks]) => ({ assemblyName, marks: [...marks].sort((a, b) => a.localeCompare(b)) })).sort((a, b) => a.assemblyName.localeCompare(b.assemblyName));
}
function updateAssemblyControls() {
  options("assemblySelect", assemblies.length ? "Select ASSEMBLY_NAME..." : "No ASSEMBLY_NAME values found", assemblies, item => item.assemblyName, item => item.assemblyName);
  $("markRows").innerHTML = "<tr><td colspan=\"4\">Select an ASSEMBLY_NAME first</td></tr>";
  $("fabricatorName").value = "";
  $("fabricatorName").disabled = true;
  $("saveFabricator").disabled = true;
}
async function loadAssemblyMarks() {
  const assembly = assemblies.find(item => item.assemblyName === $("assemblySelect").value);
  const marks = assembly?.marks || [];
  $("markRows").innerHTML = marks.length ? marks.map((mark, index) => `<tr><td>${mark}</td><td class=\"sequence\">1-${index + 1}</td><td class=\"assigned-fabricator\">Not assigned</td><td><button type=\"button\" class=\"choose-mark\" data-mark=\"${encodeURIComponent(mark)}\" data-sequence=\"${index + 1}\">Choose</button></td></tr>`).join("") : "<tr><td colspan=\"4\">No marks found</td></tr>";
  document.querySelectorAll(".choose-mark").forEach(button => button.addEventListener("click", () => { selectedMark = decodeURIComponent(button.dataset.mark); selectedSequence = Number(button.dataset.sequence); loadFabricator(); }));
  $("fabricatorName").value = "";
  $("fabricatorName").disabled = !assembly?.marks.length;
  $("saveFabricator").disabled = true;
}
async function loadFabricator() {
  if (!FABRICATION_API) return;
  try {
    const response = await fetch(`${FABRICATION_API.replace(/\/$/, "")}/fabricators`);
    if (!response.ok) throw new Error(`Fabricator lookup failed (${response.status}).`);
    const names = await response.json();
    options("fabricatorName", names.length ? "Select fabricator..." : "No fabricators found", names, item => item.name, item => item.name);
    $("saveFabricator").disabled = !selectedMark || !names.length;
  } catch (error) { status(`Could not load fabricators: ${error.message}`, true); }
}
async function saveFabricator() {
  const file = ifcs.find(item => identifier(item) === $("ifcSelect").value);
  const assemblyName = $("assemblySelect").value; const mark = selectedMark; const fabricatorName = $("fabricatorName").value;
  if (!file || !assemblyName || !mark || !fabricatorName) return status("Select an assembly and mark, then enter a fabricator name.", true);
  if (!FABRICATION_API) return status("Fabrication API is not configured. Set FABRICATION_API_URL before saving.", true);
  try {
    status("Saving fabricator...");
    const response = await fetch(`${FABRICATION_API.replace(/\/$/, "")}/fabrication-records`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projectId(), projectName: project.name, fileId: file.fileId || file.id, fileName: label(file), assemblyName, mark, fabricatorName, planNo: 1, sequenceNo: selectedSequence }) });
    if (!response.ok) throw new Error(`Save failed (${response.status}).`);
    status("Fabricator saved.");
  } catch (error) { status(`Could not save fabricator: ${error.message}`, true); }
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
  return data?.items || data?.files || data?.folders || (Array.isArray(data?.data) ? data.data : []) || [];
}
function entryPath(item) {
  if (typeof item.path === "string") return item.path.replace(/\\/g, "/").replace(/\/$/, "");
  if (Array.isArray(item.path)) return `/${item.path.map(part => part.name).join("/")}`.replace(/\/$/, "");
  return String(item.fullPath || item.parentPath || "").replace(/\\/g, "/").replace(/\/$/, "");
}
function isFolderEntry(item) {
  return String(item.type || "").toLowerCase() === "folder" || isFolder(item);
}
function parentIdentifier(item) {
  return [item.activeParentId, item.parentId, item.parentFolderId].filter(Boolean).map(String);
}
function findFolder(path) {
  const name = path.split("/").filter(Boolean).pop();
  return projectEntries.find(item => isFolder(item) && entryPath(item).toLowerCase() === path.toLowerCase()) || projectEntries.find(item => isFolder(item) && label(item) === name);
}
function isChildOf(item, parent, parentPath) {
  const parentIds = entryIdentifiers(parent);
  const itemParentIds = parentIdentifier(item);
  if (itemParentIds.length) return itemParentIds.some(id => parentIds.includes(id));
  const itemPath = entryPath(item).toLowerCase();
  const normalizedParent = parentPath.replace(/\/$/, "").toLowerCase();
  if (!itemPath.startsWith(`${normalizedParent}/`)) return false;
  return !itemPath.slice(normalizedParent.length + 1).includes("/");
}
async function list(path, parentEntry = null) {
  await loadProjectEntries();
  const parent = parentEntry || findFolder(path);
  if (!parent) return [];
  return projectEntries.filter(item => item !== parent && isChildOf(item, parent, path));
}
async function loadProjectEntries() {
  if (!projectEntries.length) projectEntries = records(await request(`/sync/${encodeURIComponent(projectId())}?excludeVersion=true`));
  return projectEntries;
}
async function loadCwas() {
  try {
    status("Loading CWA folders from Completed...");
    await loadProjectEntries();
    const completed = findFolder(COMPLETED_PATH);
    if (!completed) throw new Error("The Completed folder was not found.");
    cwas = projectEntries.filter(item => item !== completed && isFolder(item) && label(item).toUpperCase() !== "CWA" && isChildOf(item, completed, COMPLETED_PATH)).sort((a,b) => label(a).localeCompare(label(b)));
    options("cwaSelect", cwas.length ? "Select CWA..." : "No folders found in Completed", cwas);
    options("ifcSelect", "Select a CWA folder first", []);
    options("assemblySelect", "Select an IFC file first", []);
    options("fabricatorName", "Select an assembly/cast unit mark first", []);
    status(cwas.length ? "Choose a CWA folder." : "No folders were found directly inside /Completed.", !cwas.length);
  } catch (error) { status(error.message, true); }
}
async function loadIfcFiles() {
  const cwa = cwas.find(item => identifier(item) === $("cwaSelect").value);
  if (!cwa) return;
  try {
    status(`Loading IFC files for ${label(cwa)}...`);
    const cwaPath = entryPath(cwa) || `${COMPLETED_PATH}/${label(cwa)}`;
    ifcs = (await list(cwaPath, cwa)).filter(isIfc).sort((a,b) => label(a).localeCompare(label(b)));
    options("ifcSelect", ifcs.length ? "Select IFC file..." : "No IFC files found", ifcs);
    options("assemblySelect", "Select an IFC file first", []);
    options("fabricatorName", "Select an assembly/cast unit mark first", []);
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
async function loadAssemblyNames() {
  const file = ifcs.find(item => identifier(item) === $("ifcSelect").value);
  if (!file) return;
  try {
    status(`Reading ASSEMBLY_NAME values from ${label(file)}...`);
    const fileId = fileIdentifier(file);
    if (!fileId) throw new Error("The selected IFC has no file ID.");
    const downloadInfo = await request(`/files/fs/${encodeURIComponent(fileId)}/downloadurl`);
    const downloadUrl = downloadInfo?.url || downloadInfo?.data?.url;
    if (!downloadUrl) throw new Error("Trimble did not return a download URL.");
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error(`File download failed (${response.status}).`);
    const text = await response.text();
    assemblies = extractIfcData(text);
    updateAssemblyControls();
    status(assemblies.length ? `${assemblies.length} ASSEMBLY_NAME group${assemblies.length === 1 ? "" : "s"} found.` : "No ASSEMBLY_NAME values were found in this IFC.", !assemblies.length);
  } catch (error) { status(`Could not read the IFC: ${error.message}`, true); }
}
$("refreshButton").addEventListener("click", loadCwas);
$("cwaSelect").addEventListener("change", loadIfcFiles);
$("ifcSelect").addEventListener("change", loadAssemblyNames);
$("assemblySelect").addEventListener("change", loadAssemblyMarks);
$("fabricatorName").addEventListener("change", () => { $("saveFabricator").disabled = !selectedMark || !$("fabricatorName").value; });
$("saveFabricator").addEventListener("click", saveFabricator);
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