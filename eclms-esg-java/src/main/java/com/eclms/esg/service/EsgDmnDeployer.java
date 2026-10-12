package com.eclms.esg.service;

import java.util.List;
import java.util.Map;
import org.flowable.dmn.api.DmnRepositoryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Builds the grade/haircut decision table from esg_grade_haircut_matrix and deploys it.
 * Mirrors eclms-esg-api/services/dmn-builder.service.js. Each startup creates a new
 * deployment version; the decision lookup always uses the latest version.
 */
@Component
public class EsgDmnDeployer {

    private static final Logger log = LoggerFactory.getLogger(EsgDmnDeployer.class);
    static final String DMN_RESOURCE_NAME = "esg_grade_haircut_matrix.dmn20.xml";

    private final JdbcTemplate jdbc;
    private final DmnRepositoryService dmnRepositoryService;
    private final boolean deployOnStartup;

    public EsgDmnDeployer(JdbcTemplate jdbc,
                          DmnRepositoryService dmnRepositoryService,
                          @Value("${esg.dmn.deploy-on-startup:true}") boolean deployOnStartup) {
        this.jdbc = jdbc;
        this.dmnRepositoryService = dmnRepositoryService;
        this.deployOnStartup = deployOnStartup;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void deployGradeHaircutDecision() {
        if (!deployOnStartup) {
            log.info("esg.dmn.deploy-on-startup=false; skipping grade/haircut DMN deployment");
            return;
        }
        List<Map<String, Object>> rows = jdbc.queryForList(
                """
                SELECT coll_type, min_score, max_score, esg_grade, risk_category, haircut_pct
                FROM esg_grade_haircut_matrix
                WHERE status = 'ACTIVE'
                ORDER BY coll_type ASC, display_seq ASC
                """);
        if (rows.isEmpty()) {
            log.warn("No active grade bands in esg_grade_haircut_matrix; DMN not deployed");
            return;
        }
        String xml = buildDmnXml(rows);
        dmnRepositoryService.createDeployment()
                .name("esg_grade_haircut")
                .addString(DMN_RESOURCE_NAME, xml)
                .deploy();
        log.info("Deployed grade/haircut DMN from {} active bands", rows.size());
    }

    static String buildDmnXml(List<Map<String, Object>> rows) {
        StringBuilder rules = new StringBuilder();
        int idx = 0;
        for (Map<String, Object> row : rows) {
            idx++;
            String inputRange = "[" + plain(row.get("min_score")) + "," + plain(row.get("max_score")) + "]";
            rules.append("""

                    <decision:rule id="rule_%1$d">
                      <decision:inputEntry id="inputEntry_%1$d_1">
                        <decision:text>%2$s</decision:text>
                      </decision:inputEntry>
                      <decision:inputEntry id="inputEntry_%1$d_2">
                        <decision:text>"%3$s"</decision:text>
                      </decision:inputEntry>
                      <decision:outputEntry id="outputEntry_%1$d_1">
                        <decision:text>"%4$s"</decision:text>
                      </decision:outputEntry>
                      <decision:outputEntry id="outputEntry_%1$d_2">
                        <decision:text>"%5$s"</decision:text>
                      </decision:outputEntry>
                      <decision:outputEntry id="outputEntry_%1$d_3">
                        <decision:text>%6$s</decision:text>
                      </decision:outputEntry>
                    </decision:rule>""".formatted(
                    idx,
                    escapeXml(inputRange),
                    escapeXml(String.valueOf(row.get("coll_type"))),
                    escapeXml(String.valueOf(row.get("esg_grade"))),
                    escapeXml(String.valueOf(row.get("risk_category"))),
                    plain(row.get("haircut_pct"))));
        }

        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <definitions xmlns="http://www.omg.org/spec/DMN/20151101/dmn.xsd"
                             xmlns:decision="http://www.omg.org/spec/DMN/20151101/decision.xsd"
                             id="definitions_esg_grade_haircut"
                             name="ESG Grade &amp; Haircut Matrix">
                  <decision id="decision_esg_grade_haircut" name="ESG Grade and Haircut Decision">
                    <decisionTable id="decisionTable_esg" hitPolicy="FIRST">
                      <input id="input_composite_score" label="Composite Score">
                        <inputExpression typeRef="number">
                          <text>compositeScore</text>
                        </inputExpression>
                      </input>
                      <input id="input_coll_type" label="Collateral Type">
                        <inputExpression typeRef="string">
                          <text>collType</text>
                        </inputExpression>
                      </input>
                      <output id="output_esg_grade" label="ESG Grade" typeRef="string" name="esgGrade"/>
                      <output id="output_risk_category" label="Risk Category" typeRef="string" name="riskCategory"/>
                      <output id="output_haircut_pct" label="Haircut %" typeRef="number" name="haircutPct"/>
                %s
                    </decisionTable>
                  </decision>
                </definitions>
                """.formatted(rules);
    }

    private static String plain(Object value) {
        return value == null ? "" : new java.math.BigDecimal(value.toString()).toPlainString();
    }

    private static String escapeXml(String value) {
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }
}
