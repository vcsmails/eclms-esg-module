--
-- PostgreSQL database dump
--

\restrict HKNfZDhJaxwjAuxRYXlR1Wuufs4FjTAL75gEwBwgxOICraZnFxFSdlMMn7ZtwQb

-- Dumped from database version 17.11 (Homebrew)
-- Dumped by pg_dump version 17.11 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: coll_esg_asmt_base; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.coll_esg_asmt_base (
    rec_id character varying(36) DEFAULT gen_random_uuid() NOT NULL,
    assessment_id character varying(36) NOT NULL,
    collateral_id character varying(16) NOT NULL,
    coll_type_mstr character varying(20) DEFAULT 'COLL_TYPE'::character varying NOT NULL,
    coll_type character varying(20) NOT NULL,
    assessment_version integer DEFAULT 1 NOT NULL,
    asmt_type_mstr character varying(20) DEFAULT 'ASMT_TYPE'::character varying NOT NULL,
    assessment_type character varying(20) NOT NULL,
    asmt_stat_mstr character varying(20) DEFAULT 'ESG_ASSMNT'::character varying NOT NULL,
    assessment_status character varying(20) DEFAULT 'DEF'::character varying NOT NULL,
    assessment_date date DEFAULT CURRENT_DATE NOT NULL,
    template_id character varying(32),
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date DEFAULT '2099-12-31'::date NOT NULL,
    created_by character varying(64) DEFAULT 'SYSTEM_MAKER'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    checked_by character varying(64),
    checked_at timestamp without time zone,
    approved_by character varying(64),
    approved_at timestamp without time zone,
    effective_date date,
    scoring_model_ver character varying(32),
    haircut_matrix_ver character varying(32),
    data_freshness_stat character varying(32) DEFAULT 'CURRENT'::character varying NOT NULL,
    completeness_pct numeric(5,2) DEFAULT 0.00 NOT NULL
);


ALTER TABLE public.coll_esg_asmt_base OWNER TO postgres;

--
-- Name: coll_master; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.coll_master (
    rec_id character varying(36) DEFAULT gen_random_uuid() NOT NULL,
    coll_id character varying(16) NOT NULL,
    collateral_name character varying(64) NOT NULL,
    coll_type_mstr character varying(20) DEFAULT 'COLL_TYPE'::character varying NOT NULL,
    coll_type character varying(20) NOT NULL,
    esg_flag character(1) NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date DEFAULT '2099-12-31'::date NOT NULL,
    esg_haircut_pct numeric(5,2) DEFAULT 0.00,
    esg_post_haircut_val numeric(18,2),
    last_esg_assessment_id uuid,
    CONSTRAINT coll_master_tmp_esg_flag_check CHECK ((esg_flag = ANY (ARRAY['Y'::bpchar, 'N'::bpchar])))
);


ALTER TABLE public.coll_master OWNER TO postgres;

