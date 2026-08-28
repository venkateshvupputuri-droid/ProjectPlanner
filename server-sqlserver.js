const express = require("express");
const cors = require("cors");
const sql = require("mssql/msnodesqlv8");

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*").split(",").map(value => value.trim());
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
    callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"]
};
const config = {
  server: process.env.SQL_SERVER || "DESKTOP-MJI8OIQ\\SQLEXPRESS",
  database: process.env.SQL_DATABASE || "ErectionPlanner",
  connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=${process.env.SQL_SERVER || "DESKTOP-MJI8OIQ\\SQLEXPRESS"};Database=${process.env.SQL_DATABASE || "ErectionPlanner"};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,
  options: {
    trustedConnection: true,
    trustServerCertificate: true,
    enableArithAbort: true
  }
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "64kb" }));
const poolPromise = sql.connect(config);
const apiRecord = row => row ? ({ project_id: row.ProjectId, file_id: row.FileId, model_id: row.ModelId, assembly_guid: row.AssemblyGuid, assembly_name: row.AssemblyName, mark: row.Mark, plan_id: row.PlanId, sequence_order: row.SequenceOrder, fabricator_name: row.FabricatorName, completion_date: row.CompletionDate, quantity: row.Quantity, weight: row.Weight, updated_at: row.UpdatedAt }) : {};

async function initializeDatabase() {
  const pool = await poolPromise;
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.FabricationDetails', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.FabricationDetails (
        Id BIGINT IDENTITY(1,1) PRIMARY KEY,
        ProjectId NVARCHAR(255) NOT NULL,
        FileId NVARCHAR(255) NOT NULL,
        ModelId NVARCHAR(255) NULL,
        AssemblyGuid NVARCHAR(255) NULL,
        AssemblyName NVARCHAR(255) NOT NULL,
        Mark NVARCHAR(255) NOT NULL,
        PlanId NVARCHAR(255) NULL,
        SequenceOrder INT NULL,
        FabricatorName NVARCHAR(255) NOT NULL,
        CompletionDate DATE NULL,
        Quantity DECIMAL(12,3) NOT NULL,
        Weight DECIMAL(12,3) NOT NULL,
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_FabricationDetails UNIQUE (ProjectId, FileId, AssemblyName, Mark)
      );
    END
  `);
}

app.get("/health", async (_request, response) => {
  try { await poolPromise; response.json({ ok: true, database: config.database, server: config.server }); }
  catch (error) { response.status(500).json({ ok: false, error: error.message }); }
});

app.get("/fabrication-details", async (request, response) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input("projectId", sql.NVarChar, request.query.projectId || "")
      .input("fileId", sql.NVarChar, request.query.fileId || "")
      .input("assemblyName", sql.NVarChar, request.query.assemblyName || "")
      .input("mark", sql.NVarChar, request.query.mark || "")
      .query("SELECT TOP 1 * FROM dbo.FabricationDetails WHERE ProjectId=@projectId AND FileId=@fileId AND AssemblyName=@assemblyName AND Mark=@mark");
    response.json(apiRecord(result.recordset[0]));
  } catch (error) { console.error(error); response.status(500).json({ error: "Could not read fabrication details." }); }
});

app.get("/fabrication-details/list", async (request, response) => {
  try {
    const pool = await poolPromise;
    const query = pool.request()
      .input("projectId", sql.NVarChar, request.query.projectId || "");
    let sqlText = "SELECT * FROM dbo.FabricationDetails WHERE ProjectId=@projectId";
    if (request.query.fileId) { query.input("fileId", sql.NVarChar, request.query.fileId); sqlText += " AND FileId=@fileId"; }
    if (request.query.assemblyName) { query.input("assemblyName", sql.NVarChar, request.query.assemblyName); sqlText += " AND AssemblyName=@assemblyName"; }
    if (request.query.mark) { query.input("mark", sql.NVarChar, request.query.mark); sqlText += " AND Mark=@mark"; }
    sqlText += " ORDER BY AssemblyName, Mark";
    const result = await query.query(sqlText);
    response.json(result.recordset.map(apiRecord));
  } catch (error) { console.error(error); response.status(500).json({ error: "Could not list fabrication details." }); }
});

app.put("/fabrication-details", async (request, response) => {
  const body = request.body || {};
  if (![body.projectId, body.fileId, body.assemblyName, body.mark, body.fabricatorName].every(value => typeof value === "string" && value.trim()) || !Number.isFinite(body.quantity) || !Number.isFinite(body.weight)) return response.status(400).json({ error: "Required fabrication details are missing." });
  try {
    const pool = await poolPromise;
    const requestDb = pool.request();
    for (const [name, type, value] of [["projectId", sql.NVarChar, body.projectId], ["fileId", sql.NVarChar, body.fileId], ["modelId", sql.NVarChar, body.modelId || null], ["assemblyGuid", sql.NVarChar, body.assemblyGuid || null], ["assemblyName", sql.NVarChar, body.assemblyName], ["mark", sql.NVarChar, body.mark], ["planId", sql.NVarChar, body.planId || null], ["fabricatorName", sql.NVarChar, body.fabricatorName], ["completionDate", sql.Date, body.completionDate || null], ["quantity", sql.Decimal(12, 3), body.quantity], ["weight", sql.Decimal(12, 3), body.weight]]) requestDb.input(name, type, value);
    requestDb.input("sequenceOrder", sql.Int, Number.isInteger(body.sequenceOrder) ? body.sequenceOrder : null);
    const result = await requestDb.query(`MERGE dbo.FabricationDetails AS target USING (SELECT @projectId ProjectId, @fileId FileId, @assemblyName AssemblyName, @mark Mark) AS source ON target.ProjectId=source.ProjectId AND target.FileId=source.FileId AND target.AssemblyName=source.AssemblyName AND target.Mark=source.Mark WHEN MATCHED THEN UPDATE SET ModelId=@modelId, AssemblyGuid=@assemblyGuid, PlanId=@planId, SequenceOrder=@sequenceOrder, FabricatorName=@fabricatorName, CompletionDate=@completionDate, Quantity=@quantity, Weight=@weight, UpdatedAt=SYSUTCDATETIME() WHEN NOT MATCHED THEN INSERT (ProjectId,FileId,ModelId,AssemblyGuid,AssemblyName,Mark,PlanId,SequenceOrder,FabricatorName,CompletionDate,Quantity,Weight) VALUES (@projectId,@fileId,@modelId,@assemblyGuid,@assemblyName,@mark,@planId,@sequenceOrder,@fabricatorName,@completionDate,@quantity,@weight) OUTPUT INSERTED.*;`);
    response.json(apiRecord(result.recordset[0]));
  } catch (error) { console.error(error); response.status(500).json({ error: "Could not save fabrication details." }); }
});

initializeDatabase().then(() => app.listen(port, () => console.log(`SQL Server fabrication API listening on ${port}`))).catch(error => { console.error("SQL Server initialization failed", error); process.exitCode = 1; });