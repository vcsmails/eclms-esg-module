-- Migration: 030-create-esg-assessment-ledger.sql
-- Purpose: Create assessment ledger table for persisting ESG scoring results
-- Created: 2026-10-11

CREATE TABLE IF NOT EXISTS esg_assessment_ledger (
  assessment_id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  coll_id VARCHAR(50) NOT NULL,
  coll_type VARCHAR(20) NOT NULL,
  model_version VARCHAR(20) NOT NULL,
  env_score NUMERIC(5,2),
  soc_score NUMERIC(5,2),
  gov_score NUMERIC(5,2),
  composite_score NUMERIC(5,2) NOT NULL,
  esg_grade VARCHAR(10) NOT NULL,
  risk_category VARCHAR(30) NOT NULL,
  haircut_pct NUMERIC(5,2) NOT NULL,
  flowable_proc_inst_id VARCHAR(64),
  flowable_decision_id VARCHAR(64),
  raw_responses JSONB NOT NULL,
  assessment_status VARCHAR(20) DEFAULT 'SCORED',
  assessed_by VARCHAR(50) DEFAULT 'SYSTEM_MAKER',
  assessed_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Composite index for collateral lookups
CREATE INDEX IF NOT EXISTS idx_esg_assessment_coll_id ON esg_assessment_ledger(coll_id ASC);

-- Index for recent assessments
CREATE INDEX IF NOT EXISTS idx_esg_assessment_assessed_at ON esg_assessment_ledger(assessed_at DESC);

-- Composite index for audit queries
CREATE INDEX IF NOT EXISTS idx_esg_assessment_coll_type_status ON esg_assessment_ledger(coll_type ASC, assessment_status ASC);

-- Allow updates to metadata
ALTER TABLE esg_assessment_ledger ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE esg_assessment_ledger IS 'ESG Assessment Ledger: Stores scoring results including component scores (E/S/G), composite score, grade, and Flowable decision/process references.';
COMMENT ON COLUMN esg_assessment_ledger.assessment_id IS 'Unique assessment identifier (UUID).';
COMMENT ON COLUMN esg_assessment_ledger.coll_id IS 'Collateral/Asset identifier (property, manufacturing plant, vehicle, etc.).';
COMMENT ON COLUMN esg_assessment_ledger.coll_type IS 'Collateral type: PROP, MANU, VEH, MKT.';
COMMENT ON COLUMN esg_assessment_ledger.model_version IS 'ESG scoring model version (e.g., PROP_ESG_V1.0).';
COMMENT ON COLUMN esg_assessment_ledger.env_score IS 'Environmental pillar score (0-100).';
COMMENT ON COLUMN esg_assessment_ledger.soc_score IS 'Social pillar score (0-100).';
COMMENT ON COLUMN esg_assessment_ledger.gov_score IS 'Governance pillar score (0-100).';
COMMENT ON COLUMN esg_assessment_ledger.composite_score IS 'Weighted composite ESG score (0-100).';
COMMENT ON COLUMN esg_assessment_ledger.esg_grade IS 'Assigned ESG grade (AAA, AA, A, BBB, C).';
COMMENT ON COLUMN esg_assessment_ledger.risk_category IS 'Risk category: VERY_LOW_RISK, LOW_RISK, MODERATE_RISK, ELEVATED_RISK, CRITICAL_RISK.';
COMMENT ON COLUMN esg_assessment_ledger.haircut_pct IS 'Haircut percentage (valuation impact).';
COMMENT ON COLUMN esg_assessment_ledger.flowable_proc_inst_id IS 'Flowable process instance ID (if workflow was triggered).';
COMMENT ON COLUMN esg_assessment_ledger.flowable_decision_id IS 'Flowable decision execution ID.';
COMMENT ON COLUMN esg_assessment_ledger.raw_responses IS 'Original form responses (JSONB) for audit trail.';
COMMENT ON COLUMN esg_assessment_ledger.assessment_status IS 'Status: SCORED, APPROVED, REJECTED, ESCALATED.';
COMMENT ON COLUMN esg_assessment_ledger.assessed_by IS 'User/system identifier who performed the assessment.';
COMMENT ON COLUMN esg_assessment_ledger.assessed_at IS 'Timestamp when assessment was performed.';
