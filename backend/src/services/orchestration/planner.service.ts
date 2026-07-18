import { OrchestrationResponse, OrchestrationStreamEvent, AdvisoryResponse } from "../../types/orchestration.types";
import { CostBudgetStatus, AgentTrace } from "../../types/trace.types";
import { RetailCase } from "../../types/case.types";
import { loadRetailCase } from "../data/retail-case-loader";
import { maskPiiPayload } from "../governance/pii-masking.service";
import { recordAuditEvent, getAuditEventsByRun } from "../governance/audit-log.service";
import { screenSecurityInput } from "../governance/input-security.service";
import { saveOrchestrationRun } from "./trace.service";
import { orchestrationGraph, assembleTraces, OrchestrationState } from "./orchestration-graph";
import { routeOrExtractInput, OrchestrationInputError, InputRoutingOrExtractionResult } from "./input-router.service";
import { classifyIntent } from "./intent-classifier.service";
import { runAdvisoryAgent } from "../agents/advisory.agent";
import { buildAnswerTransparency } from "../governance/citation-governance.service";
import { buildReasoningNarrative } from "./reasoning-narrative.service";
import { decisionPolicy } from "../../config/policy";
import { randomUUID } from "crypto";
import { resolveRuntimeBinding } from "../platform/runtime-binding.service";
import { Command } from "@langchain/langgraph";
import { getLatestApproval } from "../platform/approval.service";
import { getTenantConfigVersion } from "../platform/tenant-config.service";
import { pgQuery } from "../../config/pg";

// Order matters: within the self-correction chunk, selfCorrectionTrace, productTrace and
// legalTrace all change simultaneously (one graph step) — scanning selfCorrection before
// product/legal emits the "re-pricing triggered" event first, then the two re-run updates,
// matching the actual business narrative instead of raw object-key order.
const TRACE_KEYS = [
  "plannerTrace",
  "planningTrace",
  "profileTrace",
  "selfCorrectionTrace",
  "productTrace",
  "creditTrace",
  "fraudTrace",
  "legalTrace",
  "riskTrace",
  "opsTrace",
] as const;

const attachInterruptMetadata=async(runId:string,state:OrchestrationState):Promise<OrchestrationState>=>{
  const snapshot=await orchestrationGraph.getState({configurable:{thread_id:runId}});
  const interrupts=(snapshot.tasks as Array<{interrupts?:unknown[]}>).flatMap(task=>task.interrupts??[]);
  const normalized={...state} as OrchestrationState&{__interrupt__?:unknown[]};delete normalized.__interrupt__;
  if(interrupts.length)normalized.__interrupt__=interrupts;
  return normalized;
};

