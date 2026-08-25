const COMPLETED_PATH = "/Completed";
const ORIGINS = ["https://app.connect.trimble.com","https://app21.connect.trimble.com","https://app31.connect.trimble.com","https://app32.connect.trimble.com","https://app22.connect.trimble.com"];
let workspace, token, project, origin, cwas = [], ifcs = [], projectEntries = [];
const ERECTION_API = window.ERECTION_PLANNER_API_BASE || "https://followed-recruiting-album-noted.trycloudflare.com/api";
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
let assemblies = [], selectedMark = "", selectedPlan = 0, selectedSequence = 0, savedAssignments = [], markMetrics = new Map();
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
  markMetrics = new Map();
  const entities = new Map(); const properties = new Map(); const relations = [];
  const entityPattern = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([^;]*?)\)\s*;/gis;
  let match;
  while ((match = entityPattern.exec(text))) entities.set(`#${match[1]}`, { type: match[2].toUpperCase(), args: splitIfcArguments(match[3]) });
  for (const [id, entity] of entities) {
    if (entity.type === "IFCPROPERTYSINGLEVALUE") {
      const name = ifcString(entity.args[0]);
      const valueText = entity.args.slice(2).join(",");
      const valueMatch = valueText.match(/IFC(?:LABEL|TEXT|IDENTIFIER)\s*\(\s*'((?:''|[^'])*)'/i) || valueText.match(/IFC(?:INTEGER|REAL|NUMBER|COUNTMEASURE|MASSMEASURE)\s*\(\s*([^\)]+)\)/i);
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
    const quantity = Number(values.QUANTITY || values.QTY || values.COUNT || values.CASTUNITQUANTITY || 0) || 0;
    const weight = Number(String(values.ASSEMBLYCASTUNITWEIGHT || values.CASTUNITWEIGHT || values.ASSEMBLYWEIGHT || values.WEIGHT || 0).replace(/[^0-9.-]/g, "")) || 0;
    if (assemblyName && mark) { markMetrics.set(`${assemblyName}|${mark}`, { quantity, weight }); result.push({ id, type: entity.type, assemblyName, mark }); }
  }
  const grouped = new Map();
  for (const item of result) { if (!grouped.has(item.assemblyName)) grouped.set(item.assemblyName, new Map()); const existing = grouped.get(item.assemblyName).get(item.mark) || { mark: item.mark, quantity: 0, weight: 0 }; existing.quantity += item.quantity || 1; existing.weight += item.weight; grouped.get(item.assemblyName).set(item.mark, existing); }
  return [...grouped].map(([assemblyName, marks]) => ({ assemblyName, marks: [...marks.values()].sort((a, b) => a.mark.localeCompare(b.mark)) })).sort((a, b) => a.assemblyName.localeCompare(b.assemblyName));
}
function updateAssemblyControls() {
  options("assemblySelect", assemblies.length ? "Select ASSEMBLY_NAME..." : "No ASSEMBLY_NAME values found", assemblies, item => item.assemblyName, item => item.assemblyName);
  $("markRows").innerHTML = "<tr><td colspan=\"5\">Select an ASSEMBLY_NAME first</td></tr>";
}
function qrUrl(mark, saved) { const params = new URLSearchParams({ scan: "1", projectId: projectId() || "", fileId: $("ifcSelect").value || "", assemblyName: $("assemblySelect").value || "", mark, quantity: saved?.quantity ?? "", weight: saved?.weight ?? "", modelId: saved?.ModelId || "", assemblyGuid: saved?.AssemblyGuid || "", planId: saved?.PlanId || "", sequenceOrder: saved?.SequenceOrder || "" }); return `${window.location.origin}${window.location.pathname}?${params}`; }
function printQr(url) { const popup = window.open("", "_blank", "width=420,height=520"); if (!popup) return; popup.document.write(`<title>Assembly QR code</title><p>${url}</p><div id="qr"></div><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script><script>new QRCode(document.getElementById('qr'),{text:${JSON.stringify(url)},width:260,height:260});window.onload=()=>window.print();<\/script>`); popup.document.close(); }
async function loadScanDetails() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("scan") !== "1") return;
  $("scanPanel").hidden = false;
  $("scanIdentity").textContent = `${params.get("assemblyName") || ""} / ${params.get("mark") || ""}`;
  $("scanQuantity").value = params.get("quantity") || "";
  $("scanWeight").value = params.get("weight") || "";
  if (!FABRICATION_API) return;
  try {
    const response = await fetch(`${FABRICATION_API.replace(/\/$/, "")}/fabrication-details?${params}`);
    if (!response.ok) throw new Error(`Fabrication lookup failed (${response.status}).`);
    const details = await response.json();
    $("scanFabricator").value = details.fabricator_name || "";
    $("scanCompletionDate").value = details.completion_date ? details.completion_date.slice(0, 10) : "";
    $("scanQuantity").value = details.quantity ?? params.get("quantity") ?? "";
    $("scanWeight").value = details.weight ?? params.get("weight") ?? "";
  } catch (error) { status(`Could not load fabrication details: ${error.message}`, true); }
}
async function saveScanDetails() {
  if (!FABRICATION_API) return status("Fabrication API is not configured.", true);
  const params = new URLSearchParams(window.location.search);
  const body = { projectId: params.get("projectId"), fileId: params.get("fileId"), assemblyName: params.get("assemblyName"), mark: params.get("mark"), modelId: params.get("modelId"), assemblyGuid: params.get("assemblyGuid"), planId: params.get("planId"), sequenceOrder: params.get("sequenceOrder"), fabricatorName: $("scanFabricator").value.trim(), completionDate: $("scanCompletionDate").value || null, quantity: Number($("scanQuantity").value), weight: Number($("scanWeight").value) };
  if (!body.fabricatorName || !Number.isFinite(body.quantity) || !Number.isFinite(body.weight)) return status("Enter fabricator, quantity, and weight.", true);
  try {
    const response = await fetch(`${FABRICATION_API.replace(/\/$/, "")}/fabrication-details`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Fabrication update failed (${response.status}).`);
    status("Fabrication details updated.");
  } catch (error) { status(`Could not update fabrication details: ${error.message}`, true); }
}
async function loadAssignments() {
  savedAssignments = [];
  const file = ifcs.find(item => identifier(item) === $("ifcSelect").value);
  if (!file) return;
  try {
    const loadedModels = await workspace.viewer.getModels("loaded");
    const model = loadedModels.find(item => item.id === file.modelId || item.name === label(file) || item.name?.replace(/\.ifc$/i, "") === label(file).replace(/\.ifc$/i, ""));
    const modelId = model?.id || file.modelId;
    if (!modelId) throw new Error("The selected IFC is not loaded in the 3D Viewer.");
    const base = ERECTION_API.replace(/\/$/, "");
    let plansResponse = await fetch(`${base}/projects/${encodeURIComponent(projectId())}/models/${encodeURIComponent(modelId)}/plans`, { headers: { authorization: `Bearer ${token}` } });
    if (plansResponse.status === 404) plansResponse = await fetch(`${base}/projects/${encodeURIComponent(projectId())}/plans`, { headers: { authorization: `Bearer ${token}` } });
    if (!plansResponse.ok) throw new Error(`Erection plan lookup failed (${plansResponse.status}).`);
    const plans = records(await plansResponse.json());
    const rows = (await Promise.all(plans.map(async plan => {
      const planId = plan.PlanId || plan.planId || plan.id;
      const response = await fetch(`${base}/plans/${encodeURIComponent(planId)}/assemblies`, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.error || detail.message || `Assembly assignment lookup failed (${response.status}).`); }
      return records(await response.json()).map(row => { const planNumber = row.PlanNumber ?? row.planNumber ?? row.plan_no ?? plan.PlanNumber ?? plan.planNumber ?? plan.plan_no; const sequenceOrder = row.SequenceOrder ?? row.sequenceOrder ?? row.sequence_no; return { ...row, ModelId: row.ModelId || row.modelId || modelId, AssemblyGuid: row.AssemblyGuid || row.assemblyGuid || row.GlobalId || row.globalId || row.assembly_guid, AssemblyName: row.AssemblyName || row.assemblyName || row.assembly_name, AssemblyMark: row.AssemblyMark || row.assemblyMark || row.mark, PlanId: row.PlanId || row.planId || row.plan_id || planId, PlanNumber: planNumber, SequenceOrder: sequenceOrder, plan_no: Number(planNumber), sequence_no: Number(sequenceOrder), sequenceCode: row.SequenceCode || row.sequenceCode || `${planNumber}-${sequenceOrder}` }; });
    }))).flat();
    savedAssignments = rows.filter(row => row.AssemblyMark || row.assemblyMark || row.mark);
  } catch (error) { const message = error instanceof Error ? error.message : error?.error || error?.message || String(error); status(`Could not load assigned sequence numbers: ${message || "Unknown error"}`, true); }
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
  return data?.items || data?.records || data?.files || data?.folders || data?.plans || data?.assemblies || (Array.isArray(data?.data) ? data.data : data?.data?.items || data?.data?.records || data?.data?.assemblies || []) || [];
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
async function loadAssemblyMarks() {
  const assembly = assemblies.find(item => item.assemblyName === $("assemblySelect").value);
  const marks = assembly?.marks || [];
  await loadAssignments();
  const rowData = marks.map(markEntry => { const mark = typeof markEntry === "string" ? markEntry : markEntry.mark; const metrics = typeof markEntry === "string" ? markMetrics.get(`${assembly.assemblyName}|${mark}`) || {} : markEntry; const assignment = savedAssignments.find(item => (item.AssemblyMark || item.assemblyMark || item.mark) === mark && (!(item.AssemblyName || item.assemblyName || item.assembly_name) || (item.AssemblyName || item.assemblyName || item.assembly_name) === assembly.assemblyName)); return { ...assignment, mark, quantity: metrics.quantity ?? assignment?.quantity, weight: metrics.weight ?? assignment?.weight }; });
  $("markRows").innerHTML = rowData.length ? rowData.map(item => { const qrData = qrUrl(item.mark, item); const weight = Number(item.weight); return `<tr><td>${item.mark}</td><td>${item.quantity ?? ""}</td><td>${Number.isFinite(weight) && weight ? `${weight.toFixed(3)} t` : ""}</td><td><div class="qr-code" id="qr-${encodeURIComponent(item.mark)}"></div></td><td><button type="button" class="print-qr" data-qr="${encodeURIComponent(qrData)}">Print</button></td></tr>`; }).join("") : "<tr><td colspan=\"5\">No marks found</td></tr>";
  rowData.forEach(item => { const node = $("qr-" + encodeURIComponent(item.mark)); if (node && window.QRCode) new QRCode(node, { text: qrUrl(item.mark, item), width: 72, height: 72 }); else if (node) node.textContent = "QR unavailable"; });
  document.querySelectorAll(".print-qr").forEach(button => button.addEventListener("click", () => printQr(decodeURIComponent(button.dataset.qr))));
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
$("saveScan")?.addEventListener("click", saveScanDetails);
loadScanDetails();
(async () => {
  if (new URLSearchParams(window.location.search).get("scan") === "1") return;
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