const axios = require("axios");
const FormData = require("form-data");
const { Readable } = require("stream");

const FLOWABLE_URL = process.env.FLOWABLE_URL || "http://localhost:8080/flowable-rest";
const FLOWABLE_USER = process.env.FLOWABLE_USER || "admin";
const FLOWABLE_PASSWORD = process.env.FLOWABLE_PASSWORD || "test";

const flowableClient = axios.create({
  baseURL: FLOWABLE_URL,
  auth: { username: FLOWABLE_USER, password: FLOWABLE_PASSWORD },
  timeout: 15000,
});

async function deployDmnXml(deploymentName, fileName, xmlContent) {
  try {
    const formData = new FormData();
    formData.append("deploymentName", deploymentName);
    formData.append("file", Readable.from([xmlContent]), fileName);

    const response = await flowableClient.post("/dmn-repository/deployments", formData, {
      headers: formData.getHeaders(),
    });

    return { success: true, deploymentId: response.data.id, status: response.status };
  } catch (error) {
    console.error(`Flowable DMN deployment error: ${error.message}`);
    return { success: false, error: error.message, status: error.response?.status };
  }
}

async function deployBpmnXml(deploymentName, fileName, xmlContent) {
  try {
    const formData = new FormData();
    formData.append("deploymentName", deploymentName);
    formData.append("file", Readable.from([xmlContent]), fileName);

    const response = await flowableClient.post("/process-api/repository/deployments", formData, {
      headers: formData.getHeaders(),
    });

    return { success: true, deploymentId: response.data.id, status: response.status };
  } catch (error) {
    console.error(`Flowable BPMN deployment error: ${error.message}`);
    return { success: false, error: error.message, status: error.response?.status };
  }
}

async function executeDecision(decisionKey, inputVariables) {
  try {
    const response = await flowableClient.post("/dmn-api/decision-table-execution", {
      decisionKey,
      inputVariables,
    });

    return { success: true, result: response.data, status: response.status };
  } catch (error) {
    console.error(`Flowable decision execution error: ${error.message}`);
    return { success: false, error: error.message, status: error.response?.status };
  }
}

async function startProcessInstance(processDefinitionKey, variables) {
  try {
    const payload = {
      processDefinitionKey,
      variables: Object.entries(variables).map(([name, value]) => ({ name, value })),
    };

    const response = await flowableClient.post("/process-api/runtime/process-instances", payload);

    return { success: true, processInstanceId: response.data.id, status: response.status };
  } catch (error) {
    console.error(`Flowable process start error: ${error.message}`);
    return { success: false, error: error.message, status: error.response?.status };
  }
}

module.exports = { deployDmnXml, deployBpmnXml, executeDecision, startProcessInstance };