/** Shared response assembly for both the synchronous and streaming entry points. */
const buildOrchestrationResponse = async (
  runId: string,
  caseId: string,
  retailCase: RetailCase,
  approvalToken: string | undefined,
  finalState: OrchestrationState
): Promise<OrchestrationResponse> => {
  if (finalState.terminalReason === "BLOCKED") {
    const traces = assembleTraces(finalState);
    const transparentAnswer = buildAnswerTransparency(
      "Yêu cầu bị từ chối do vi phạm quy tắc an toàn bảo mật thông tin (Prompt Injection).",
      traces,
      "SECURITY_BLOCKED",
      "HYBRID_APPROVAL"
    );
    const response: OrchestrationResponse = {
      mode: "CREDIT_APPRAISAL",
      runId,
      tenantId: finalState.tenantId,
      workflowId: finalState.workflowId,
      workflowVersion: finalState.workflowVersion,
      configVersion: finalState.configVersion,
      finalAnswer: transparentAnswer.finalAnswer,
      reasoning:
        "Planner phát hiện tín hiệu chặn (BLOCKER) ngay tại bước phân loại đầu vào: nội dung yêu cầu chứa chỉ thị điều khiển hệ thống trái phép (prompt injection). Quyết định cuối cùng: chặn bảo mật (SECURITY_BLOCKED). Không agent nghiệp vụ nào được chạy tiếp.",
      traces,
      budgetStatus: {
        piiMasked: true,
        missingConsentCalls: 0,
        highWritesBeforeApproval: 0,
        modelCallsUsed: finalState.modelCallsCount,
        maxModelCalls: finalState.maximumModelCalls,
        estimatedCostUSD: decisionPolicy.runtimeBudget.securityBlockEstimatedCostUsd,
        replayMode: true
      },
      auditEvents: await getAuditEventsByRun(runId),
      transparency: transparentAnswer.transparency,
    };
    await saveOrchestrationRun(runId, response, {
      caseId,
      prompt: finalState.prompt,
      status: "SECURITY_BLOCKED",
      tenantId: finalState.tenantId,
      workflowId: finalState.workflowId,
      workflowVersion: finalState.workflowVersion,
      configVersion: finalState.configVersion,
    });
    return response;
  }

  const graphInterrupts=(finalState as OrchestrationState & {__interrupt__?:unknown[]}).__interrupt__;
  if(Array.isArray(graphInterrupts)&&graphInterrupts.length){
    const approval=await getLatestApproval(finalState.tenantId,runId);
    if(!approval) throw new Error("INTERRUPTED_WITHOUT_APPROVAL_RECORD");
    const traces=maskPiiPayload(assembleTraces(finalState)) as AgentTrace[];
    const response:OrchestrationResponse={mode:"CREDIT_APPRAISAL",runId,tenantId:finalState.tenantId,workflowId:finalState.workflowId,workflowVersion:finalState.workflowVersion,configVersion:finalState.configVersion,finalAnswer:"[CHỜ PHÊ DUYỆT] Workflow đã được checkpoint và tạm dừng trước thao tác nghiệp vụ.",reasoning:"Human approval gate đã tạm dừng LangGraph; chưa có action nào được thực hiện.",traces,approvalTicketId:approval.id,pendingApproval:approval,auditEvents:await getAuditEventsByRun(runId)};
    await saveOrchestrationRun(runId,response,{caseId,prompt:finalState.prompt,status:"paused",tenantId:finalState.tenantId,workflowId:finalState.workflowId,workflowVersion:finalState.workflowVersion,configVersion:finalState.configVersion});
    return response;
  }

  const rawTraces = assembleTraces(finalState);
  const maskedTraces = maskPiiPayload(rawTraces);
  const { finalDecision, conditions, requiredFixes, ticketId, approvalMode, approvedTerms, businessValue, confidence } = finalState;

  // Compile final answer string
  let finalAnswer = "";
  if (finalDecision === "FAST_PASS") {
    finalAnswer = `[DUYỆT NHANH] Khoản vay của khách hàng được phê duyệt qua luồng Fast Pass. Số tiền vay đề xuất: ${retailCase.requestedLoan.amount.toLocaleString()} VND. Mã hồ sơ giải ngân Core Banking: ${ticketId || "PENDING"}.`;
  } else if (finalDecision === "PASS") {
    finalAnswer = ticketId
      ? `[ĐÃ PHÊ DUYỆT] Hạn mức ${approvedTerms?.loanAmount.toLocaleString()} VND đã được người có thẩm quyền duyệt. Mã Core Banking: ${ticketId}.`
      : `[ĐỀ XUẤT PHÊ DUYỆT] Không phát hiện blocker trong phạm vi rule catalog đã chạy; hồ sơ đang chờ người có thẩm quyền phê duyệt trước khi ghi Core Banking.`;
  } else if (finalDecision === "CONDITIONAL_PASS") {
    const creditOutput = rawTraces.find(t => t.agent === "credit")?.toolCalls.find(tc => tc.toolName === "evaluateCreditRules")?.output as any;
    const loanAmt = creditOutput?.restructureScenario?.loanAmount || retailCase.requestedLoan.amount;
    const loanTenure = creditOutput?.restructureScenario?.tenureYears || retailCase.requestedLoan.tenureYears;

    if (!ticketId) {
      finalAnswer = `[HỘI ĐỒNG PHÁN QUYẾT: PHÊ DUYỆT CÓ ĐIỀU KIỆN] Khoản vay tái cấu trúc đề xuất: ${loanAmt.toLocaleString()} VND trong ${loanTenure} năm. Hồ sơ đang CHỜ DUYỆT CỦA CON NGƯỜI (Human Approval Token) trước khi đăng ký lên Core Banking.`;
    } else {
      finalAnswer = `[HỘI ĐỒNG PHÁN QUYẾT: ĐÃ DUYỆT CÓ ĐIỀU KIỆN] Đã cấp hạn mức vay tái cấu trúc: ${loanAmt.toLocaleString()} VND trong ${loanTenure} năm. Khế ước hạn mức (${ticketId}) đã được đăng ký ở trạng thái PENDING_CONDITIONS. Vui lòng hoàn tất ${conditions.length} điều kiện trước khi giải ngân.`;
    }
  } else if (finalDecision === "HUMAN_ESCALATION") {
    finalAnswer = `[CHỜ XỬ LÝ CON NGƯỜI] Hồ sơ bị tạm ngưng do có cảnh báo nghiêm trọng. Lý do: ${requiredFixes.join("; ")}`;
  } else {
    finalAnswer = `[TỪ CHỐI PHÊ DUYỆT] Hồ sơ bị từ chối tín dụng do không đáp ứng các chỉ tiêu rủi ro. Chi tiết: ${requiredFixes.join("; ")}`;
  }
  if(finalState.manualInterventionRequired) finalAnswer="[DỪNG AN TOÀN] Action hoặc compensation thất bại; workflow đã khóa và yêu cầu can thiệp thủ công.";

  const transparentAnswer = buildAnswerTransparency(finalAnswer, rawTraces, finalDecision, approvalMode, requiredFixes);

  // Cost budget calculation
  const missingConsent = !retailCase.consent.credit_check || !retailCase.consent.tax_income_check;
  const highWritesBeforeApproval = (finalDecision === "CONDITIONAL_PASS" || finalDecision === "PASS") && !approvalToken;

  const budgetStatus: CostBudgetStatus = {
    piiMasked: true,
    missingConsentCalls: missingConsent ? 1 : 0,
    highWritesBeforeApproval: highWritesBeforeApproval ? 1 : 0,
    modelCallsUsed: finalState.modelCallsCount,
    maxModelCalls: finalState.maximumModelCalls,
    estimatedCostUSD: Number((finalState.modelCallsCount * decisionPolicy.runtimeBudget.estimatedCostPerModelCallUsd).toFixed(4)),
    replayMode: true
  };

  const response: OrchestrationResponse = {
    mode: "CREDIT_APPRAISAL",
    runId,
    tenantId: finalState.tenantId,
    workflowId: finalState.workflowId,
    workflowVersion: finalState.workflowVersion,
    configVersion: finalState.configVersion,
    finalAnswer: transparentAnswer.finalAnswer,
    reasoning: buildReasoningNarrative(maskedTraces as AgentTrace[], finalDecision, requiredFixes),
    traces: maskedTraces,
    approvalTicketId: ticketId,
    actionResults:finalState.actionResults,
    compensationResults:finalState.compensationResults,
    manualInterventionRequired:finalState.manualInterventionRequired,
    conditions,
    budgetStatus,
    auditEvents: await getAuditEventsByRun(runId),
    approvalMode,
    approvedTerms,
    businessValue,
    confidence,
    transparency: transparentAnswer.transparency
  };

  await saveOrchestrationRun(runId, response, {
    caseId,
    prompt: finalState.prompt,
    status: finalState.manualInterventionRequired?"manual_intervention_required":finalDecision,
    tenantId: finalState.tenantId,
    workflowId: finalState.workflowId,
    workflowVersion: finalState.workflowVersion,
    configVersion: finalState.configVersion,
  });
  return response;
};

