import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { AgentTrace } from "../../types/trace.types";
import { ConditionPrecedent } from "../../types/agent.types";
import { runCustomerProfileAgent } from "../agents/customer-profile.agent";
import { runProductPolicyAgent } from "../agents/product-policy.agent";
import { runCreditAgent } from "../agents/credit.agent";
import { runLegalAgent } from "../agents/legal.agent";
import { runLegalAuditAgent } from "../agents/legal-audit.agent";
import { runFraudInvestigationAgent } from "../agents/fraud-investigation.agent";
import { runOperationsAgent } from "../agents/operations.agent";
import { decideNextAction } from "./decision-matrix.service";
import { recordAuditEvent } from "../governance/audit-log.service";
import { pgPool } from "../../config/pg";
import { loadRetailCase } from "../data/retail-case-loader";
import { RetailCase } from "../../types/case.types";
import { ApprovedLoanTerms, ApprovalMode, BusinessValueProjection, DecisionConfidence } from "../../types/product.types";
import { CreditAssessmentResult } from "../rules/credit-rule-engine";
import { evaluateAutoApprovalPolicy } from "../rules/auto-approval-policy.service";
import { projectBusinessValue } from "../business/profitability-engine";
import { decisionPolicy, productCatalog } from "../../config/policy";
import { assessDecisionConfidence } from "../governance/decision-confidence.service";
import { runPlanningPhase } from "../mcp/planning-client";

/**
 * Fast-lane eligibility is a conservative "clean file" rule: small ticket size,
 * completed (non-off-plan) collateral, no existing debts to net against income,
 * single applicant (no marital-property gate needed), and fully salaried income
 * (no haircut variance). Any case failing one of these goes through the full
 * Complex lane instead.
 */
const classifyRiskTier = (retailCase: RetailCase): "FAST" | "COMPLEX" => {
  const policy = decisionPolicy.fastLane;
  const isFastLaneEligible =
    retailCase.requestedLoan.amount <= policy.maximumLoanAmountVnd &&
    retailCase.property.status === policy.requiredPropertyStatus &&
    retailCase.demographic.maritalStatus === policy.requiredMaritalStatus &&
    (!policy.requireNoExistingDebt || retailCase.currentDebts.length === 0) &&
    retailCase.incomeSources.every(source => policy.allowedIncomeTypes.includes(source.type));

  return isFastLaneEligible ? "FAST" : "COMPLEX";
};

export type FinalDecision = "FAST_PASS" | "PASS" | "CONDITIONAL_PASS" | "REJECTED" | "HUMAN_ESCALATION";

/**
 * Orchestration state graph for the credit appraisal pipeline. Replaces the previous
 * imperative if/else chain in planner.service.ts — each specialist agent is a node,
 * and routing (fast vs. complex lane, the insurance-tying self-correction loop) is
 * expressed as conditional edges instead of nested branching, matching exactly the
 * business flow that existed before (same agents, same rules, same trace shape).
 */
export const OrchestrationAnnotation = Annotation.Root({
  // Inputs — set once by the caller before invoking the graph.
  runId: Annotation<string>(),
  requestedBy: Annotation<string>(),
  prompt: Annotation<string>(),
  caseId: Annotation<string>(),
  customerName: Annotation<string>(),
  approvalToken: Annotation<string | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),

  // Routing state, decided inside the graph.
  riskTier: Annotation<"FAST" | "COMPLEX">({ default: () => "COMPLEX", reducer: (_prev, next) => next }),
  terminalReason: Annotation<"BLOCKED" | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),

  modelCallsCount: Annotation<number>({ default: () => 0, reducer: (a, b) => a + b }),

  // One trace slot per pipeline stage. Overwritten (not appended) so the self-correction
  // loop can transparently replace the product/legal trace with its re-priced rerun,
  // exactly like the array-index replacement the previous imperative code did.
  plannerTrace: Annotation<AgentTrace | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  planningTrace: Annotation<AgentTrace | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  optionalToolResults: Annotation<Record<string, unknown>>({ default: () => ({}), reducer: (_prev, next) => next }),
  shouldRunFraudInvestigation: Annotation<boolean>({ default: () => false, reducer: (_prev, next) => next }),
  profileTrace: Annotation<AgentTrace | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  productTrace: Annotation<AgentTrace | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  creditTrace: Annotation<AgentTrace | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  legalTrace: Annotation<AgentTrace | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  legalAuditTrace: Annotation<AgentTrace | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  fraudTrace: Annotation<AgentTrace | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  selfCorrectionTrace: Annotation<AgentTrace | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  riskTrace: Annotation<AgentTrace | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  opsTrace: Annotation<AgentTrace | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),

  finalDecision: Annotation<FinalDecision>({ default: () => "PASS", reducer: (_prev, next) => next }),
  conditions: Annotation<ConditionPrecedent[]>({ default: () => [], reducer: (_prev, next) => next }),
  requiredFixes: Annotation<string[]>({ default: () => [], reducer: (_prev, next) => next }),
  ticketId: Annotation<string | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  approvalMode: Annotation<ApprovalMode>({ default: () => "HYBRID_APPROVAL", reducer: (_prev, next) => next }),
  approvedTerms: Annotation<ApprovedLoanTerms | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  businessValue: Annotation<BusinessValueProjection | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  confidence: Annotation<DecisionConfidence | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
});

