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
  const { projectId, projectName, fileId, fileName, assemblyName, mark, fabricatorName } = request.body || {};
  if (![projectId, fileId, fileName, assemblyName, mark, fabricatorName].every(value => typeof value === "string" && value.trim())) return response.status(400).json({ error: "All fabrication fields are required." });
  try {
    const result = await pool.query(`
      INSERT INTO fabrication_records (project_id, project_name, file_id, file_name, assembly_name, mark, fabricator_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (project_id, file_id, assembly_name, mark)
      DO UPDATE SET project_name = EXCLUDED.project_name, file_name = EXCLUDED.file_name, fabricator_name = EXCLUDED.fabricator_name, updated_at = NOW()
      RETURNING *
    `, [projectId.trim(), projectName?.trim() || null, fileId.trim(), fileName.trim(), assemblyName.trim(), mark.trim(), fabricatorName.trim()]);
    response.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: "Could not save fabrication data." });
  }
});
app.get("/fabrication-records", async (request, response) => {
  try {
    const result = await pool.query("SELECT * FROM fabrication_records WHERE project_id = $1 ORDER BY assembly_name, mark", [String(request.query.projectId || "")]);
    response.json(result.rows);
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: "Could not read fabrication data." });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Fabrication API listening on port ${port}`));
