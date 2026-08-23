CREATE DATABASE fabricationdata;

\connect fabricationdata;

CREATE TABLE IF NOT EXISTS fabrication_records (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  project_name TEXT,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  assembly_name TEXT NOT NULL,
  mark TEXT NOT NULL,
  fabricator_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, file_id, assembly_name, mark)
);

CREATE INDEX IF NOT EXISTS fabrication_records_project_idx ON fabrication_records (project_id);

CREATE TABLE IF NOT EXISTS fabricators (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