/**
 * Builds the fixed-template AdvisoryResponse: a single planner trace, no LangGraph run.
 * Shared by both the synchronous and streaming entry points so the "Skipped" rendering
 * the frontend applies to every other pipeline stage stays consistent across both paths.
 */
const runAdvisoryFlow = async (runId: string, prompt: string, requestedBy: string, intent: "ADVISORY_QA" | "OUT_OF_DOMAIN"): Promise<AdvisoryResponse> => {
  const { trace, finalAnswer } = await runAdvisoryAgent(runId, prompt, intent);
  await recordAuditEvent(
    runId,
    requestedBy,
    "agent_call",
    { prompt, intent },
    "allowed",
    `Chuyên viên ${requestedBy} gửi yêu cầu được phân loại là ${intent} — không đi qua luồng thẩm định tín dụng.`
  );
  return { mode: intent, runId, finalAnswer, plannerTrace: trace, auditEvents: await getAuditEventsByRun(runId) };
};

/**
 * Security input is terminal before case routing. It must never be represented by a fake
 * RetailCase: doing so lets MCP and mandatory agents run against a caseId that has no
 * backing record, which produces misleading "Case data not found" traces.
 */
const runSecurityBlockedFlow = async (
  runId: string,
  prompt: string,
  requestedBy: string,
  detectedSignal: string,
  tenantId: string
): Promise<OrchestrationResponse> => {
  const startedAt = new Date().toISOString();
  await recordAuditEvent(
    runId,
    requestedBy,
    "model_call",
    { prompt },
    "blocked",
    `Phát hiện chỉ thị ghi đè điều khiển hệ thống: ${detectedSignal}. Yêu cầu bị chặn trước khi truy cập hồ sơ hoặc gọi model.`
  );

  const plannerTrace: AgentTrace = {
    id: `trace-planner-security-${Date.now()}`,
    runId,
    agent: "planner",
    task: "Validate input security before intent and case routing",
    status: "failed",
    summary: "Yêu cầu bị chặn tại cổng bảo mật trước khi tạo/tải hồ sơ; không MCP hay agent nghiệp vụ nào được gọi.",
    toolCalls: [{
      toolName: "detectPromptInjection",
      input: { promptLength: prompt.length },
      output: { blocked: true, signal: detectedSignal },
      status: "success",
    }],
    startedAt,
    completedAt: new Date().toISOString(),
  };
  const traces = [plannerTrace];
  const transparentAnswer = buildAnswerTransparency(
    "Yêu cầu bị từ chối do chứa chỉ thị ghi đè điều khiển hệ thống.",
    traces,
    "SECURITY_BLOCKED",
    "HYBRID_APPROVAL"
  );
  const response: OrchestrationResponse = {
    mode: "CREDIT_APPRAISAL",
    runId,
    finalAnswer: transparentAnswer.finalAnswer,
    reasoning: "Security Gate phát hiện chỉ thị ghi đè có thể điều khiển model. Luồng dừng trước intent classifier, case router, MCP và mọi agent nghiệp vụ.",
    traces,
    budgetStatus: {
      piiMasked: true,
      missingConsentCalls: 0,
      highWritesBeforeApproval: 0,
      modelCallsUsed: 0,
      maxModelCalls: decisionPolicy.runtimeBudget.maximumModelCalls,
      estimatedCostUSD: decisionPolicy.runtimeBudget.securityBlockEstimatedCostUsd,
      replayMode: true,
    },
    auditEvents: await getAuditEventsByRun(runId),
    transparency: transparentAnswer.transparency,
  };
  await saveOrchestrationRun(runId, response, { prompt, status: "SECURITY_BLOCKED", tenantId });
  return response;
};

