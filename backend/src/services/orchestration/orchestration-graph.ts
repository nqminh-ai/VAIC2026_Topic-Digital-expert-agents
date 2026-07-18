import { Annotation, StateGraph, START, END, interrupt } from "@langchain/langgraph";
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
import {
  CorrectableStage,
  resolveValidationRoute,
  validateAgentTrace,
  validateDecisionOutput,
} from "./orchestration-validation.service";
import { ensurePendingApproval, getApprovedRecord } from "../platform/approval.service";
import { ActionStepResult, ApprovalRecord, CompensationResult, TenantRuntimeConfig } from "../../types/platform.types";

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
  tenantId: Annotation<string>(),
  workflowId: Annotation<string>(),
  workflowVersion: Annotation<string>(),
  configVersion: Annotation<string>(),
  workflowAllowsAction: Annotation<boolean>(),
  allowedActionTools: Annotation<string[]>(),
  maximumDtiPercent: Annotation<number>(),
  policyThresholds: Annotation<TenantRuntimeConfig["thresholds"] | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  maximumModelCalls: Annotation<number>(),
  requestedBy: Annotation<string>(),
  prompt: Annotation<string>(),
  caseId: Annotation<string>(),
  customerName: Annotation<string>(),
  approvalToken: Annotation<string | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  approvalRecord: Annotation<ApprovalRecord | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),
  actionResults: Annotation<ActionStepResult[]>({default:()=>[],reducer:(_prev,next)=>next}),
  compensationResults: Annotation<CompensationResult[]>({default:()=>[],reducer:(_prev,next)=>next}),
  manualInterventionRequired: Annotation<boolean>({default:()=>false,reducer:(_prev,next)=>next}),

  // Routing state, decided inside the graph.
  riskTier: Annotation<"FAST" | "COMPLEX">({ default: () => "COMPLEX", reducer: (_prev, next) => next }),
  terminalReason: Annotation<"BLOCKED" | undefined>({ default: () => undefined, reducer: (_prev, next) => next }),

  modelCallsCount: Annotation<number>({ default: () => 0, reducer: (a, b) => a + b }),
  validationAttempts: Annotation<Partial<Record<CorrectableStage, number>>>({
    default: () => ({}),
    reducer: (previous, next) => ({ ...previous, ...next }),
  }),
  validationErrors: Annotation<Partial<Record<CorrectableStage, string[]>>>({
    default: () => ({}),
    reducer: (previous, next) => ({ ...previous, ...next }),
  }),
  stageExecutionErrors: Annotation<Partial<Record<CorrectableStage, string>>>({
    default: () => ({}),
    reducer: (previous, next) => ({ ...previous, ...next }),
  }),

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

type StageNode = (state: OrchestrationState) => Promise<Partial<OrchestrationState>>;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Convert thrown node errors into state so the validation edge can retry the stage. */
const executeCorrectableStage = async (
  stage: CorrectableStage,
  node: StageNode,
  state: OrchestrationState
): Promise<Partial<OrchestrationState>> => {
  try {
    const result = await node(state);
    return { ...result, stageExecutionErrors: { [stage]: "" } };
  } catch (error) {
    return { stageExecutionErrors: { [stage]: errorMessage(error) } };
  }
};

const recordValidation = async (
  state: OrchestrationState,
  stage: CorrectableStage,
  errors: string[]
): Promise<Partial<OrchestrationState>> => {
  const executionError = state.stageExecutionErrors[stage];
  const allErrors = [...new Set([...(executionError ? [`${stage}: ${executionError}`] : []), ...errors])];
  const failedValidations = (state.validationAttempts[stage] ?? 0) + (allErrors.length > 0 ? 1 : 0);

  if (allErrors.length > 0) {
    await recordAuditEvent(
      state.runId,
      "planner-agent",
      "agent_call",
      { stage, failedValidations, errors: allErrors },
      "allowed",
      `Validation failed at ${stage}; LangGraph will retry while the correction budget remains.`
    );
  }

  return {
    validationAttempts: { [stage]: failedValidations },
    validationErrors: { [stage]: allErrors },
  };
};

