package com.eclms.esg.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

/**
 * Java port of the rubric and weighted-composite logic in
 * eclms-esg-api/services/assessment-scoring.service.js.
 */
@Service
public class EsgScoringService {

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final int TOTAL_WEIGHT_CENTS = 10000;
    private static final Pattern LEADING_NUMBER = Pattern.compile("^\\s*[-+]?\\d+(\\.\\d+)?");

    /** Section codes used for the three component scores stored in the ledger. */
    public static final String ENV_SECTION = "TAB_ENV";
    public static final String SOC_SECTION = "SEC_SOC_GOV";
    public static final String GOV_SECTION = "TAB_LOC";

    private final JdbcTemplate jdbc;

    public EsgScoringService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record ScoringResult(
            BigDecimal compositeScore,
            Map<String, BigDecimal> sectionScores,
            List<Map<String, Object>> weightedSections,
            List<Map<String, Object>> evaluatedRules) {
    }

    public ScoringResult score(String collType, Map<String, Object> formAttributes) {
        List<Map<String, Object>> sections = jdbc.queryForList(
                """
                SELECT section_code, section_name, weight_pct
                FROM esg_coll_section_weight
                WHERE coll_type = ? AND status = 'ACTIVE'
                ORDER BY display_seq ASC
                """,
                collType);

        int totalCents = 0;
        for (Map<String, Object> section : sections) {
            totalCents += toBigDecimal(section.get("weight_pct"))
                    .multiply(HUNDRED).setScale(0, RoundingMode.HALF_UP).intValue();
        }
        if (sections.isEmpty() || totalCents != TOTAL_WEIGHT_CENTS) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT,
                    "Active section weights for " + collType + " must total 100.00 before scoring.");
        }

        Map<String, BigDecimal> rawSectionScores = new LinkedHashMap<>();
        List<Map<String, Object>> evaluatedRules = new ArrayList<>();

        for (Map<String, Object> section : sections) {
            String sectionCode = (String) section.get("section_code");
            SectionResult result = evaluateSection(collType, sectionCode, formAttributes);
            rawSectionScores.put(sectionCode, result.score());
            evaluatedRules.addAll(result.rules());
        }

        BigDecimal composite = BigDecimal.ZERO;
        List<Map<String, Object>> weightedSections = new ArrayList<>();
        for (Map<String, Object> section : sections) {
            String sectionCode = (String) section.get("section_code");
            BigDecimal sectionScore = rawSectionScores.get(sectionCode);
            BigDecimal weightPct = toBigDecimal(section.get("weight_pct"));
            BigDecimal contribution = sectionScore
                    .multiply(weightPct)
                    .divide(HUNDRED, 6, RoundingMode.HALF_UP);
            composite = composite.add(contribution);

            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("section_code", sectionCode);
            entry.put("section_name", section.get("section_name"));
            entry.put("section_score", scale2(sectionScore));
            entry.put("weight_pct", weightPct);
            entry.put("contribution", scale2(contribution));
            weightedSections.add(entry);
        }

        BigDecimal clamped = composite.max(BigDecimal.ZERO).min(HUNDRED).setScale(2, RoundingMode.HALF_UP);

        Map<String, BigDecimal> sectionScores = new LinkedHashMap<>();
        rawSectionScores.forEach((code, value) -> sectionScores.put(code, scale2(value)));

        return new ScoringResult(clamped, sectionScores, weightedSections, evaluatedRules);
    }

    private record SectionResult(BigDecimal score, List<Map<String, Object>> rules) {
    }

    private SectionResult evaluateSection(String collType, String sectionCode, Map<String, Object> formAttributes) {
        List<Map<String, Object>> rubric = jdbc.queryForList(
                """
                SELECT attr_code, match_operator, attr_val_match, val_range_min, val_range_max,
                       base_score, default_weight_pct
                FROM esg_attr_score_rubric
                WHERE coll_type = ? AND tab_code = ? AND status = 'ACTIVE'
                ORDER BY rubric_id ASC
                """,
                collType, sectionCode);

        BigDecimal total = BigDecimal.ZERO;
        List<Map<String, Object>> rules = new ArrayList<>();

        for (Map<String, Object> rule : rubric) {
            String attrCode = (String) rule.get("attr_code");
            Object attrValue = formAttributes.get(attrCode);
            if (attrValue == null) {
                continue;
            }
            if (!matches(rule, attrValue)) {
                continue;
            }

            BigDecimal base = toBigDecimal(rule.get("base_score"));
            BigDecimal weight = toBigDecimal(rule.get("default_weight_pct"));
            BigDecimal contribution = base.multiply(weight).divide(HUNDRED, 6, RoundingMode.HALF_UP);
            total = total.add(contribution);

            Map<String, Object> evaluated = new LinkedHashMap<>();
            evaluated.put("section_code", sectionCode);
            evaluated.put("attr_code", attrCode);
            evaluated.put("operator", rule.get("match_operator"));
            evaluated.put("rule_value", ruleValueLabel(rule));
            evaluated.put("base_score", base);
            evaluated.put("weight_pct", weight);
            evaluated.put("contribution", scale2(contribution));
            rules.add(evaluated);
        }

        return new SectionResult(total.min(HUNDRED), rules);
    }

    private boolean matches(Map<String, Object> rule, Object attrValue) {
        String operator = (String) rule.get("match_operator");
        if (operator == null) {
            return false;
        }
        switch (operator) {
            case "EQUALS":
                return normalize(attrValue).equals(normalize(rule.get("attr_val_match")));
            case "CONTAINS":
                return normalizeRaw(attrValue).contains(normalizeRaw(rule.get("attr_val_match")));
            case "STARTS_WITH":
                return normalizeRaw(attrValue).startsWith(normalizeRaw(rule.get("attr_val_match")));
            case "BETWEEN":
                return matchesBetween(rule, attrValue);
            default:
                return false;
        }
    }

    private boolean matchesBetween(Map<String, Object> rule, Object attrValue) {
        Matcher matcher = LEADING_NUMBER.matcher(String.valueOf(attrValue));
        if (!matcher.find()) {
            return false;
        }
        BigDecimal numVal = new BigDecimal(matcher.group().trim());
        BigDecimal min = toBigDecimal(rule.get("val_range_min"));
        BigDecimal max = toBigDecimal(rule.get("val_range_max"));
        if (min == null || max == null) {
            return false;
        }
        return numVal.compareTo(min) >= 0 && numVal.compareTo(max) <= 0;
    }

    private String ruleValueLabel(Map<String, Object> rule) {
        Object match = rule.get("attr_val_match");
        if (match != null && !String.valueOf(match).isEmpty()) {
            return String.valueOf(match);
        }
        return rule.get("val_range_min") + "-" + rule.get("val_range_max");
    }

    private static String normalize(Object value) {
        return normalizeRaw(value).trim();
    }

    private static String normalizeRaw(Object value) {
        return String.valueOf(value).toUpperCase(Locale.ROOT);
    }

    static BigDecimal toBigDecimal(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof BigDecimal bd) {
            return bd;
        }
        return new BigDecimal(value.toString().trim());
    }

    private static BigDecimal scale2(BigDecimal value) {
        return value == null ? null : value.setScale(2, RoundingMode.HALF_UP);
    }
}