export const executeOrchestration = async (
  prompt: string,
  requestedBy: string,
  approvalToken?: string,
  requestedCaseId?: string,
  tenantId = "bank-default"
): Promise<OrchestrationResponse | AdvisoryResponse> => {
  const runId = `run-${randomUUID()}`;

  const security = screenSecurityInput(prompt);
  if (security.status === "rejected") return runSecurityBlockedFlow(runId, security.sanitizedInput, requestedBy, security.signals[0], tenantId);
  const securedPrompt = security.sanitizedInput;

  const binding = await resolveRuntimeBinding(tenantId);
  let routed: InputRoutingOrExtractionResult;

  if (!requestedCaseId) {
    const [intentResult, routedResult] = await Promise.all([
      classifyIntent(securedPrompt),
      routeOrExtractInput(securedPrompt, requestedCaseId, tenantId)
    ]);
    if (intentResult.intent === "ADVISORY_QA" || intentResult.intent === "OUT_OF_DOMAIN") {
      return runAdvisoryFlow(runId, securedPrompt, requestedBy, intentResult.intent);
    }
    routed = routedResult;
  } else {
    routed = await routeOrExtractInput(securedPrompt, requestedCaseId, tenantId);
  }

  if (!routed.ok) throw new OrchestrationInputError(routed.code, routed.message, routed.questions);
  const { caseId } = routed;
  const retailCase = routed.extractedCase ?? await loadRetailCase(caseId, tenantId);

  // Governance: Record starting audit event, attributed to the authenticated human requester.
  await recordAuditEvent(runId, requestedBy, "agent_call", { tenantId,prompt: securedPrompt,securityStatus:security.status,caseId,workflowId:binding.workflow.workflowId,workflowVersion:binding.workflow.version,configVersion:binding.config.version }, "allowed", `Chuyên viên ${requestedBy} khởi chạy quy trình điều phối cho caseId: ${caseId}`);

  if (!retailCase) {
    return {
      runId,
      tenantId,
      workflowId: binding.workflow.workflowId,
      workflowVersion: binding.workflow.version,
      configVersion: binding.config.version,
      finalAnswer: "Không tìm thấy hồ sơ khách hàng tương ứng với yêu cầu.",
      traces: []
    };
  }

  // From here on, the pipeline (injection scan, fast/complex routing, self-correction
  // loop, decision matrix, operations) runs as a LangGraph StateGraph instead of an
  // imperative if/else chain — see orchestration-graph.ts.
  let finalState = await orchestrationGraph.invoke(
    {
      runId,
      tenantId,
      workflowId: binding.workflow.workflowId,
      workflowVersion: binding.workflow.version,
      configVersion: binding.config.version,
      workflowAllowsAction: binding.workflow.definition.nodes.some(node=>node.type==="action"),
      allowedActionTools: binding.workflow.definition.nodes.filter(node=>node.type==="action").flatMap(node=>node.allowedTools??[]),
      maximumDtiPercent:binding.config.thresholds.maxDti*100,
      policyThresholds:binding.config.thresholds,
      maximumModelCalls:binding.config.runtime.maxSteps,
      requestedBy,
      prompt: securedPrompt,
      approvalToken,
      caseId,
      customerName: retailCase.demographic.name
    },
    { configurable: { thread_id: runId }, recursionLimit: binding.config.runtime.maxSteps,signal:AbortSignal.timeout(binding.config.runtime.timeoutSeconds*1000) }
  );
  finalState=await attachInterruptMetadata(runId,finalState);

  return buildOrchestrationResponse(runId, caseId, retailCase, approvalToken, finalState);
};