const validationRoute = (state: OrchestrationState, stage: CorrectableStage) =>
  resolveValidationRoute(
    state.validationErrors[stage] ?? [],
    state.validationAttempts[stage] ?? 0,
    state.modelCallsCount,
    state.maximumModelCalls
  );

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

  const retailCase = await loadRetailCase(state.caseId, state.tenantId);
  if (!retailCase) {
    return {
      modelCallsCount: 1,
      plannerTrace: {
        id: `trace-planner-${Date.now()}`,
        runId: state.runId,
        agent: "planner",
        task: "Analyze prompt and determine workflow",
        status: "failed",
        summary: `Không thể tải hồ sơ ${state.caseId} từ nguồn dữ liệu đã xác minh.`,
        toolCalls: [],
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };
  }
  const riskTier: "FAST" | "COMPLEX" = classifyRiskTier(retailCase);

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
  const { trace, optionalToolResults, shouldRunFraudInvestigation } = await runPlanningPhase(state.runId, state.caseId, state.riskTier, state.tenantId);
  return {
    planningTrace: trace,
    optionalToolResults,
    shouldRunFraudInvestigation,
    modelCallsCount: trace.toolCalls.length > 0 ? 1 : 0,
  };
};

const profileNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const trace = await runCustomerProfileAgent(state.runId, state.caseId, state.tenantId);
  return { profileTrace: trace, modelCallsCount: 1 };
};

const productNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const trace = await runProductPolicyAgent(state.runId, state.caseId, false, state.tenantId);
  return { productTrace: trace, modelCallsCount: 1 };
};

const creditNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const thresholds = state.policyThresholds;
  const trace = await runCreditAgent(state.runId, state.caseId, state.tenantId, {
    maximumDtiPercent: state.maximumDtiPercent,
    maximumLtvPercentByPropertyType: thresholds?.maxLtvByPropertyType,
    incomeRecognitionFactors: thresholds?.incomeHaircuts,
    minimumMonthlyLivingExpenseVnd: thresholds?.minimumMonthlyLivingExpenseVnd,
  });
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

  const thresholds = state.policyThresholds;
  const trace = await runFraudInvestigationAgent(state.runId, state.caseId, state.tenantId, {
    incomeDebtRatioCeiling: thresholds?.fraud?.incomeDebtRatioCeiling,
    collateralValueToLoanCeiling: thresholds?.fraud?.collateralValueToLoanCeiling,
    minimumRepaymentAgeMargin: thresholds?.maximumRepaymentAgeMargin,
  });
  return { fraudTrace: trace, modelCallsCount: 0 };
};

const getCreditAssessment = (state: OrchestrationState): CreditAssessmentResult | undefined =>
  state.creditTrace?.toolCalls.find(call => call.toolName === "evaluateCreditRules")?.output as unknown as CreditAssessmentResult | undefined;

const getOfferRate = (state: OrchestrationState): number | undefined => {
  const offer = state.productTrace?.toolCalls.find(call => call.toolName === "buildPricingOffer")?.output as { appliedRate?: number } | undefined;
  return typeof offer?.appliedRate === "number" && Number.isFinite(offer.appliedRate) ? offer.appliedRate : undefined;
};

const autoPolicyNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  const retailCase = await loadRetailCase(state.caseId, state.tenantId);
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
  const maximumLtvPercent = state.policyThresholds?.maxLtvByPropertyType?.[retailCase.property.type] ?? decisionPolicy.autoApproval.maximumLtvPercent;
  const policy = evaluateAutoApprovalPolicy(retailCase, credit, hasProductConflict, state.maximumDtiPercent, maximumLtvPercent);
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
    ,state.tenantId
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

  const productTrace = await runProductPolicyAgent(state.runId, state.caseId, true, state.tenantId);
  const legalTrace = await runLegalAgent(
    state.runId,
    state.caseId,
    state.prompt,
    productTrace.findings || [],
    state.creditTrace?.findings || []
    ,state.tenantId
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
  const { trace, ticketId,actionResults,compensationResults,manualInterventionRequired } = await runOperationsAgent(
    state.runId,
    state.caseId,
    state.finalDecision,
    state.conditions,
    state.approvalToken,
    state.approvalMode,
    state.approvedTerms,
    state.tenantId,
    state.approvalRecord?.status === "approved",
    state.approvalRecord?.decidedBy,
    state.workflowAllowsAction,
    state.allowedActionTools
  );
  return { opsTrace: trace, ticketId,actionResults,compensationResults,manualInterventionRequired };
};

