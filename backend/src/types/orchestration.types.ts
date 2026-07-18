import { AgentTrace, AuditEvent, CostBudgetStatus } from "./trace.types";
import { ConditionPrecedent } from "./agent.types";
import { ApprovedLoanTerms, ApprovalMode, BusinessValueProjection, DecisionConfidence } from "./product.types";

export type CitationSourceType = "LAW" | "DECREE" | "CIRCULAR" | "INTERNAL_POLICY" | "STANDARD";
export type CitationVerificationStatus = "VERIFIED_OFFICIAL" | "INTERNAL_REVIEW_REQUIRED";

export interface VerifiedCitation {
  id: string;
  documentNumber: string;
  title: string;
  issuer: string;
  locator: string;
  url?: string;
  sourceType: CitationSourceType;
  verificationStatus: CitationVerificationStatus;
  effectiveFrom: string;
  lastVerifiedAt: string;
}

export interface AnswerClaim {
  claimId: string;
  kind: "FACT" | "CALCULATION" | "DECISION" | "LIMITATION";
  text: string;
  citationIds: string[];
  traceIds: string[];
}

export interface AnswerTransparency {
  generatedAt: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidenceCoveragePercent: number;
  requiresHumanReview: boolean;
  policyVersion: string;
  claims: AnswerClaim[];
  citations: VerifiedCitation[];
  limitations: string[];
}

export interface OrchestrationRequest {
  prompt: string;
  caseId?: string;
  approvalToken?: string;
}

export interface OrchestrationResponse {
  mode?: "CREDIT_APPRAISAL";
  runId: string;
  finalAnswer: string;
  /**
   * Cross-agent narrative synthesizing WHY the final decision landed where it did —
   * one sentence per material (non-INFO) finding across all agents that ran, in
   * execution order, plus a closing statement naming which agent's veto (if any) drove
   * the outcome. Template-generated from the same findings already on `traces` (see
   * reasoning-narrative.service.ts) — never a free-form LLM narrative, so it can't
   * diverge from or contradict the decision the traces already show.
   */
  reasoning?: string;
  traces: AgentTrace[];
  approvalTicketId?: string;
  conditions?: ConditionPrecedent[];
  budgetStatus?: CostBudgetStatus;
  auditEvents?: AuditEvent[];
  approvalMode?: ApprovalMode;
  approvedTerms?: ApprovedLoanTerms;
  businessValue?: BusinessValueProjection;
  confidence?: DecisionConfidence;
  transparency?: AnswerTransparency;
}

/**
 * Response shape for requests the intent classifier routes away from the credit
 * pipeline entirely (see intent-classifier.service.ts): the planner answers directly
 * without invoking orchestrationGraph, so there is no per-agent trace list to report —
 * the frontend renders the fixed pipeline template with every stage after "planner"
 * marked skipped instead of replaying a LangGraph run that never happened.
 */
export interface AdvisoryResponse {
  mode: "ADVISORY_QA" | "OUT_OF_DOMAIN";
  runId: string;
  finalAnswer: string;
  plannerTrace: AgentTrace;
  auditEvents?: AuditEvent[];
}

/**
 * Wire protocol for the streaming orchestration endpoint (NDJSON, one event per line).
 * "node_update" fires the moment a pipeline stage's trace appears in the LangGraph state
 * (i.e. that agent has just finished) — the client infers "in progress" for whichever node
 * is next in the known pipeline order rather than the backend faking a separate start signal.
 */
export type OrchestrationStreamEvent =
  | { type: "node_update"; node: AgentTrace["agent"]; trace: AgentTrace; riskTier?: "FAST" | "COMPLEX" }
  | { type: "final"; response: OrchestrationResponse }
  | { type: "advisory_final"; response: AdvisoryResponse }
  | { type: "error"; message: string; code?: string; questions?: string[] };
