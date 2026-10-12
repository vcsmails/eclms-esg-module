package com.eclms.esg.service;

import com.eclms.esg.model.EsgAssessmentRequest;
import com.eclms.esg.model.EsgAssessmentResponse;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

@Service
public class EsgAssessmentService {

    private static final Set<String> COLL_TYPES = Set.of("PROP", "MANU", "VEH");
    private static final String DEFAULT_ASSESSOR = "SYSTEM_MAKER";
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private final EsgScoringService scoringService;
    private final EsgFlowableService flowableService;
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final boolean makerCheckerEnabled;

    public EsgAssessmentService(EsgScoringService scoringService,
                                EsgFlowableService flowableService,
                                JdbcTemplate jdbc,
                                ObjectMapper objectMapper,
                                @Value("${esg.workflow.maker-checker-enabled:true}") boolean makerCheckerEnabled) {
        this.scoringService = scoringService;
        this.flowableService = flowableService;
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.makerCheckerEnabled = makerCheckerEnabled;
    }

    /** Scores and resolves grade/haircut. Nothing is persisted. */
    public EsgAssessmentResponse calculate(EsgAssessmentRequest request) {
        Normalized input = normalize(request);
        EsgScoringService.ScoringResult scoring = scoringService.score(input.collType(), input.formAttributes());
        EsgFlowableService.GradeResult grade = flowableService.executeGradeHaircutDmn(scoring.compositeScore(), input.collType());

        EsgAssessmentResponse response = baseResponse(input, scoring, grade);
        response.setPostHaircutValuation(postHaircutValuation(input.originalValuation(), grade.haircutPct()));
        response.setAssessmentStatus("CALCULATED");
        return response;
    }

    /**
     * Full lifecycle: score, DMN, valuation, process start, ledger insert and collateral update.
     * Any failure rolls back the ledger and collateral changes.
     */
    @Transactional
    public EsgAssessmentResponse submit(EsgAssessmentRequest request) {
        Normalized input = normalize(request);
        if (input.originalValuation() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "originalValuation is required for submit");
        }
        if (input.originalValuation().signum() < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "originalValuation must be zero or greater");
        }

        Integer collCount = jdbc.queryForObject(
                "SELECT COUNT(*) FROM coll_master WHERE coll_id = ?", Integer.class, input.collId());
        if (collCount == null || collCount == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Collateral not found: " + input.collId());
        }

        EsgScoringService.ScoringResult scoring = scoringService.score(input.collType(), input.formAttributes());
        EsgFlowableService.GradeResult grade = flowableService.executeGradeHaircutDmn(scoring.compositeScore(), input.collType());
        BigDecimal postHaircutValuation = postHaircutValuation(input.originalValuation(), grade.haircutPct());

        String procInstId = flowableService.startAssessmentProcess(
                input.collId(), input.collType(), scoring.compositeScore(), grade.haircutPct(), input.assessedBy());

        UUID assessmentId = UUID.randomUUID();
        String status = makerCheckerEnabled ? "SUBMITTED" : "APPROVED";

        jdbc.update(
                """
                INSERT INTO esg_assessment_ledger (
                  assessment_id, coll_id, coll_type, model_version,
                  env_score, soc_score, gov_score, composite_score,
                  esg_grade, risk_category, haircut_pct,
                  flowable_proc_inst_id, flowable_decision_id, raw_responses,
                  assessment_status, assessed_by, assessed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, CURRENT_TIMESTAMP)
                """,
                assessmentId.toString(),
                input.collId(),
                input.collType(),
                input.modelVersion(),
                scoring.sectionScores().get(EsgScoringService.ENV_SECTION),
                scoring.sectionScores().get(EsgScoringService.SOC_SECTION),
                scoring.sectionScores().get(EsgScoringService.GOV_SECTION),
                scoring.compositeScore(),
                grade.esgGrade(),
                grade.riskCategory(),
                grade.haircutPct(),
                procInstId,
                grade.decisionId(),
                toJson(input.formAttributes()),
                status,
                input.assessedBy());

        int updated = jdbc.update(
                """
                UPDATE coll_master
                SET esg_haircut_pct = ?, esg_post_haircut_val = ?, last_esg_assessment_id = ?
                WHERE coll_id = ?
                """,
                grade.haircutPct(), postHaircutValuation, assessmentId, input.collId());
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Collateral not found: " + input.collId());
        }

        EsgAssessmentResponse response = baseResponse(input, scoring, grade);
        response.setAssessmentId(assessmentId);
        response.setPostHaircutValuation(postHaircutValuation);
        response.setFlowableProcInstId(procInstId);
        response.setAssessmentStatus(status);
        return response;
    }

    private record Normalized(String collId, String collType, String modelVersion, BigDecimal originalValuation,
                              Map<String, Object> formAttributes, String assessedBy) {
    }

    private Normalized normalize(EsgAssessmentRequest request) {
        if (request == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Request body is required");
        }
        if (request.getCollId() == null || request.getCollId().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "collId is required");
        }
        String collType = request.getCollType() == null ? "" : request.getCollType().trim().toUpperCase(Locale.ROOT);
        if (!COLL_TYPES.contains(collType)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "collType must be one of PROP, MANU, VEH");
        }
        if (request.getFormAttributes() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "formAttributes is required");
        }
        String modelVersion = isBlank(request.getModelVersion()) ? collType + "_ESG_V1.0" : request.getModelVersion().trim();
        String assessedBy = isBlank(request.getAssessedBy()) ? DEFAULT_ASSESSOR : request.getAssessedBy().trim();
        return new Normalized(request.getCollId().trim(), collType, modelVersion,
                request.getOriginalValuation(), request.getFormAttributes(), assessedBy);
    }

    private EsgAssessmentResponse baseResponse(Normalized input, EsgScoringService.ScoringResult scoring,
                                               EsgFlowableService.GradeResult grade) {
        EsgAssessmentResponse response = new EsgAssessmentResponse();
        response.setCollId(input.collId());
        response.setCollType(input.collType());
        response.setCompositeScore(scoring.compositeScore());
        response.setEsgGrade(grade.esgGrade());
        response.setRiskCategory(grade.riskCategory());
        response.setHaircutPct(grade.haircutPct());
        response.setSectionScores(scoring.sectionScores());
        response.setEvaluatedRules(scoring.evaluatedRules());
        response.setFlowableDecisionId(grade.decisionId());
        return response;
    }

    /** postHaircutVal = originalValuation x (1 - haircutPct / 100), HALF_UP at scale 2. */
    static BigDecimal postHaircutValuation(BigDecimal originalValuation, BigDecimal haircutPct) {
        if (originalValuation == null) {
            return null;
        }
        BigDecimal retention = BigDecimal.ONE.subtract(haircutPct.divide(HUNDRED, 6, RoundingMode.HALF_UP));
        return originalValuation.multiply(retention).setScale(2, RoundingMode.HALF_UP);
    }

    private String toJson(Map<String, Object> attributes) {
        return objectMapper.writeValueAsString(attributes);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
