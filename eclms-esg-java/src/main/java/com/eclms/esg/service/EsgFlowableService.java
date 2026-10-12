package com.eclms.esg.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.flowable.dmn.api.DmnDecisionService;
import org.flowable.dmn.api.DmnRepositoryService;
import org.flowable.dmn.api.DmnDecision;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.runtime.ProcessInstance;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class EsgFlowableService {

    private static final Logger log = LoggerFactory.getLogger(EsgFlowableService.class);

    public static final String GRADE_DECISION_KEY = "decision_esg_grade_haircut";
    public static final String PROCESS_KEY = "proc_esg_collateral_assessment";

    public record GradeResult(String esgGrade, String riskCategory, BigDecimal haircutPct, String decisionId) {
    }

    private final DmnDecisionService dmnDecisionService;
    private final DmnRepositoryService dmnRepositoryService;
    private final RuntimeService runtimeService;
    private final JdbcTemplate jdbc;

    public EsgFlowableService(DmnDecisionService dmnDecisionService,
                              DmnRepositoryService dmnRepositoryService,
                              RuntimeService runtimeService,
                              JdbcTemplate jdbc) {
        this.dmnDecisionService = dmnDecisionService;
        this.dmnRepositoryService = dmnRepositoryService;
        this.runtimeService = runtimeService;
        this.jdbc = jdbc;
    }

    /**
     * Resolves grade, risk category and haircut through the deployed DMN table.
     * Falls back to esg_grade_haircut_matrix when the decision cannot be executed, as the Node service does.
     */
    public GradeResult executeGradeHaircutDmn(BigDecimal compositeScore, String collType) {
        try {
            Map<String, Object> variables = new HashMap<>();
            variables.put("compositeScore", compositeScore.doubleValue());
            variables.put("collType", collType);

            List<Map<String, Object>> outputs = dmnDecisionService.createExecuteDecisionBuilder()
                    .decisionKey(GRADE_DECISION_KEY)
                    .variables(variables)
                    .executeDecision();

            if (outputs != null && !outputs.isEmpty()) {
                Map<String, Object> row = outputs.get(0);
                return new GradeResult(
                        stringOr(row.get("esgGrade"), "N/A"),
                        stringOr(row.get("riskCategory"), "UNKNOWN"),
                        toHaircut(row.get("haircutPct")),
                        latestDecisionId());
            }
            log.warn("DMN {} returned no rows for {}/{}; using database lookup", GRADE_DECISION_KEY, collType, compositeScore);
        } catch (RuntimeException ex) {
            log.warn("DMN {} failed for {}/{}; using database lookup: {}", GRADE_DECISION_KEY, collType, compositeScore, ex.getMessage());
        }
        return lookupFromMatrix(compositeScore, collType);
    }

    private GradeResult lookupFromMatrix(BigDecimal compositeScore, String collType) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                """
                SELECT esg_grade, risk_category, haircut_pct
                FROM esg_grade_haircut_matrix
                WHERE coll_type = ? AND status = 'ACTIVE'
                  AND min_score <= ? AND max_score >= ?
                ORDER BY display_seq ASC
                LIMIT 1
                """,
                collType, compositeScore, compositeScore);
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT,
                    "Unable to resolve grade for " + collType + " composite score " + compositeScore);
        }
        Map<String, Object> row = rows.get(0);
        return new GradeResult(
                (String) row.get("esg_grade"),
                (String) row.get("risk_category"),
                toHaircut(row.get("haircut_pct")),
                null);
    }

    private String latestDecisionId() {
        DmnDecision decision = dmnRepositoryService.createDecisionQuery()
                .decisionKey(GRADE_DECISION_KEY)
                .latestVersion()
                .singleResult();
        return decision == null ? null : decision.getId();
    }

    /**
     * Starts proc_esg_collateral_assessment and returns the process instance ID.
     * The BPMN DMN task writes esgGrade, riskCategory and haircutPct itself, so they are not passed in.
     */
    public String startAssessmentProcess(String collId, String collType, BigDecimal compositeScore,
                                         BigDecimal haircutPct, String assessedBy) {
        Map<String, Object> variables = new HashMap<>();
        variables.put("collId", collId);
        variables.put("collType", collType);
        variables.put("compositeScore", compositeScore.doubleValue());
        variables.put("haircutPct", haircutPct.doubleValue());
        variables.put("assessedBy", assessedBy);

        ProcessInstance instance = runtimeService.startProcessInstanceByKey(PROCESS_KEY, collId, variables);
        return instance.getId();
    }

    private static String stringOr(Object value, String fallback) {
        return value == null ? fallback : value.toString();
    }

    private static BigDecimal toHaircut(Object value) {
        if (value == null) {
            return BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP);
        }
        return new BigDecimal(value.toString()).setScale(2, RoundingMode.HALF_UP);
    }
}