--
-- Name: coll_prop_env_info; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.coll_prop_env_info (
    rec_id character varying(36) DEFAULT gen_random_uuid() NOT NULL,
    assessment_id character varying(36) NOT NULL,
    collateral_id character varying(16) NOT NULL,
    green_bldg_cert_yn character(1) DEFAULT 'N'::bpchar NOT NULL,
    cert_type_mstr character varying(20) DEFAULT 'CERT_TYPE'::character varying NOT NULL,
    cert_type_code character varying(20),
    cert_level_mstr character varying(20) DEFAULT 'CERT_LEVEL'::character varying NOT NULL,
    cert_rating_level character varying(20),
    cert_number character varying(64),
    cert_valid_to date,
    ee_rating_mstr character varying(20) DEFAULT 'EE_RATING'::character varying NOT NULL,
    energy_efficiency_ratg character varying(20) DEFAULT 'NONE'::character varying NOT NULL,
    renewable_eng_yn character(1) DEFAULT 'N'::bpchar NOT NULL,
    ren_type_mstr character varying(20) DEFAULT 'REN_TYPE'::character varying NOT NULL,
    renewable_type character varying(20),
    renewable_capacity_kw numeric(10,2),
    rainwater_harvest_yn character(1) DEFAULT 'N'::bpchar NOT NULL,
    wastewater_treat_yn character(1) DEFAULT 'N'::bpchar NOT NULL,
    water_stress_mstr character varying(20) DEFAULT 'WATER_STRESS'::character varying NOT NULL,
    water_stress_ratg character varying(20) DEFAULT 'LOW'::character varying NOT NULL,
    hazardous_mat_yn character(1) DEFAULT 'N'::bpchar NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date DEFAULT '2099-12-31'::date NOT NULL,
    created_by character varying(64) DEFAULT 'SYSTEM_MAKER'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    checked_by character varying(64),
    checked_at timestamp without time zone,
    CONSTRAINT coll_prop_env_info_green_bldg_cert_yn_check CHECK ((green_bldg_cert_yn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT coll_prop_env_info_hazardous_mat_yn_check CHECK ((hazardous_mat_yn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT coll_prop_env_info_rainwater_harvest_yn_check CHECK ((rainwater_harvest_yn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT coll_prop_env_info_renewable_eng_yn_check CHECK ((renewable_eng_yn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT coll_prop_env_info_wastewater_treat_yn_check CHECK ((wastewater_treat_yn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar, 'X'::bpchar])))
);


ALTER TABLE public.coll_prop_env_info OWNER TO postgres;

--
-- Name: coll_prop_env_obsv; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.coll_prop_env_obsv (
    rec_id character varying(36) DEFAULT gen_random_uuid() NOT NULL,
    assessment_id character varying(36) NOT NULL,
    collateral_id character varying(16) NOT NULL,
    reporting_year character varying(9) NOT NULL,
    annual_elec_kwh numeric(14,2),
    annual_water_kl numeric(14,2),
    waste_recycle_pct numeric(5,2),
    carbon_emission_est numeric(12,2),
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date DEFAULT '2099-12-31'::date NOT NULL,
    created_by character varying(64) DEFAULT 'SYSTEM_MAKER'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    checked_by character varying(64),
    checked_at timestamp without time zone,
    CONSTRAINT coll_prop_env_obsv_waste_recycle_pct_check CHECK (((waste_recycle_pct >= 0.00) AND (waste_recycle_pct <= 100.00)))
);


ALTER TABLE public.coll_prop_env_obsv OWNER TO postgres;

--
-- Name: coll_prop_esg_attr_score; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.coll_prop_esg_attr_score (
    attr_score_id character varying(36) DEFAULT gen_random_uuid() NOT NULL,
    assessment_id character varying(36) NOT NULL,
    collateral_id character varying(16) NOT NULL,
    tab_code character varying(20) NOT NULL,
    attr_code character varying(32) NOT NULL,
    raw_val_recorded character varying(128),
    base_score_awarded numeric(5,2) NOT NULL,
    score_direction character varying(10) NOT NULL,
    weight_pct numeric(5,2) NOT NULL,
    weighted_score numeric(5,2) NOT NULL,
    rubric_id_applied character varying(36),
    model_version character varying(32) NOT NULL,
    evaluated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.coll_prop_esg_attr_score OWNER TO postgres;

--
-- Name: coll_prop_loc_info; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.coll_prop_loc_info (
    rec_id character varying(36) DEFAULT gen_random_uuid() NOT NULL,
    assessment_id character varying(36) NOT NULL,
    collateral_id character varying(16) NOT NULL,
    prop_name character varying(128) NOT NULL,
    prop_type_mstr character varying(20) DEFAULT 'PROP_TYPE'::character varying NOT NULL,
    prop_type_code character varying(20) NOT NULL,
    address_line1 character varying(128) NOT NULL,
    address_line2 character varying(128),
    city character varying(64) NOT NULL,
    state_mstr character varying(20) DEFAULT 'STATE_CODE'::character varying NOT NULL,
    state_code character varying(20) NOT NULL,
    postal_code character varying(16) NOT NULL,
    country_code character varying(3) DEFAULT 'IND'::character varying NOT NULL,
    latitude numeric(10,7) NOT NULL,
    longitude numeric(10,7) NOT NULL,
    climate_zone_mstr character varying(20) DEFAULT 'CLIMATE_ZONE'::character varying NOT NULL,
    climate_zone_code character varying(20),
    seismic_zone_mstr character varying(20) DEFAULT 'SEISMIC_ZONE'::character varying NOT NULL,
    seismic_zone_code character varying(20),
    flood_plain_yn character(1) DEFAULT 'N'::bpchar NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date DEFAULT '2099-12-31'::date NOT NULL,
    created_by character varying(64) DEFAULT 'SYSTEM_MAKER'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    checked_by character varying(64),
    checked_at timestamp without time zone
);


ALTER TABLE public.coll_prop_loc_info OWNER TO postgres;

--
-- Name: esg_assessment_ledger; Type: TABLE; Schema: public; Owner: vcsharma
--

CREATE TABLE public.esg_assessment_ledger (
    assessment_id character varying(36) DEFAULT (gen_random_uuid())::character varying NOT NULL,
    coll_id character varying(50) NOT NULL,
    coll_type character varying(20) NOT NULL,
    model_version character varying(20) NOT NULL,
    env_score numeric(5,2),
    soc_score numeric(5,2),
    gov_score numeric(5,2),
    composite_score numeric(5,2) NOT NULL,
    esg_grade character varying(10) NOT NULL,
    risk_category character varying(30) NOT NULL,
    haircut_pct numeric(5,2) NOT NULL,
    flowable_proc_inst_id character varying(64),
    flowable_decision_id character varying(64),
    raw_responses jsonb NOT NULL,
    assessment_status character varying(20) DEFAULT 'SCORED'::character varying,
    assessed_by character varying(50) DEFAULT 'SYSTEM_MAKER'::character varying,
    assessed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.esg_assessment_ledger OWNER TO vcsharma;

--
-- Name: TABLE esg_assessment_ledger; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON TABLE public.esg_assessment_ledger IS 'ESG Assessment Ledger: Stores scoring results including component scores (E/S/G), composite score, grade, and Flowable decision/process references.';


--
-- Name: COLUMN esg_assessment_ledger.assessment_id; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.assessment_id IS 'Unique assessment identifier (UUID).';


--
-- Name: COLUMN esg_assessment_ledger.coll_id; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.coll_id IS 'Collateral/Asset identifier (property, manufacturing plant, vehicle, etc.).';


--
-- Name: COLUMN esg_assessment_ledger.coll_type; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.coll_type IS 'Collateral type: PROP, MANU, VEH, MKT.';


--
-- Name: COLUMN esg_assessment_ledger.model_version; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.model_version IS 'ESG scoring model version (e.g., PROP_ESG_V1.0).';


--
-- Name: COLUMN esg_assessment_ledger.env_score; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.env_score IS 'Environmental pillar score (0-100).';


--
-- Name: COLUMN esg_assessment_ledger.soc_score; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.soc_score IS 'Social pillar score (0-100).';


--
-- Name: COLUMN esg_assessment_ledger.gov_score; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.gov_score IS 'Governance pillar score (0-100).';


--
-- Name: COLUMN esg_assessment_ledger.composite_score; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.composite_score IS 'Weighted composite ESG score (0-100).';


--
-- Name: COLUMN esg_assessment_ledger.esg_grade; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.esg_grade IS 'Assigned ESG grade (AAA, AA, A, BBB, C).';


--
-- Name: COLUMN esg_assessment_ledger.risk_category; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.risk_category IS 'Risk category: VERY_LOW_RISK, LOW_RISK, MODERATE_RISK, ELEVATED_RISK, CRITICAL_RISK.';


--
-- Name: COLUMN esg_assessment_ledger.haircut_pct; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.haircut_pct IS 'Haircut percentage (valuation impact).';


--
-- Name: COLUMN esg_assessment_ledger.flowable_proc_inst_id; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.flowable_proc_inst_id IS 'Flowable process instance ID (if workflow was triggered).';


--
-- Name: COLUMN esg_assessment_ledger.flowable_decision_id; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.flowable_decision_id IS 'Flowable decision execution ID.';


--
-- Name: COLUMN esg_assessment_ledger.raw_responses; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.raw_responses IS 'Original form responses (JSONB) for audit trail.';


--
-- Name: COLUMN esg_assessment_ledger.assessment_status; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.assessment_status IS 'Status: SCORED, APPROVED, REJECTED, ESCALATED.';


--
-- Name: COLUMN esg_assessment_ledger.assessed_by; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.assessed_by IS 'User/system identifier who performed the assessment.';


--
-- Name: COLUMN esg_assessment_ledger.assessed_at; Type: COMMENT; Schema: public; Owner: vcsharma
--

COMMENT ON COLUMN public.esg_assessment_ledger.assessed_at IS 'Timestamp when assessment was performed.';


--
-- Name: esg_attr_score_rubric; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.esg_attr_score_rubric (
    rubric_id character varying(36) DEFAULT gen_random_uuid() NOT NULL,
    model_version character varying(32) DEFAULT 'PROP_ESG_V1.0'::character varying NOT NULL,
    tab_code character varying(20) NOT NULL,
    source_table character varying(32) NOT NULL,
    source_column character varying(32) NOT NULL,
    attr_code character varying(32) NOT NULL,
    match_operator character varying(10) DEFAULT 'EQUALS'::character varying NOT NULL,
    attr_val_match character varying(64) NOT NULL,
    val_range_min numeric(12,2),
    val_range_max numeric(12,2),
    base_score numeric(5,2) NOT NULL,
    score_direction character varying(10) NOT NULL,
    default_weight_pct numeric(5,2) NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date DEFAULT '2099-12-31'::date NOT NULL,
    coll_type_mstr character varying(20) DEFAULT 'COLL_TYPE'::character varying NOT NULL,
    coll_type character varying(20) DEFAULT 'PROP'::character varying NOT NULL
);


ALTER TABLE public.esg_attr_score_rubric OWNER TO postgres;

--
-- Name: esg_coll_section_weight; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.esg_coll_section_weight (
    section_weight_id character varying(36) DEFAULT gen_random_uuid() NOT NULL,
    coll_type_mstr character varying(20) DEFAULT 'COLL_TYPE'::character varying NOT NULL,
    coll_type character varying(20) NOT NULL,
    model_version character varying(32) DEFAULT 'PROP_ESG_V1.0'::character varying NOT NULL,
    section_code character varying(32) NOT NULL,
    section_name character varying(128) NOT NULL,
    weight_pct numeric(5,2) NOT NULL,
    display_seq integer DEFAULT 1 NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date DEFAULT '2099-12-31'::date,
    created_by character varying(64) DEFAULT 'SYSTEM_MAKER'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.esg_coll_section_weight OWNER TO postgres;

--
-- Name: esg_fld_msg_map; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.esg_fld_msg_map (
    map_id character varying(36) NOT NULL,
    msg_code character varying(15) NOT NULL,
    frm_code character varying(10) NOT NULL,
    fld_code character varying(30),
    trigger_event character varying(20) NOT NULL,
    rule_ref_code character varying(32),
    param_bind_json character varying(256),
    is_blocking_flag boolean DEFAULT false NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    effective_from date,
    effective_to date DEFAULT '2099-12-31'::date,
    created_by character varying(64),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_trigger_evt CHECK (((trigger_event)::text = ANY ((ARRAY['ON_CHANGE'::character varying, 'ON_BLUR'::character varying, 'ON_SUBMIT'::character varying, 'ON_SCORE'::character varying, 'ON_OVERRIDE'::character varying])::text[])))
);


ALTER TABLE public.esg_fld_msg_map OWNER TO postgres;

--
-- Name: esg_form_colmn_meta; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.esg_form_colmn_meta (
    form_col_id character varying(32) NOT NULL,
    form_id character varying(32) NOT NULL,
    tab_code character varying(32) NOT NULL,
    tab_seq integer NOT NULL,
    section_code character varying(32) NOT NULL,
    field_id character varying(64) NOT NULL,
    tbl_code character varying(6) NOT NULL,
    col_code character varying(30) NOT NULL,
    ui_control_type character varying(32) NOT NULL,
    grid_span integer DEFAULT 4 NOT NULL,
    display_seq integer NOT NULL,
    label_msg_key character varying(64) NOT NULL,
    placeholder_msg_key character varying(64),
    is_mandatory boolean DEFAULT false NOT NULL,
    is_readonly boolean DEFAULT false NOT NULL,
    derived_source_field character varying(64),
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date DEFAULT '2099-12-31'::date,
    version integer DEFAULT 1 NOT NULL,
    created_by character varying(64) DEFAULT 'SYSTEM_MAKER'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_form_col_dates CHECK (((effective_to IS NULL) OR (effective_to >= effective_from)))
);


ALTER TABLE public.esg_form_colmn_meta OWNER TO postgres;

--
-- Name: esg_form_meta; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.esg_form_meta (
    form_id character varying(32) NOT NULL,
    form_name character varying(128) NOT NULL,
    option_name character varying(64) NOT NULL,
    total_sections integer DEFAULT 1 NOT NULL,
    layout_engine character varying(32) DEFAULT 'GRID_12'::character varying NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date,
    is_active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_form_effective_dates CHECK (((effective_to IS NULL) OR (effective_to >= effective_from)))
);


ALTER TABLE public.esg_form_meta OWNER TO postgres;

--
-- Name: esg_grade_haircut_matrix; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.esg_grade_haircut_matrix (
    grade_matrix_id character varying(36) DEFAULT gen_random_uuid() NOT NULL,
    coll_type_mstr character varying(20) DEFAULT 'COLL_TYPE'::character varying NOT NULL,
    coll_type character varying(20) NOT NULL,
    model_version character varying(32) DEFAULT 'PROP_ESG_V1.0'::character varying NOT NULL,
    min_score numeric(5,2) NOT NULL,
    max_score numeric(5,2) NOT NULL,
    esg_grade character varying(10) NOT NULL,
    risk_category character varying(32) NOT NULL,
    haircut_pct numeric(5,2) NOT NULL,
    color_code character varying(16) DEFAULT '#22c55e'::character varying,
    display_seq integer DEFAULT 1 NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date DEFAULT '2099-12-31'::date,
    created_by character varying(64) DEFAULT 'SYSTEM_MAKER'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.esg_grade_haircut_matrix OWNER TO postgres;

--
-- Name: esg_msg_meta; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.esg_msg_meta (
    msg_code character varying(15) NOT NULL,
    msg_type character varying(10) NOT NULL,
    msg_title character varying(100),
    msg_text_en character varying(512) NOT NULL,
    msg_text_xml text,
    disp_mode character varying(15) NOT NULL,
    default_reason_req boolean DEFAULT false NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    effective_from date,
    effective_to date DEFAULT '2099-12-31'::date,
    created_by character varying(64),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_disp_mode CHECK (((disp_mode)::text = ANY ((ARRAY['INLINE_FIELD'::character varying, 'TOAST_POPUP'::character varying, 'MODAL_BOX'::character varying, 'BANNER_TOP'::character varying])::text[]))),
    CONSTRAINT chk_msg_type CHECK (((msg_type)::text = ANY ((ARRAY['ERROR'::character varying, 'WARNING'::character varying, 'INFO'::character varying, 'CONFIRM'::character varying, 'CRITICAL_CAP'::character varying])::text[])))
);


ALTER TABLE public.esg_msg_meta OWNER TO postgres;

--
-- Name: esg_tbl_col_frm_col_map; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.esg_tbl_col_frm_col_map (
    map_id character varying(36) DEFAULT gen_random_uuid() NOT NULL,
    form_id character varying(32) NOT NULL,
    form_col_id character varying(32) NOT NULL,
    tbl_code character varying(10) NOT NULL,
    col_code character varying(30) NOT NULL,
    mapping_mode character varying(20) DEFAULT 'DIRECT'::character varying NOT NULL,
    is_updatable character(1) DEFAULT 'Y'::bpchar NOT NULL,
    is_insertable character(1) DEFAULT 'Y'::bpchar NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by character varying(64) DEFAULT 'SYSTEM_MAKER'::character varying NOT NULL,
    CONSTRAINT esg_tbl_col_frm_col_map_is_insertable_check CHECK ((is_insertable = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT esg_tbl_col_frm_col_map_is_updatable_check CHECK ((is_updatable = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT esg_tbl_col_frm_col_map_mapping_mode_check CHECK (((mapping_mode)::text = ANY ((ARRAY['DIRECT'::character varying, 'DERIVED'::character varying, 'LOOKUP'::character varying, 'AUDIT'::character varying])::text[]))),
    CONSTRAINT esg_tbl_col_frm_col_map_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying])::text[])))
);


ALTER TABLE public.esg_tbl_col_frm_col_map OWNER TO postgres;

--
-- Name: esg_tbl_colmn_meta; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.esg_tbl_colmn_meta (
    tbl_code character varying(6) NOT NULL,
    col_code character varying(30) NOT NULL,
    col_sys_name character varying(30) NOT NULL,
    col_frndly_name character varying(100),
    col_des character varying(256),
    is_prim character(1) DEFAULT 'N'::bpchar NOT NULL,
    is_fgn character(1) DEFAULT 'N'::bpchar NOT NULL,
    col_typ character varying(10) NOT NULL,
    col_natr character varying(10) NOT NULL,
    lookup_tbl_cod character varying(6),
    lookup_col_cod character varying(30),
    lookup_disp_col_cod character varying(30),
    col_data_typ character varying(15) NOT NULL,
    col_data_len integer,
    col_dec_scale integer,
    rejex character varying(256),
    nullable_flag character(1) DEFAULT 'Y'::bpchar NOT NULL,
    col_lwr_val character varying(64),
    col_upr_val character varying(64),
    col_def_val character varying(128),
    col_temp_class character varying(4),
    col_score_link character varying(10),
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    effective_from date,
    effective_to date DEFAULT '2099-12-31'::date,
    version integer DEFAULT 1,
    created_by character varying(64),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    checked_by character varying(64),
    checked_at timestamp without time zone,
    approved_by character varying(64),
    approved_at timestamp without time zone,
    CONSTRAINT chk_col_data_typ CHECK (((col_data_typ)::text = ANY ((ARRAY['STRING'::character varying, 'NUMBER'::character varying, 'DECIMAL'::character varying, 'DATE'::character varying, 'TIMESTAMP'::character varying, 'BOOLEAN'::character varying])::text[]))),
    CONSTRAINT chk_col_is_fgn CHECK ((is_fgn = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT chk_col_is_prim CHECK ((is_prim = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT chk_col_natr CHECK (((col_natr)::text = ANY ((ARRAY['DATA'::character varying, 'LOOKUP'::character varying])::text[]))),
    CONSTRAINT chk_col_nullable CHECK ((nullable_flag = ANY (ARRAY['Y'::bpchar, 'N'::bpchar]))),
    CONSTRAINT chk_col_score_link CHECK (((col_score_link IS NULL) OR ((col_score_link)::text = ANY ((ARRAY['DIRECT'::character varying, 'INDIRECT'::character varying, 'NO'::character varying, 'OUTPUT'::character varying])::text[])))),
    CONSTRAINT chk_col_temp_class CHECK (((col_temp_class IS NULL) OR ((col_temp_class)::text = ANY ((ARRAY['ST'::character varying, 'CD'::character varying, 'AN'::character varying, 'VE'::character varying, 'EV'::character varying, 'SM'::character varying])::text[])))),
    CONSTRAINT chk_col_typ CHECK (((col_typ)::text = ANY ((ARRAY['DATA'::character varying, 'DERIVED'::character varying, 'SYSTEM'::character varying, 'AUDIT'::character varying])::text[])))
);


ALTER TABLE public.esg_tbl_colmn_meta OWNER TO postgres;

--
-- Name: esg_tbl_meta; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.esg_tbl_meta (
    tbl_code character varying(10) NOT NULL,
    tbl_sys_name character varying(64) NOT NULL,
    tbl_frndly_name character varying(128) NOT NULL,
    tbl_des character varying(512),
    tbl_typ character varying(10) DEFAULT 'TXN'::character varying NOT NULL,
    p_key_colmn character varying(64) DEFAULT 'REC_ID'::character varying NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date DEFAULT '2099-12-31'::date NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by character varying(64) DEFAULT 'SYSTEM_MAKER'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT esg_tbl_meta_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying])::text[]))),
    CONSTRAINT esg_tbl_meta_tbl_typ_check CHECK (((tbl_typ)::text = ANY ((ARRAY['TXN'::character varying, 'MST'::character varying, 'LOG'::character varying, 'REF'::character varying])::text[])))
);


ALTER TABLE public.esg_tbl_meta OWNER TO postgres;

--
-- Name: coll_prop_esg_attr_score coll_prop_esg_attr_score_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_esg_attr_score
    ADD CONSTRAINT coll_prop_esg_attr_score_pkey PRIMARY KEY (attr_score_id);


--
-- Name: coll_prop_loc_info coll_prop_loc_info_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_loc_info
    ADD CONSTRAINT coll_prop_loc_info_pkey PRIMARY KEY (rec_id);


--
-- Name: esg_assessment_ledger esg_assessment_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: vcsharma
--

ALTER TABLE ONLY public.esg_assessment_ledger
    ADD CONSTRAINT esg_assessment_ledger_pkey PRIMARY KEY (assessment_id);


--
-- Name: esg_attr_score_rubric esg_attr_score_rubric_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_attr_score_rubric
    ADD CONSTRAINT esg_attr_score_rubric_pkey PRIMARY KEY (rubric_id);


--
-- Name: esg_coll_section_weight esg_coll_section_weight_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_coll_section_weight
    ADD CONSTRAINT esg_coll_section_weight_pkey PRIMARY KEY (section_weight_id);


--
-- Name: esg_form_colmn_meta esg_form_colmn_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_form_colmn_meta
    ADD CONSTRAINT esg_form_colmn_meta_pkey PRIMARY KEY (form_col_id);


--
-- Name: esg_form_meta esg_form_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_form_meta
    ADD CONSTRAINT esg_form_meta_pkey PRIMARY KEY (form_id);


--
-- Name: esg_grade_haircut_matrix esg_grade_haircut_matrix_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_grade_haircut_matrix
    ADD CONSTRAINT esg_grade_haircut_matrix_pkey PRIMARY KEY (grade_matrix_id);


--
-- Name: esg_tbl_col_frm_col_map esg_tbl_col_frm_col_map_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_tbl_col_frm_col_map
    ADD CONSTRAINT esg_tbl_col_frm_col_map_pkey PRIMARY KEY (map_id);


--
-- Name: coll_esg_asmt_base pk_coll_esg_asmt_base; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_esg_asmt_base
    ADD CONSTRAINT pk_coll_esg_asmt_base PRIMARY KEY (rec_id);


--
-- Name: coll_master pk_coll_master; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_master
    ADD CONSTRAINT pk_coll_master PRIMARY KEY (rec_id);


--
-- Name: coll_prop_env_info pk_coll_prop_env_info; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_env_info
    ADD CONSTRAINT pk_coll_prop_env_info PRIMARY KEY (rec_id);


--
-- Name: coll_prop_env_obsv pk_coll_prop_env_obsv; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_env_obsv
    ADD CONSTRAINT pk_coll_prop_env_obsv PRIMARY KEY (rec_id);


--
-- Name: esg_fld_msg_map pk_esg_fld_msg_map; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_fld_msg_map
    ADD CONSTRAINT pk_esg_fld_msg_map PRIMARY KEY (map_id);


--
-- Name: esg_msg_meta pk_esg_msg_meta; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_msg_meta
    ADD CONSTRAINT pk_esg_msg_meta PRIMARY KEY (msg_code);


--
-- Name: esg_tbl_colmn_meta pk_esg_tbl_colmn_meta; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_tbl_colmn_meta
    ADD CONSTRAINT pk_esg_tbl_colmn_meta PRIMARY KEY (tbl_code, col_code);


--
-- Name: esg_tbl_meta pk_esg_tbl_meta; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_tbl_meta
    ADD CONSTRAINT pk_esg_tbl_meta PRIMARY KEY (tbl_code);


--
-- Name: coll_esg_asmt_base uq_asmt_coll_ver; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_esg_asmt_base
    ADD CONSTRAINT uq_asmt_coll_ver UNIQUE (collateral_id, assessment_version);


--
-- Name: coll_esg_asmt_base uq_assessment_id; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_esg_asmt_base
    ADD CONSTRAINT uq_assessment_id UNIQUE (assessment_id);


--
-- Name: coll_esg_asmt_base uq_coll_esg_asmt_id; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_esg_asmt_base
    ADD CONSTRAINT uq_coll_esg_asmt_id UNIQUE (assessment_id);


--
-- Name: coll_master uq_coll_id; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_master
    ADD CONSTRAINT uq_coll_id UNIQUE (coll_id);


--
-- Name: coll_prop_env_info uq_env_asmt_id; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_env_info
    ADD CONSTRAINT uq_env_asmt_id UNIQUE (assessment_id);


--
-- Name: coll_prop_env_obsv uq_env_obsv_yr; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_env_obsv
    ADD CONSTRAINT uq_env_obsv_yr UNIQUE (assessment_id, reporting_year);


--
-- Name: esg_tbl_meta uq_esg_tbl_sys_name; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_tbl_meta
    ADD CONSTRAINT uq_esg_tbl_sys_name UNIQUE (tbl_sys_name);


--
-- Name: esg_form_colmn_meta uq_form_field; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_form_colmn_meta
    ADD CONSTRAINT uq_form_field UNIQUE (form_id, field_id);


--
-- Name: esg_tbl_col_frm_col_map uq_form_tbl_col_mapping; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_tbl_col_frm_col_map
    ADD CONSTRAINT uq_form_tbl_col_mapping UNIQUE (form_id, form_col_id, tbl_code, col_code);


--
-- Name: esg_grade_haircut_matrix uq_ghm_coll_grade; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_grade_haircut_matrix
    ADD CONSTRAINT uq_ghm_coll_grade UNIQUE (coll_type, model_version, esg_grade);


--
-- Name: esg_coll_section_weight uq_sec_weight_coll_version; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_coll_section_weight
    ADD CONSTRAINT uq_sec_weight_coll_version UNIQUE (coll_type, model_version, section_code);


--
-- Name: idx_attr_score_asmt; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attr_score_asmt ON public.coll_prop_esg_attr_score USING btree (assessment_id, tab_code);


--
-- Name: idx_coll_esg_asmt_coll_ver; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_coll_esg_asmt_coll_ver ON public.coll_esg_asmt_base USING btree (collateral_id, assessment_version);


--
-- Name: idx_esg_assessment_assessed_at; Type: INDEX; Schema: public; Owner: vcsharma
--

CREATE INDEX idx_esg_assessment_assessed_at ON public.esg_assessment_ledger USING btree (assessed_at DESC);


--
-- Name: idx_esg_assessment_coll_id; Type: INDEX; Schema: public; Owner: vcsharma
--

CREATE INDEX idx_esg_assessment_coll_id ON public.esg_assessment_ledger USING btree (coll_id);


--
-- Name: idx_esg_assessment_coll_type_status; Type: INDEX; Schema: public; Owner: vcsharma
--

CREATE INDEX idx_esg_assessment_coll_type_status ON public.esg_assessment_ledger USING btree (coll_type, assessment_status);


--
-- Name: idx_form_col_lookup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_form_col_lookup ON public.esg_form_colmn_meta USING btree (form_id, tab_code, section_code, display_seq);


--
-- Name: idx_map_form_lookup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_map_form_lookup ON public.esg_tbl_col_frm_col_map USING btree (form_id, form_col_id);


--
-- Name: idx_map_tbl_lookup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_map_tbl_lookup ON public.esg_tbl_col_frm_col_map USING btree (tbl_code, col_code);


--
-- Name: idx_prop_loc_asmt; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_prop_loc_asmt ON public.coll_prop_loc_info USING btree (assessment_id, collateral_id);


--
-- Name: idx_rubric_lookup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rubric_lookup ON public.esg_attr_score_rubric USING btree (model_version, source_table, source_column);


--
-- Name: coll_esg_asmt_base coll_esg_asmt_base_collateral_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_esg_asmt_base
    ADD CONSTRAINT coll_esg_asmt_base_collateral_id_fkey FOREIGN KEY (collateral_id) REFERENCES public.coll_master(coll_id);


--
-- Name: esg_form_colmn_meta esg_form_colmn_meta_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_form_colmn_meta
    ADD CONSTRAINT esg_form_colmn_meta_form_id_fkey FOREIGN KEY (form_id) REFERENCES public.esg_form_meta(form_id) ON DELETE CASCADE;


--
-- Name: coll_esg_asmt_base fk_asmt_coll_type; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_esg_asmt_base
    ADD CONSTRAINT fk_asmt_coll_type FOREIGN KEY (coll_type_mstr, coll_type) REFERENCES public.btc_cvm_val(mstr_code, code);


--
-- Name: coll_esg_asmt_base fk_asmt_status; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_esg_asmt_base
    ADD CONSTRAINT fk_asmt_status FOREIGN KEY (asmt_stat_mstr, assessment_status) REFERENCES public.btc_cvm_val(mstr_code, code);


--
-- Name: coll_esg_asmt_base fk_asmt_type; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_esg_asmt_base
    ADD CONSTRAINT fk_asmt_type FOREIGN KEY (asmt_type_mstr, assessment_type) REFERENCES public.btc_cvm_val(mstr_code, code);


--
-- Name: coll_prop_esg_attr_score fk_attr_asmt; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_esg_attr_score
    ADD CONSTRAINT fk_attr_asmt FOREIGN KEY (assessment_id) REFERENCES public.coll_esg_asmt_base(assessment_id) ON DELETE CASCADE;


--
-- Name: coll_prop_esg_attr_score fk_attr_coll; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_esg_attr_score
    ADD CONSTRAINT fk_attr_coll FOREIGN KEY (collateral_id) REFERENCES public.coll_master(coll_id) ON DELETE RESTRICT;


--
-- Name: coll_esg_asmt_base fk_coll_esg_asmt_coll; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_esg_asmt_base
    ADD CONSTRAINT fk_coll_esg_asmt_coll FOREIGN KEY (collateral_id) REFERENCES public.coll_master(coll_id) ON DELETE RESTRICT;


--
-- Name: coll_master fk_coll_master_type; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_master
    ADD CONSTRAINT fk_coll_master_type FOREIGN KEY (coll_type_mstr, coll_type) REFERENCES public.btc_cvm_val(mstr_code, code);


--
-- Name: coll_prop_env_info fk_env_asmt; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_env_info
    ADD CONSTRAINT fk_env_asmt FOREIGN KEY (assessment_id) REFERENCES public.coll_esg_asmt_base(assessment_id);


--
-- Name: coll_prop_env_info fk_env_cert_level; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_env_info
    ADD CONSTRAINT fk_env_cert_level FOREIGN KEY (cert_level_mstr, cert_rating_level) REFERENCES public.btc_cvm_val(mstr_code, code);


--
-- Name: coll_prop_env_info fk_env_cert_type; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_env_info
    ADD CONSTRAINT fk_env_cert_type FOREIGN KEY (cert_type_mstr, cert_type_code) REFERENCES public.btc_cvm_val(mstr_code, code);


--
-- Name: coll_prop_env_info fk_env_coll; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_env_info
    ADD CONSTRAINT fk_env_coll FOREIGN KEY (collateral_id) REFERENCES public.coll_master(coll_id);


--
-- Name: coll_prop_env_info fk_env_ee_rating; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_env_info
    ADD CONSTRAINT fk_env_ee_rating FOREIGN KEY (ee_rating_mstr, energy_efficiency_ratg) REFERENCES public.btc_cvm_val(mstr_code, code);


--
-- Name: coll_prop_env_info fk_env_ren_type; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_env_info
    ADD CONSTRAINT fk_env_ren_type FOREIGN KEY (ren_type_mstr, renewable_type) REFERENCES public.btc_cvm_val(mstr_code, code);


--
-- Name: coll_prop_env_info fk_env_water_stress; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_env_info
    ADD CONSTRAINT fk_env_water_stress FOREIGN KEY (water_stress_mstr, water_stress_ratg) REFERENCES public.btc_cvm_val(mstr_code, code);


--
-- Name: esg_form_colmn_meta fk_fcm_tbl_col; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_form_colmn_meta
    ADD CONSTRAINT fk_fcm_tbl_col FOREIGN KEY (tbl_code, col_code) REFERENCES public.esg_tbl_colmn_meta(tbl_code, col_code);


--
-- Name: esg_grade_haircut_matrix fk_ghm_coll_type; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_grade_haircut_matrix
    ADD CONSTRAINT fk_ghm_coll_type FOREIGN KEY (coll_type_mstr, coll_type) REFERENCES public.btc_cvm_val(mstr_code, code);


--
-- Name: esg_tbl_col_frm_col_map fk_map_form; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_tbl_col_frm_col_map
    ADD CONSTRAINT fk_map_form FOREIGN KEY (form_id) REFERENCES public.esg_form_meta(form_id) ON DELETE CASCADE;


--
-- Name: esg_tbl_col_frm_col_map fk_map_form_col; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_tbl_col_frm_col_map
    ADD CONSTRAINT fk_map_form_col FOREIGN KEY (form_col_id) REFERENCES public.esg_form_colmn_meta(form_col_id) ON DELETE CASCADE;


--
-- Name: esg_fld_msg_map fk_map_msg; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_fld_msg_map
    ADD CONSTRAINT fk_map_msg FOREIGN KEY (msg_code) REFERENCES public.esg_msg_meta(msg_code);


--
-- Name: esg_tbl_col_frm_col_map fk_map_tbl_col; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_tbl_col_frm_col_map
    ADD CONSTRAINT fk_map_tbl_col FOREIGN KEY (tbl_code, col_code) REFERENCES public.esg_tbl_colmn_meta(tbl_code, col_code);


--
-- Name: coll_prop_env_obsv fk_obsv_asmt; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_env_obsv
    ADD CONSTRAINT fk_obsv_asmt FOREIGN KEY (assessment_id) REFERENCES public.coll_esg_asmt_base(assessment_id);


--
-- Name: coll_prop_env_obsv fk_obsv_coll; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_env_obsv
    ADD CONSTRAINT fk_obsv_coll FOREIGN KEY (collateral_id) REFERENCES public.coll_master(coll_id);


--
-- Name: coll_prop_loc_info fk_prop_loc_coll; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coll_prop_loc_info
    ADD CONSTRAINT fk_prop_loc_coll FOREIGN KEY (collateral_id) REFERENCES public.coll_master(coll_id) ON DELETE RESTRICT;


--
-- Name: esg_attr_score_rubric fk_rubric_coll_type; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_attr_score_rubric
    ADD CONSTRAINT fk_rubric_coll_type FOREIGN KEY (coll_type_mstr, coll_type) REFERENCES public.btc_cvm_val(mstr_code, code);


--
-- Name: esg_coll_section_weight fk_sec_weight_coll_type; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esg_coll_section_weight
    ADD CONSTRAINT fk_sec_weight_coll_type FOREIGN KEY (coll_type_mstr, coll_type) REFERENCES public.btc_cvm_val(mstr_code, code);


--
-- Name: esg_assessment_ledger; Type: ROW SECURITY; Schema: public; Owner: vcsharma
--

ALTER TABLE public.esg_assessment_ledger ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict HKNfZDhJaxwjAuxRYXlR1Wuufs4FjTAL75gEwBwgxOICraZnFxFSdlMMn7ZtwQb

