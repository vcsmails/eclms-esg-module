BEGIN;

CREATE TABLE IF NOT EXISTS esg_collateral_draft_payload (
  coll_id VARCHAR(50) PRIMARY KEY REFERENCES coll_master(coll_id) ON DELETE CASCADE,
  coll_type VARCHAR(20) NOT NULL,
  form_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  signed_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_saved_by VARCHAR(50) DEFAULT 'SYSTEM_MAKER',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
