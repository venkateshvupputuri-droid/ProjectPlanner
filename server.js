const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://venkateshvupputuri-droid.github.io").split(",").map(value => value.trim());

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "64kb" }));
app.get("/health", (_request, response) => response.json({ ok: true, database: "fabricationdata" }));
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
app.listen(port, () => console.log(`Fabrication API listening on port ${port}`));