const humanApprovalNode = async (state: OrchestrationState): Promise<Partial<OrchestrationState>> => {
  if (state.finalDecision !== "PASS" && state.finalDecision !== "CONDITIONAL_PASS") return {};
  const approval=await ensurePendingApproval({tenantId:state.tenantId,runId:state.runId,checkpointId:state.runId,workflowId:state.workflowId,workflowVersion:state.workflowVersion,requiredRole:"CREDIT_APPROVER",expiresAt:new Date(Date.now()+24*60*60*1000).toISOString()});
  const resumed=interrupt<{approvalId:string;runId:string;requiredRole:string;expiresAt:string},{approvalId:string;decision:"approved"|"rejected"|"more_information"}>({approvalId:approval.id,runId:state.runId,requiredRole:approval.requiredRole,expiresAt:approval.expiresAt});
  if(resumed.approvalId!==approval.id) throw new Error("APPROVAL_RESUME_MISMATCH");
  if(resumed.decision!=="approved") return {approvalRecord:{...approval,status:resumed.decision},finalDecision:resumed.decision==="rejected"?"REJECTED":"HUMAN_ESCALATION",requiredFixes:[resumed.decision==="rejected"?"Người phê duyệt đã từ chối hồ sơ.":"Người phê duyệt yêu cầu bổ sung thông tin."]};
  const persisted=await getApprovedRecord(state.tenantId,state.runId);
  if(!persisted||persisted.id!==approval.id) throw new Error("APPROVAL_NOT_PERSISTED");
  return {approvalRecord:persisted};
};

const hasInsuranceTyingViolation = (state: OrchestrationState): boolean =>
  state.legalTrace?.findings?.some(f => f.ruleIds.includes(productCatalog.ruleIds.legalInsuranceTying)) ?? false;

const validateClassifyNode: StageNode = state => recordValidation(
  state,
  "classify",
  validateAgentTrace(state.plannerTrace, {
    runId: state.runId,
    agent: "planner",
    requiredTools: ["detectRiskTier"],
  })
);

const validateProfileNode: StageNode = state => recordValidation(
  state,
  "profile",
  validateAgentTrace(state.profileTrace, {
    runId: state.runId,
    agent: "profile",
    requiredTools: ["loadCustomerProfile", "loadConsentRegistry"],
  })
);

const validateProductNode: StageNode = state => recordValidation(
  state,
  "product",
  validateAgentTrace(state.productTrace, {
    runId: state.runId,
    agent: "product",
    requiredTools: ["matchEligibleProducts", "buildPricingOffer"],
  })
);

const validateCreditNode: StageNode = state => recordValidation(
  state,
  "credit",
  validateAgentTrace(state.creditTrace, {
    runId: state.runId,
    agent: "credit",
    requiredTools: ["calculateIncomeAfterHaircut", "calculateCurrentMonthlyDebt", "evaluateCreditRules"],
  })
);

const validateFraudNode: StageNode = state => recordValidation(
  state,
  "fraud",
  validateAgentTrace(state.fraudTrace, {
    runId: state.runId,
    agent: "fraud",
    requiredTools: state.shouldRunFraudInvestigation ? ["runFraudChecks"] : [],
  })
);

const validateAutoPolicyNode: StageNode = state => recordValidation(
  state,
  "autoPolicy",
  validateDecisionOutput({
    finalDecision: state.finalDecision,
    approvalMode: state.approvalMode,
    approvedTerms: state.approvedTerms,
    confidenceStatus: state.confidence?.status,
    requiredFixes: state.requiredFixes,
  })
);

