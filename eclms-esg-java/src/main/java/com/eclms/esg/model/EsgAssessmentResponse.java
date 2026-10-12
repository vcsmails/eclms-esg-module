package com.eclms.esg.model;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class EsgAssessmentResponse {

    /** Null for calculate-score, which is not persisted. */
    private UUID assessmentId;
    private String collId;
    private String collType;
    private BigDecimal compositeScore;
    private String esgGrade;
    private String riskCategory;
    private BigDecimal haircutPct;
    private BigDecimal postHaircutValuation;
    private Map<String, BigDecimal> sectionScores;
    private List<Map<String, Object>> evaluatedRules;
    private String flowableProcInstId;
    private String flowableDecisionId;
    private String assessmentStatus;

    public UUID getAssessmentId() {
        return assessmentId;
    }

    public void setAssessmentId(UUID assessmentId) {
        this.assessmentId = assessmentId;
    }

    public String getCollId() {
        return collId;
    }

    public void setCollId(String collId) {
        this.collId = collId;
    }

    public String getCollType() {
        return collType;
    }

    public void setCollType(String collType) {
        this.collType = collType;
    }

    public BigDecimal getCompositeScore() {
        return compositeScore;
    }

    public void setCompositeScore(BigDecimal compositeScore) {
        this.compositeScore = compositeScore;
    }

    public String getEsgGrade() {
        return esgGrade;
    }

    public void setEsgGrade(String esgGrade) {
        this.esgGrade = esgGrade;
    }

    public String getRiskCategory() {
        return riskCategory;
    }

    public void setRiskCategory(String riskCategory) {
        this.riskCategory = riskCategory;
    }

    public BigDecimal getHaircutPct() {
        return haircutPct;
    }

    public void setHaircutPct(BigDecimal haircutPct) {
        this.haircutPct = haircutPct;
    }

    public BigDecimal getPostHaircutValuation() {
        return postHaircutValuation;
    }

    public void setPostHaircutValuation(BigDecimal postHaircutValuation) {
        this.postHaircutValuation = postHaircutValuation;
    }

    public Map<String, BigDecimal> getSectionScores() {
        return sectionScores;
    }

    public void setSectionScores(Map<String, BigDecimal> sectionScores) {
        this.sectionScores = sectionScores;
    }

    public List<Map<String, Object>> getEvaluatedRules() {
        return evaluatedRules;
    }

    public void setEvaluatedRules(List<Map<String, Object>> evaluatedRules) {
        this.evaluatedRules = evaluatedRules;
    }

    public String getFlowableProcInstId() {
        return flowableProcInstId;
    }

    public void setFlowableProcInstId(String flowableProcInstId) {
        this.flowableProcInstId = flowableProcInstId;
    }

    public String getFlowableDecisionId() {
        return flowableDecisionId;
    }

    public void setFlowableDecisionId(String flowableDecisionId) {
        this.flowableDecisionId = flowableDecisionId;
    }

    public String getAssessmentStatus() {
        return assessmentStatus;
    }

    public void setAssessmentStatus(String assessmentStatus) {
        this.assessmentStatus = assessmentStatus;
    }
}
