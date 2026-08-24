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
  plan_no INTEGER NOT NULL DEFAULT 1,
  sequence_no INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, file_id, assembly_name, mark),
  UNIQUE (project_id, file_id, plan_no, sequence_no)
);

CREATE INDEX IF NOT EXISTS fabrication_records_project_idx ON fabrication_records (project_id);

ALTER TABLE fabrication_records ADD COLUMN IF NOT EXISTS plan_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE fabrication_records ADD COLUMN IF NOT EXISTS sequence_no INTEGER;
UPDATE fabrication_records SET sequence_no = id WHERE sequence_no IS NULL;
ALTER TABLE fabrication_records ALTER COLUMN sequence_no SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fabrication_records_sequence_idx ON fabrication_records (project_id, file_id, plan_no, sequence_no);

CREATE TABLE IF NOT EXISTS fabricators (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