const validateLegalNode: StageNode = state => recordValidation(
  state,
  "legal",
  validateAgentTrace(state.legalTrace, {
    runId: state.runId,
    agent: "legal",
    requireAnyTool: true,
  })
);

const validateSelfCorrectionNode: StageNode = state => {
  const errors = [
    ...validateAgentTrace(state.productTrace, {
      runId: state.runId,
      agent: "product",
      requiredTools: ["matchEligibleProducts", "buildPricingOffer"],
    }),
    ...validateAgentTrace(state.legalTrace, {
      runId: state.runId,
      agent: "legal",
      requireAnyTool: true,
    }),
  ];
  if (hasInsuranceTyingViolation(state)) {
    errors.push("selfCorrection: insurance-tying violation remains after repricing");
  }
  return recordValidation(state, "selfCorrection", errors);
};

const validateLegalAuditNode: StageNode = state => recordValidation(
  state,
  "legalAudit",
  validateAgentTrace(state.legalAuditTrace, {
    runId: state.runId,
    agent: "legal_audit",
    requiredTools: ["auditLegalFindings"],
  })
);

const validateRiskNode: StageNode = state => recordValidation(
  state,
  "risk",
  [
    ...validateAgentTrace(state.riskTrace, {
      runId: state.runId,
      agent: "risk",
      requiredTools: ["decideNextAction"],
    }),
    ...validateDecisionOutput({
      finalDecision: state.finalDecision,
      approvalMode: state.approvalMode,
      approvedTerms: state.approvedTerms,
      confidenceStatus: state.confidence?.status,
      requiredFixes: state.requiredFixes,
    }),
  ]
);

const validationFailureNode: StageNode = async state => {
  const errors = Object.entries(state.validationErrors)
    .flatMap(([stage, stageErrors]) => (stageErrors ?? []).map(error => `${stage}: ${error}`));
  const requiredFixes = errors.length > 0
    ? errors.map(error => `AUTO_CORRECTION_EXHAUSTED: ${error}`)
    : ["AUTO_CORRECTION_EXHAUSTED: Không thể xác minh đầu ra của bước xử lý."];
  const startedAt = new Date().toISOString();

  await recordAuditEvent(
    state.runId,
    "planner-agent",
    "agent_call",
    { validationAttempts: state.validationAttempts, errors },
    "blocked",
    "LangGraph exhausted the bounded correction loop and failed closed to human review."
  );

  return {
    finalDecision: "HUMAN_ESCALATION",
    approvalMode: "HYBRID_APPROVAL",
    approvedTerms: undefined,
    businessValue: undefined,
    ticketId: undefined,
    requiredFixes,
    riskTrace: {
      id: `trace-risk-validation-${Date.now()}`,
      runId: state.runId,
      agent: "risk",
      task: "Fail closed after bounded LangGraph self-correction",
      status: "completed",
      summary: `Dừng tự động sau khi hết số lần sửa sai. Chuyển ${errors.length || 1} lỗi sang chuyên viên thẩm định.`,
      toolCalls: [{
        toolName: "validateStageOutputs",
        input: { attempts: state.validationAttempts },
        output: { errors },
        status: "success",
      }],
      startedAt,
      completedAt: new Date().toISOString(),
    },
  };
};