export type OrchestrationState = typeof OrchestrationAnnotation.State;

const classifyNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const startedAt = new Date().toISOString();
  const initialAudit = await recordAuditEvent(state.runId, "gateway-governance", "model_call", { prompt: state.prompt }, "allowed");

  if (initialAudit.status === "blocked") {
    return {
      terminalReason: "BLOCKED",
      modelCallsCount: 1,
      plannerTrace: {
        id: `trace-planner-${Date.now()}`,
        runId: state.runId,
        agent: "planner",
        task: "Analyze prompt and determine workflow",
        status: "failed",
        summary: "HỒ SƠ BỊ CHẶN DO PHÁT HIỆN TẤN CÔNG BẢO MẬT (PROMPT INJECTION).",
        toolCalls: [],
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };
  }

  const retailCase = await loadRetailCase(state.caseId);
  const riskTier: "FAST" | "COMPLEX" = retailCase ? classifyRiskTier(retailCase) : "COMPLEX";

  return {
    riskTier,
    modelCallsCount: 1,
    plannerTrace: {
      id: `trace-planner-${Date.now()}`,
      runId: state.runId,
      agent: "planner",
      task: "Analyze prompt and determine workflow",
      status: "completed",
      summary: `Nhận diện yêu cầu vay của khách hàng. Phân loại luồng xử lý rủi ro: [${riskTier}]. Khởi tạo quy trình nghiệp vụ phù hợp.`,
      toolCalls: [
        {
          toolName: "detectRiskTier",
          input: { promptLength: state.prompt.length, caseId: state.caseId },
          output: { riskTier, caseId: state.caseId },
          status: "success",
        },
      ],
      startedAt,
      completedAt: new Date().toISOString(),
    },
  };
};

/**
 * Optional read-only planning phase: an LLM chooses extra tool calls via an in-process
 * MCP server/client pair (see mcp/planning-client.ts). It can only enrich context — it
 * never sets riskTier, never skips a mandatory agent, and a planning failure degrades to
 * "no extra context" instead of blocking the pipeline. mandatoryAgentsByLane enforcement
 * in riskNode is completely unaffected by anything this node does.
 */
const planningNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const { trace, optionalToolResults, shouldRunFraudInvestigation } = await runPlanningPhase(state.runId, state.caseId, state.riskTier);
  return {
    planningTrace: trace,
    optionalToolResults,
    shouldRunFraudInvestigation,
    modelCallsCount: trace.toolCalls.length > 0 ? 1 : 0,
  };
};

const profileNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const trace = await runCustomerProfileAgent(state.runId, state.caseId);
  return { profileTrace: trace, modelCallsCount: 1 };
};

const productNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const trace = await runProductPolicyAgent(state.runId, state.caseId, false);
  return { productTrace: trace, modelCallsCount: 1 };
};

const creditNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const trace = await runCreditAgent(state.runId, state.caseId);
  return { creditTrace: trace, modelCallsCount: 1 };
};

/**
 * Optional agent: the actual investigation only runs when the planning-phase LLM flagged
 * a concrete anomaly signal via flag_for_fraud_investigation. Always occupies this slot in
 * the graph (LangGraph conditional edges route to registered nodes, not "skip a node"), but
 * skips its own work with a lightweight trace when not flagged — no extra model/DB calls.
 * Not in mandatoryAgentsByLane, so its absence never trips the confidence gate — but when
 * it DOES run and finds something, its BLOCKER-severity findings flow into decideNextAction
 * like any other agent's, and can flip both the fast-lane and complex-lane verdict.
 */
const fraudNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  if (!state.shouldRunFraudInvestigation) {
    return {
      fraudTrace: {
        id: `trace-fraud-${Date.now()}`,
        runId: state.runId,
        agent: "fraud",
        task: "Investigate anomaly signals in the customer profile",
        status: "completed",
        summary: "Planner không phát hiện tín hiệu bất thường cần điều tra thêm cho hồ sơ này.",
        toolCalls: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      modelCallsCount: 0,
    };
  }

  const trace = await runFraudInvestigationAgent(state.runId, state.caseId);
  return { fraudTrace: trace, modelCallsCount: 0 };
};

const getCreditAssessment = (state: OrchestrationState): CreditAssessmentResult | undefined =>
  state.creditTrace?.toolCalls.find(call => call.toolName === "evaluateCreditRules")?.output as unknown as CreditAssessmentResult | undefined;

const getOfferRate = (state: OrchestrationState): number | undefined => {
  const offer = state.productTrace?.toolCalls.find(call => call.toolName === "buildPricingOffer")?.output as { appliedRate?: number } | undefined;
  return typeof offer?.appliedRate === "number" && Number.isFinite(offer.appliedRate) ? offer.appliedRate : undefined;
};

const autoPolicyNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const retailCase = await loadRetailCase(state.caseId);
  const credit = getCreditAssessment(state);
  const offerRate = getOfferRate(state);
  const confidence = assessDecisionConfidence("FAST", [state.profileTrace, state.productTrace, state.creditTrace]);
  if (!retailCase || !credit || offerRate === undefined || state.creditTrace?.status !== "completed" || confidence.status !== "VERIFIED") {
    return {
      finalDecision: "HUMAN_ESCALATION",
      approvalMode: "HYBRID_APPROVAL",
      confidence,
      requiredFixes: ["Auto-policy không đủ dữ liệu tin cậy; chuyển thẩm định thủ công.", ...confidence.reasons],
    };
  }

  const fraudFindings = state.fraudTrace?.findings || [];
  if (fraudFindings.length) {
    return {
      riskTier: "COMPLEX",
      finalDecision: "HUMAN_ESCALATION",
      approvalMode: "HYBRID_APPROVAL",
      confidence,
      requiredFixes: fraudFindings.map(f => f.requiredFix || f.finding),
    };
  }

  const hasProductConflict = state.productTrace?.findings?.some(finding =>
    finding.ruleIds?.includes(productCatalog.ruleIds.insuranceTying) && finding.evidence?.insuranceTyingApplied
  ) ?? false;
  const policy = evaluateAutoApprovalPolicy(retailCase, credit, hasProductConflict);
  if (!policy.eligible) {
    return { riskTier: "COMPLEX", finalDecision: "HUMAN_ESCALATION", approvalMode: "HYBRID_APPROVAL", requiredFixes: policy.reasonCodes };
  }

  const approvedTerms: ApprovedLoanTerms = {
    loanAmount: credit.originalScenario.loanAmount,
    tenureYears: credit.originalScenario.tenureYears,
    annualRate: offerRate,
    approvalMode: "AUTO_APPROVAL",
    source: "ORIGINAL_REQUEST",
  };
  return { finalDecision: "FAST_PASS", approvalMode: "AUTO_APPROVAL", approvedTerms, businessValue: projectBusinessValue(approvedTerms), confidence };
};

const legalNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const trace = await runLegalAgent(
    state.runId,
    state.caseId,
    state.prompt,
    state.productTrace?.findings || [],
    state.creditTrace?.findings || []
  );
  return { legalTrace: trace, modelCallsCount: 1 };
};

const selfCorrectionNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  await recordAuditEvent(
    state.runId,
    "planner-agent",
    "agent_call",
    {},
    "allowed",
    "Phát hiện vi phạm bán chéo bảo hiểm (Insurance Tying). Planner tự động kích hoạt vòng lặp định giá lại (Self-Correction Re-pricing Loop)."
  );

  const selfCorrectionTrace: AgentTrace = {
    id: `trace-planner-loop-${Date.now()}`,
    runId: state.runId,
    agent: "planner",
    task: "Resolve pricing-compliance conflict (Self-Correction Loop)",
    status: "completed",
    summary: "Cảnh báo pháp lý: Lãi suất bị ràng buộc với điều kiện mua bảo hiểm. Kích hoạt lệnh định giá lại không đi kèm bảo hiểm đối với Product Policy Agent và chạy lại kiểm duyệt pháp lý.",
    toolCalls: [],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  const productTrace = await runProductPolicyAgent(state.runId, state.caseId, true);
  const legalTrace = await runLegalAgent(
    state.runId,
    state.caseId,
    state.prompt,
    productTrace.findings || [],
    state.creditTrace?.findings || []
  );

  return { selfCorrectionTrace, productTrace, legalTrace, modelCallsCount: 2 };
};

/**
 * Independent verification step: re-derives the Legal Agent's citations from the
 * official source catalog (see citation-audit.service.ts) instead of trusting the
 * `citations` strings already on legalTrace. Runs after the self-correction reprice
 * loop too, since that loop overwrites legalTrace with a fresh legal reasoning pass.
 */
const legalAuditNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const trace = await runLegalAuditAgent(state.runId, state.legalTrace);
  return { legalAuditTrace: trace, modelCallsCount: 0 };
};

const riskNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const mandatoryFailure = [state.profileTrace, state.productTrace, state.creditTrace, state.legalTrace]
    .find(trace => !trace || trace.status === "failed");
  if (mandatoryFailure) {
    const confidence = assessDecisionConfidence("COMPLEX", [state.profileTrace, state.productTrace, state.creditTrace, state.legalTrace]);
    return {
      finalDecision: "HUMAN_ESCALATION",
      approvalMode: "HYBRID_APPROVAL",
      confidence,
      requiredFixes: [`Mandatory agent failed: ${mandatoryFailure?.agent ?? "unknown"}. Hệ thống fail-closed.`, ...confidence.reasons],
    };
  }

  const confidence = assessDecisionConfidence("COMPLEX", [state.profileTrace, state.productTrace, state.creditTrace, state.legalTrace]);

  const matrixOutput = decideNextAction(
    state.creditTrace?.findings || [],
    state.productTrace?.findings || [],
    [...(state.legalTrace?.findings || []), ...(state.legalAuditTrace?.findings || [])],
    state.fraudTrace?.findings || []
  );

  const riskTrace: AgentTrace = {
    id: `trace-risk-${Date.now()}`,
    runId: state.runId,
    agent: "risk",
    task: "Consolidate findings and assign final decision",
    status: "completed",
    summary: `Hội đồng rủi ro đã tổng hợp phán quyết: [${matrixOutput.finalDecision}]. Lý do: ${matrixOutput.reasonCodes.join(", ")}. Các lỗi cần sửa: ${matrixOutput.requiredFixes.join("; ") || "Không có"}.`,
    toolCalls: [
      {
        toolName: "decideNextAction",
        input: {
          creditFindingsCount: state.creditTrace?.findings?.length || 0,
          productFindingsCount: state.productTrace?.findings?.length || 0,
          legalFindingsCount: state.legalTrace?.findings?.length || 0,
          fraudFindingsCount: state.fraudTrace?.findings?.length || 0,
        },
        output: matrixOutput as unknown as Record<string, unknown>,
        status: "success",
      },
    ],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  const credit = getCreditAssessment(state);
  const scenario = credit?.restructureScenario?.status === "PASS" ? credit.restructureScenario : credit?.originalScenario;
  const offerRate = getOfferRate(state);
  const approvedTerms: ApprovedLoanTerms | undefined = scenario && offerRate !== undefined ? {
    loanAmount: scenario.loanAmount,
    tenureYears: scenario.tenureYears,
    annualRate: offerRate,
    approvalMode: "HYBRID_APPROVAL",
    source: credit?.restructureScenario?.status === "PASS" ? "RESTRUCTURED_PROPOSAL" : "ORIGINAL_REQUEST",
  } : undefined;
  const businessValue = approvedTerms ? projectBusinessValue(approvedTerms) : undefined;
  const profitabilityBlocked = businessValue && !businessValue.profitable && (matrixOutput.finalDecision === "PASS" || matrixOutput.finalDecision === "CONDITIONAL_PASS");
  const mustAbstain = confidence.status !== "VERIFIED" || offerRate === undefined;

  return {
    riskTrace,
    finalDecision: mustAbstain || profitabilityBlocked ? "HUMAN_ESCALATION" : matrixOutput.finalDecision,
    approvalMode: "HYBRID_APPROVAL",
    approvedTerms: mustAbstain ? undefined : approvedTerms,
    businessValue: mustAbstain ? undefined : businessValue,
    confidence,
    conditions: matrixOutput.conditions,
    requiredFixes: mustAbstain
      ? [...matrixOutput.requiredFixes, ...(offerRate === undefined ? ["MISSING_VERIFIED_OFFER_RATE"] : []), ...confidence.reasons]
      : profitabilityBlocked
        ? [...matrixOutput.requiredFixes, "Đề xuất chưa đạt profitability floor/RAROC tối thiểu."]
        : matrixOutput.requiredFixes,
    modelCallsCount: 1,
  };
};

const operationsNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const { trace, ticketId } = await runOperationsAgent(
    state.runId,
    state.caseId,
    state.finalDecision,
    state.conditions,
    state.approvalToken,
    state.approvalMode,
    state.approvedTerms
  );
  return { opsTrace: trace, ticketId };
};

const hasInsuranceTyingViolation = (state: OrchestrationState): boolean =>
  state.legalTrace?.findings?.some(f => f.ruleIds.includes(productCatalog.ruleIds.legalInsuranceTying)) ?? false;

const builder = new StateGraph(OrchestrationAnnotation)
  .addNode("classify", classifyNode)
  .addNode("planning", planningNode)
  .addNode("profile", profileNode)
  .addNode("product", productNode)
  .addNode("credit", creditNode)
  .addNode("fraud", fraudNode)
  .addNode("autoPolicy", autoPolicyNode)
  .addNode("legal", legalNode)
  .addNode("selfCorrection", selfCorrectionNode)
  .addNode("legalAudit", legalAuditNode)
  .addNode("risk", riskNode)
  .addNode("operations", operationsNode)
  .addEdge(START, "classify")
  .addConditionalEdges("classify", state => (state.terminalReason === "BLOCKED" ? "blocked" : "continue"), {
    blocked: END,
    continue: "planning",
  })
  .addEdge("planning", "profile")
  .addEdge("profile", "product")
  .addEdge("product", "credit")
  .addEdge("credit", "fraud")
  .addConditionalEdges("fraud", state => (state.riskTier === "FAST" ? "fast" : "complex"), {
    fast: "autoPolicy",
    complex: "legal",
  })
  .addConditionalEdges("autoPolicy", state => (state.finalDecision === "FAST_PASS" ? "approved" : "escalate"), {
    approved: "operations",
    escalate: "operations",
  })
  .addConditionalEdges("legal", state => (hasInsuranceTyingViolation(state) ? "reprice" : "noReprice"), {
    reprice: "selfCorrection",
    noReprice: "legalAudit",
  })
  .addEdge("selfCorrection", "legalAudit")
  .addEdge("legalAudit", "risk")
  .addEdge("risk", "operations")
  .addEdge("operations", END);

// Reuses the same Postgres pool as the audit log — no separate connection pool needed.
// Checkpointing means an in-flight run's graph state survives a server restart/crash
// instead of being lost like the previous in-memory trace store.
const checkpointer = new PostgresSaver(pgPool);

/** Must be called once at startup (see seed-db.ts) before the first graph invocation. */
export const setupOrchestrationCheckpointer = (): Promise<void> => checkpointer.setup();

export const orchestrationGraph = builder.compile({ checkpointer });

/** Rebuilds the ordered trace list from the final graph state, in the same order the
 * previous imperative pipeline produced traces (including in-place replacement of the
 * product/legal trace when the self-correction loop ran). */
export const assembleTraces = (state: OrchestrationState): AgentTrace[] =>
  [
    state.plannerTrace,
    state.planningTrace,
    state.profileTrace,
    state.productTrace,
    state.creditTrace,
    state.fraudTrace,
    state.legalTrace,
    state.selfCorrectionTrace,
    state.legalAuditTrace,
    state.riskTrace,
    state.opsTrace,
  ].filter((t): t is AgentTrace => t !== undefined);
