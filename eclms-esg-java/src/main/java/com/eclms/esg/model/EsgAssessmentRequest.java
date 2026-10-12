package com.eclms.esg.model;

import java.math.BigDecimal;
import java.util.Map;

public class EsgAssessmentRequest {

    private String collId;
    /** PROP, MANU or VEH. */
    private String collType;
    private String modelVersion;
    private BigDecimal originalValuation;
    private Map<String, Object> formAttributes;
    private String assessedBy;

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

    public String getModelVersion() {
        return modelVersion;
    }

    public void setModelVersion(String modelVersion) {
        this.modelVersion = modelVersion;
    }

    public BigDecimal getOriginalValuation() {
        return originalValuation;
    }

    public void setOriginalValuation(BigDecimal originalValuation) {
        this.originalValuation = originalValuation;
    }

    public Map<String, Object> getFormAttributes() {
        return formAttributes;
    }

    public void setFormAttributes(Map<String, Object> formAttributes) {
        this.formAttributes = formAttributes;
    }

    public String getAssessedBy() {
        return assessedBy;
    }

    public void setAssessedBy(String assessedBy) {
        this.assessedBy = assessedBy;
    }
}