/**
 * Same pipeline as executeOrchestration, but emits one OrchestrationStreamEvent per
 * pipeline stage as its trace lands in the LangGraph state (streamMode "values" yields
 * the full accumulated state after every node, so a newly-populated trace slot means
 * that node just completed) — lets the UI show live per-agent progress instead of a
 * single blocking request/response round trip.
 */
export const streamOrchestration = async (
  prompt: string,
  requestedBy: string,
  approvalToken: string | undefined,
  onEvent: (event: OrchestrationStreamEvent) => void,
  requestedCaseId?: string,
  tenantId = "bank-default"
): Promise<void> => {
  const runId = `run-${randomUUID()}`;
  const security = screenSecurityInput(prompt);
  if (security.status === "rejected") {
    const response = await runSecurityBlockedFlow(runId, security.sanitizedInput, requestedBy, security.signals[0], tenantId);
    onEvent({ type: "node_update", node: "planner", trace: response.traces[0] });
    onEvent({ type: "final", response });
    return;
  }
  const securedPrompt = security.sanitizedInput;

  const binding = await resolveRuntimeBinding(tenantId);
  let routed: InputRoutingOrExtractionResult;

  if (!requestedCaseId) {
    const [intentResult, routedResult] = await Promise.all([
      classifyIntent(securedPrompt),
      routeOrExtractInput(securedPrompt, requestedCaseId, tenantId)
    ]);
    if (intentResult.intent === "ADVISORY_QA" || intentResult.intent === "OUT_OF_DOMAIN") {
      const response = await runAdvisoryFlow(runId, securedPrompt, requestedBy, intentResult.intent);
      onEvent({ type: "advisory_final", response });
      return;
    }
    routed = routedResult;
  } else {
    routed = await routeOrExtractInput(securedPrompt, requestedCaseId, tenantId);
  }

  if (!routed.ok) throw new OrchestrationInputError(routed.code, routed.message, routed.questions);
  const { caseId } = routed;
  const retailCase = routed.extractedCase ?? await loadRetailCase(caseId, tenantId);

  await recordAuditEvent(runId, requestedBy, "agent_call", { tenantId,prompt:securedPrompt,securityStatus:security.status,caseId,workflowId:binding.workflow.workflowId,workflowVersion:binding.workflow.version,configVersion:binding.config.version }, "allowed", `Chuyên viên ${requestedBy} khởi chạy quy trình điều phối cho caseId: ${caseId}`);

  if (!retailCase) {
    onEvent({
      type: "final",
      response: {
        runId,
        finalAnswer: "Không tìm thấy hồ sơ khách hàng tương ứng với yêu cầu.",
        traces: []
      }
    });
    return;
  }

  const stream = await orchestrationGraph.stream(
    {
      runId,
      tenantId,
      workflowId: binding.workflow.workflowId,
      workflowVersion: binding.workflow.version,
      configVersion: binding.config.version,
      workflowAllowsAction: binding.workflow.definition.nodes.some(node=>node.type==="action"),
      allowedActionTools: binding.workflow.definition.nodes.filter(node=>node.type==="action").flatMap(node=>node.allowedTools??[]),
      maximumDtiPercent:binding.config.thresholds.maxDti*100,
      policyThresholds:binding.config.thresholds,
      maximumModelCalls:binding.config.runtime.maxSteps,
      requestedBy,
      prompt: securedPrompt,
      approvalToken,
      caseId,
      customerName: retailCase.demographic.name
    },
    { configurable: { thread_id: runId }, streamMode: "values", recursionLimit: binding.config.runtime.maxSteps,signal:AbortSignal.timeout(binding.config.runtime.timeoutSeconds*1000) }
  );

  let previous: Partial<OrchestrationState> = {};
  let finalState: OrchestrationState | undefined;

  for await (const chunk of stream as AsyncIterable<OrchestrationState>) {
    for (const key of TRACE_KEYS) {
      const trace = chunk[key] as AgentTrace | undefined;
      if (trace && trace !== previous[key]) {
        // Streaming is an external response path too. Mask before every incremental
        // event; masking only the final response would leak PII through live traces.
        const maskedTrace = maskPiiPayload(trace) as AgentTrace;
        onEvent({ type: "node_update", node: maskedTrace.agent, trace: maskedTrace, riskTier: chunk.riskTier });
      }
    }
    previous = chunk;
    finalState = chunk;
  }

  if (!finalState) {
    onEvent({ type: "error", message: "Orchestration graph produced no output." });
    return;
  }

  finalState=await attachInterruptMetadata(runId,finalState);
  const response = await buildOrchestrationResponse(runId, caseId, retailCase, approvalToken, finalState);
  if(response.pendingApproval)onEvent({type:"approval",runId,approval:response.pendingApproval});
  for(const result of response.actionResults??[])onEvent({type:"action",runId,result});
  for(const result of response.compensationResults??[])onEvent({type:"compensation",runId,result});
  onEvent({type:"terminal",runId,status:response.manualInterventionRequired?"manual_intervention_required":"completed"});
  onEvent({ type: "final", response });
};

