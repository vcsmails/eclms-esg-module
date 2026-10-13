BEGIN;

CREATE SEQUENCE IF NOT EXISTS esg_asmt_seq
  AS bigint MINVALUE 1 MAXVALUE 9999999 NO CYCLE;

ALTER TABLE esg_collateral_draft_payload
  ADD COLUMN IF NOT EXISTS assessment_ref VARCHAR(14),
  ADD COLUMN IF NOT EXISTS assessment_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS esg_draft_assessment_ref_uk
  ON esg_collateral_draft_payload (assessment_ref)
  WHERE assessment_ref IS NOT NULL;

COMMIT;
