# Project Planner

A read-only Trimble Connect **Project** extension. It adds **Project Planner** to the left navigation and lets users choose a CWA folder below `/Completed`, an IFC file in that folder, and a Product Name parsed from that IFC.

## Deploy and install

1. Publish this repository with GitHub Pages from the `main` branch, root folder.
2. In Trimble Connect open the target project as a Project Administrator.
3. Go to **Settings ? Apps & Capabilities ? Add Custom**.
4. Enter `https://venkateshvupputuri-droid.github.io/ProjectPlanner/manifest.json`.
5. Enable Project Planner and approve the access-token permission on first use.

The extension does not modify Trimble files or the existing Erection Sequence Planner extension.

## Fabrication database

The frontend extracts `ASSEMBLY_NAME` groups and assembly/cast unit marks from the selected IFC. Fabricator assignments are saved by the API in PostgreSQL database `fabricationdata`.

1. Create the database and table with `psql -f schema.sql`.
2. Install the API dependencies with `npm install`.
3. Copy `.env.example` to `.env` and set `DATABASE_URL` to the `fabricationdata` database.
4. Start the API with `npm start`.
5. Set `window.FABRICATION_API_URL` before `app.js` loads to the deployed API URL. GitHub Pages cannot host the API or PostgreSQL database.

Each assembly mark row generates a QR code. Scanning it opens a fabrication update form for that exact project, IFC, assembly, and mark. The form stores fabricator name, completion date, quantity, and weight in `fabrication_details`.

## Local SQL Server mode

The Render API uses PostgreSQL. To save directly to a local SQL Server instance using Windows Authentication, run `npm install` and then `npm run start:sqlserver` on the Windows machine that can access `DESKTOP-MJI8OIQ\SQLEXPRESS`. The API creates `ErectionPlanner.dbo.FabricationDetails` automatically. Set `SQL_SERVER`, `SQL_DATABASE`, `PORT`, and `ALLOWED_ORIGINS` if the defaults do not apply.

For mobile access, expose the local port with Cloudflare Tunnel, for example `cloudflared tunnel --url http://localhost:3000`, then configure that HTTPS URL as `window.FABRICATION_API_URL` before `app.js` loads. The computer, SQL Server, API, and tunnel must remain running while mobile updates are being saved.