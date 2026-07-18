import { OrchestrationResponse, OrchestrationStreamEvent, AdvisoryResponse } from "../../types/orchestration.types";
import { CostBudgetStatus, AgentTrace } from "../../types/trace.types";
import { RetailCase } from "../../types/case.types";
import { loadRetailCase } from "../data/retail-case-loader";
import { maskPiiPayload } from "../governance/pii-masking.service";
import { recordAuditEvent, getAuditEventsByRun } from "../governance/audit-log.service";
import { saveOrchestrationRun } from "./trace.service";
import { orchestrationGraph, assembleTraces, OrchestrationState } from "./orchestration-graph";
import { routeOrExtractInput, OrchestrationInputError } from "./input-router.service";
import { classifyIntent } from "./intent-classifier.service";
import { runAdvisoryAgent } from "../agents/advisory.agent";
import { buildAnswerTransparency } from "../governance/citation-governance.service";
import { buildReasoningNarrative } from "./reasoning-narrative.service";
import { decisionPolicy } from "../../config/policy";

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
      finalAnswer: transparentAnswer.finalAnswer,
      reasoning:
        "Planner phát hiện tín hiệu chặn (BLOCKER) ngay tại bước phân loại đầu vào: nội dung yêu cầu chứa chỉ thị điều khiển hệ thống trái phép (prompt injection). Quyết định cuối cùng: chặn bảo mật (SECURITY_BLOCKED). Không agent nghiệp vụ nào được chạy tiếp.",
      traces,
      budgetStatus: {
        piiMasked: true,
        missingConsentCalls: 0,
        highWritesBeforeApproval: 0,
        modelCallsUsed: finalState.modelCallsCount,
        maxModelCalls: decisionPolicy.runtimeBudget.maximumModelCalls,
        estimatedCostUSD: decisionPolicy.runtimeBudget.securityBlockEstimatedCostUsd,
        replayMode: true
      },
      auditEvents: await getAuditEventsByRun(runId),
      transparency: transparentAnswer.transparency,
    };
    saveOrchestrationRun(runId, response);
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

  const transparentAnswer = buildAnswerTransparency(finalAnswer, rawTraces, finalDecision, approvalMode, requiredFixes);

  // Cost budget calculation
  const missingConsent = !retailCase.consent.credit_check || !retailCase.consent.tax_income_check;
  const highWritesBeforeApproval = (finalDecision === "CONDITIONAL_PASS" || finalDecision === "PASS") && !approvalToken;

  const budgetStatus: CostBudgetStatus = {
    piiMasked: true,
    missingConsentCalls: missingConsent ? 1 : 0,
    highWritesBeforeApproval: highWritesBeforeApproval ? 1 : 0,
    modelCallsUsed: finalState.modelCallsCount,
    maxModelCalls: decisionPolicy.runtimeBudget.maximumModelCalls,
    estimatedCostUSD: Number((finalState.modelCallsCount * decisionPolicy.runtimeBudget.estimatedCostPerModelCallUsd).toFixed(4)),
    replayMode: true
  };

  const response: OrchestrationResponse = {
    mode: "CREDIT_APPRAISAL",
    runId,
    finalAnswer: transparentAnswer.finalAnswer,
    reasoning: buildReasoningNarrative(maskedTraces as AgentTrace[], finalDecision, requiredFixes),
    traces: maskedTraces,
    approvalTicketId: ticketId,
    conditions,
    budgetStatus,
    auditEvents: await getAuditEventsByRun(runId),
    approvalMode,
    approvedTerms,
    businessValue,
    confidence,
    transparency: transparentAnswer.transparency
  };

  saveOrchestrationRun(runId, response);
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

export const executeOrchestration = async (
  prompt: string,
  requestedBy: string,
  approvalToken?: string,
  requestedCaseId?: string
): Promise<OrchestrationResponse | AdvisoryResponse> => {
  const runId = `run-${Date.now()}`;

  if (!requestedCaseId) {
    const { intent } = await classifyIntent(prompt);
    if (intent === "ADVISORY_QA" || intent === "OUT_OF_DOMAIN") {
      return runAdvisoryFlow(runId, prompt, requestedBy, intent);
    }
  }

  const routed = await routeOrExtractInput(prompt, requestedCaseId);
  if (!routed.ok) throw new OrchestrationInputError(routed.code, routed.message, routed.questions);
  const { caseId } = routed;
  const retailCase = routed.extractedCase ?? await loadRetailCase(caseId);

  // Governance: Record starting audit event, attributed to the authenticated human requester.
  await recordAuditEvent(runId, requestedBy, "agent_call", { prompt, caseId }, "allowed", `Chuyên viên ${requestedBy} khởi chạy quy trình điều phối cho caseId: ${caseId}`);

  if (!retailCase) {
    return {
      runId,
      finalAnswer: "Không tìm thấy hồ sơ khách hàng tương ứng với yêu cầu.",
      traces: []
    };
  }

  // From here on, the pipeline (injection scan, fast/complex routing, self-correction
  // loop, decision matrix, operations) runs as a LangGraph StateGraph instead of an
  // imperative if/else chain — see orchestration-graph.ts.
  const finalState = await orchestrationGraph.invoke(
    {
      runId,
      requestedBy,
      prompt,
      approvalToken,
      caseId,
      customerName: retailCase.demographic.name
    },
    { configurable: { thread_id: runId } }
  );

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
  requestedCaseId?: string
): Promise<void> => {
  const runId = `run-${Date.now()}`;
  console.log(">>> RECEIVED PROMPT IN BACKEND:", JSON.stringify(prompt));

  if (!requestedCaseId) {
    const { intent } = await classifyIntent(prompt);
    if (intent === "ADVISORY_QA" || intent === "OUT_OF_DOMAIN") {
      const response = await runAdvisoryFlow(runId, prompt, requestedBy, intent);
      onEvent({ type: "advisory_final", response });
      return;
    }
  }

  const routed = await routeOrExtractInput(prompt, requestedCaseId);
  if (!routed.ok) throw new OrchestrationInputError(routed.code, routed.message, routed.questions);
  const { caseId } = routed;
  const retailCase = routed.extractedCase ?? await loadRetailCase(caseId);

  await recordAuditEvent(runId, requestedBy, "agent_call", { prompt, caseId }, "allowed", `Chuyên viên ${requestedBy} khởi chạy quy trình điều phối cho caseId: ${caseId}`);

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
      requestedBy,
      prompt,
      approvalToken,
      caseId,
      customerName: retailCase.demographic.name
    },
    { configurable: { thread_id: runId }, streamMode: "values" }
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

  const response = await buildOrchestrationResponse(runId, caseId, retailCase, approvalToken, finalState);
  onEvent({ type: "final", response });
};