export const resumeOrchestration=async(runId:string,tenantId:string):Promise<OrchestrationResponse>=>{
  const claimed=await pgQuery(`UPDATE orchestration_runs SET status='resuming' WHERE run_id=$1 AND tenant_id=$2 AND status='paused' RETURNING run_id`,[runId,tenantId]);
  if(!claimed.rows[0])throw new Error("RUN_NOT_PAUSED_OR_REPLAYED");
  try{
  const snapshot=await orchestrationGraph.getState({configurable:{thread_id:runId}});
  const state=snapshot.values as OrchestrationState;
  if(!state?.runId||state.tenantId!==tenantId) throw new Error("RUN_NOT_FOUND");
  const tenantConfig=await getTenantConfigVersion(tenantId,state.configVersion);
  if(!tenantConfig)throw new Error("PINNED_CONFIG_NOT_FOUND");
  const config={configurable:{thread_id:runId},recursionLimit:tenantConfig.runtime.maxSteps,signal:AbortSignal.timeout(tenantConfig.runtime.timeoutSeconds*1000)};
  const approval=await getLatestApproval(tenantId,runId);
  if(!approval||approval.status==="pending"||approval.status==="expired") throw new Error("APPROVAL_DECISION_REQUIRED");
  const finalState=await orchestrationGraph.invoke(new Command({resume:{approvalId:approval.id,decision:approval.status}}),config);
  const retailCase=await loadRetailCase(state.caseId,tenantId);
  if(!retailCase) throw new Error("CASE_NOT_FOUND");
  return await buildOrchestrationResponse(runId,state.caseId,retailCase,undefined,finalState);
  }catch(error){await pgQuery(`UPDATE orchestration_runs SET status='paused' WHERE run_id=$1 AND tenant_id=$2 AND status='resuming'`,[runId,tenantId]);throw error;}
};
