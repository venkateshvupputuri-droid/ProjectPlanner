const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://venkateshvupputuri-droid.github.io").split(",").map(value => value.trim());
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
    callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"]
};

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fabrication_details (
      id BIGSERIAL PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      model_id TEXT,
      assembly_guid TEXT,
      assembly_name TEXT NOT NULL,
      mark TEXT NOT NULL,
      plan_id TEXT,
      sequence_order INTEGER,
      fabricator_name TEXT NOT NULL,
      completion_date DATE,
      quantity NUMERIC(12, 3) NOT NULL,
      weight NUMERIC(12, 3) NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (project_id, file_id, assembly_name, mark)
    );
    CREATE TABLE IF NOT EXISTS fabricators (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "64kb" }));
app.get("/health", (_request, response) => response.json({ ok: true, database: "fabricationdata" }));
app.get("/fabrication-details", async (request, response) => {
  try {
    const result = await pool.query("SELECT * FROM fabrication_details WHERE project_id = $1 AND file_id = $2 AND assembly_name = $3 AND mark = $4", [request.query.projectId, request.query.fileId, request.query.assemblyName, request.query.mark]);
    response.json(result.rows[0] || {});
  } catch (error) { console.error(error); response.status(500).json({ error: "Could not read fabrication details." }); }
});
app.get("/fabrication-details/list", async (request, response) => {
  try {
    const values = [String(request.query.projectId || "")];
    let query = "SELECT * FROM fabrication_details WHERE project_id = $1";
    if (request.query.fileId) { values.push(String(request.query.fileId)); query += " AND file_id = $2"; }
    if (request.query.assemblyName) { values.push(String(request.query.assemblyName)); query += " AND assembly_name = $3"; }
    if (request.query.mark) { values.push(String(request.query.mark)); query += " AND mark = $4"; }
    query += " ORDER BY updated_at DESC, assembly_name, mark";
    const result = await pool.query(query, values);
    response.json(result.rows);
  } catch (error) { console.error(error); response.status(500).json({ error: "Could not list fabrication details." }); }
});
app.put("/fabrication-details", async (request, response) => {
  const { projectId, fileId, modelId, assemblyGuid, assemblyName, mark, planId, sequenceOrder, fabricatorName, completionDate, quantity, weight } = request.body || {};
  if (![projectId, fileId, assemblyName, mark, fabricatorName].every(value => typeof value === "string" && value.trim()) || !Number.isFinite(quantity) || !Number.isFinite(weight)) return response.status(400).json({ error: "Required fabrication details are missing." });
  try {
    const result = await pool.query(`INSERT INTO fabrication_details (project_id, file_id, model_id, assembly_guid, assembly_name, mark, plan_id, sequence_order, fabricator_name, completion_date, quantity, weight) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (project_id, file_id, assembly_name, mark) DO UPDATE SET model_id=EXCLUDED.model_id, assembly_guid=EXCLUDED.assembly_guid, plan_id=EXCLUDED.plan_id, sequence_order=EXCLUDED.sequence_order, fabricator_name=EXCLUDED.fabricator_name, completion_date=EXCLUDED.completion_date, quantity=EXCLUDED.quantity, weight=EXCLUDED.weight, updated_at=NOW() RETURNING *`, [projectId.trim(), fileId.trim(), modelId || null, assemblyGuid || null, assemblyName.trim(), mark.trim(), planId || null, Number.isInteger(sequenceOrder) ? sequenceOrder : null, fabricatorName.trim(), completionDate || null, quantity, weight]);
    response.json(result.rows[0]);
  } catch (error) { console.error(error); response.status(500).json({ error: "Could not update fabrication details." }); }
});
app.get("/fabricators", async (_request, response) => {
  try {
    const result = await pool.query("SELECT id, name FROM fabricators WHERE active = TRUE ORDER BY name");
    response.json(result.rows);
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: "Could not read fabricators." });
  }
});
app.put("/fabrication-records", async (request, response) => {
  const { projectId, projectName, fileId, fileName, assemblyName, mark, fabricatorName, planNo = 1, sequenceNo } = request.body || {};
  if (![projectId, fileId, fileName, assemblyName, mark, fabricatorName].every(value => typeof value === "string" && value.trim()) || !Number.isInteger(planNo) || !Number.isInteger(sequenceNo)) return response.status(400).json({ error: "All fabrication fields and sequence values are required." });
  try {
    const result = await pool.query(`
      INSERT INTO fabrication_records (project_id, project_name, file_id, file_name, assembly_name, mark, fabricator_name, plan_no, sequence_no)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (project_id, file_id, assembly_name, mark)
      DO UPDATE SET project_name = EXCLUDED.project_name, file_name = EXCLUDED.file_name, fabricator_name = EXCLUDED.fabricator_name, plan_no = EXCLUDED.plan_no, sequence_no = EXCLUDED.sequence_no, updated_at = NOW()
      RETURNING *
    `, [projectId.trim(), projectName?.trim() || null, fileId.trim(), fileName.trim(), assemblyName.trim(), mark.trim(), fabricatorName.trim(), planNo, sequenceNo]);
    response.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: "Could not save fabrication data." });
  }
});
app.get("/fabrication-records", async (request, response) => {
  try {
    const values = [String(request.query.projectId || "")];
    let query = "SELECT * FROM fabrication_records WHERE project_id = $1";
    if (request.query.fileId) { values.push(String(request.query.fileId)); query += " AND file_id = $2"; }
    query += " ORDER BY plan_no, sequence_no, assembly_name, mark";
    const result = await pool.query(query, values);
    response.json(result.rows);
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: "Could not read fabrication data." });
  }
});

const port = Number(process.env.PORT || 3000);
initializeDatabase().then(() => app.listen(port, () => console.log(`Fabrication API listening on port ${port}`))).catch(error => { console.error("Database initialization failed", error); process.exitCode = 1; });