const builder = new StateGraph(OrchestrationAnnotation)
  .addNode("classify", state => executeCorrectableStage("classify", classifyNode, state))
  .addNode("validateClassify", validateClassifyNode)
  .addNode("planning", planningNode)
  .addNode("profile", state => executeCorrectableStage("profile", profileNode, state))
  .addNode("validateProfile", validateProfileNode)
  .addNode("product", state => executeCorrectableStage("product", productNode, state))
  .addNode("validateProduct", validateProductNode)
  .addNode("credit", state => executeCorrectableStage("credit", creditNode, state))
  .addNode("validateCredit", validateCreditNode)
  .addNode("fraud", state => executeCorrectableStage("fraud", fraudNode, state))
  .addNode("validateFraud", validateFraudNode)
  .addNode("autoPolicy", state => executeCorrectableStage("autoPolicy", autoPolicyNode, state))
  .addNode("validateAutoPolicy", validateAutoPolicyNode)
  .addNode("legal", state => executeCorrectableStage("legal", legalNode, state))
  .addNode("validateLegal", validateLegalNode)
  .addNode("selfCorrection", state => executeCorrectableStage("selfCorrection", selfCorrectionNode, state))
  .addNode("validateSelfCorrection", validateSelfCorrectionNode)
  .addNode("legalAudit", state => executeCorrectableStage("legalAudit", legalAuditNode, state))
  .addNode("validateLegalAudit", validateLegalAuditNode)
  .addNode("risk", state => executeCorrectableStage("risk", riskNode, state))
  .addNode("validateRisk", validateRiskNode)
  .addNode("validationFailure", validationFailureNode)
  .addNode("humanApproval", humanApprovalNode)
  .addNode("operations", operationsNode)
  .addEdge(START, "classify")
  .addConditionalEdges("classify", state => (state.terminalReason === "BLOCKED" ? "blocked" : "continue"), {
    blocked: END,
    continue: "validateClassify",
  })
  .addConditionalEdges("validateClassify", state => validationRoute(state, "classify"), {
    retry: "classify",
    continue: "planning",
    fail: "validationFailure",
  })
  .addEdge("planning", "profile")
  .addEdge("profile", "validateProfile")
  .addConditionalEdges("validateProfile", state => validationRoute(state, "profile"), {
    retry: "profile",
    continue: "product",
    fail: "validationFailure",
  })
  .addEdge("product", "validateProduct")
  .addConditionalEdges("validateProduct", state => validationRoute(state, "product"), {
    retry: "product",
    continue: "credit",
    fail: "validationFailure",
  })
  .addEdge("credit", "validateCredit")
  .addConditionalEdges("validateCredit", state => validationRoute(state, "credit"), {
    retry: "credit",
    continue: "fraud",
    fail: "validationFailure",
  })
  .addEdge("fraud", "validateFraud")
  .addConditionalEdges("validateFraud", state => {
    const route = validationRoute(state, "fraud");
    return route === "continue" ? (state.riskTier === "FAST" ? "fast" : "complex") : route;
  }, {
    retry: "fraud",
    fail: "validationFailure",
    fast: "autoPolicy",
    complex: "legal",
  })
  .addEdge("autoPolicy", "validateAutoPolicy")
  .addConditionalEdges("validateAutoPolicy", state => validationRoute(state, "autoPolicy"), {
    retry: "autoPolicy",
    continue: "humanApproval",
    fail: "validationFailure",
  })
  .addEdge("legal", "validateLegal")
  .addConditionalEdges("validateLegal", state => {
    const route = validationRoute(state, "legal");
    return route === "continue" ? (hasInsuranceTyingViolation(state) ? "reprice" : "noReprice") : route;
  }, {
    retry: "legal",
    fail: "validationFailure",
    reprice: "selfCorrection",
    noReprice: "legalAudit",
  })
  .addEdge("selfCorrection", "validateSelfCorrection")
  .addConditionalEdges("validateSelfCorrection", state => validationRoute(state, "selfCorrection"), {
    retry: "selfCorrection",
    continue: "legalAudit",
    fail: "validationFailure",
  })
  .addEdge("legalAudit", "validateLegalAudit")
  .addConditionalEdges("validateLegalAudit", state => validationRoute(state, "legalAudit"), {
    retry: "legalAudit",
    continue: "risk",
    fail: "validationFailure",
  })
  .addEdge("risk", "validateRisk")
  .addConditionalEdges("validateRisk", state => validationRoute(state, "risk"), {
    retry: "risk",
    continue: "humanApproval",
    fail: "validationFailure",
  })
  .addEdge("validationFailure", "operations")
  .addEdge("humanApproval", "operations")
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
