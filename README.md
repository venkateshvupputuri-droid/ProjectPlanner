# Project Planner

A read-only Trimble Connect **Project** extension. It adds **Project Planner** to the left navigation and lets users choose a CWA folder below `/Completed`, an IFC file in that folder, and a Product Name parsed from that IFC.

## Deploy and install

1. Publish this repository with GitHub Pages from the `main` branch, root folder.
2. In Trimble Connect open the target project as a Project Administrator.
3. Go to **Settings ? Apps & Capabilities ? Add Custom**.
4. Enter `https://venkateshvupputuri-droid.github.io/ProjectPlanner/manifest.json`.
5. Enable Project Planner and approve the access-token permission on first use.

The extension does not modify Trimble files or the existing Erection Sequence Planner extension.