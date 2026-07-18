// Mirrors backend/src/types/{agent,trace,orchestration}.types.ts — the wire contract
// between this frontend and the Express/LangGraph backend.

export type AgentRole =
  | "planner"
  | "profile"
  | "credit"
  | "product"
  | "legal"
  | "legal_audit"
  | "risk"
  | "operations"
  | "governance";

export type AgentStatus = "pending" | "running" | "completed" | "blocked" | "failed";

export type FindingSeverity = "INFO" | "CONDITION" | "WARNING" | "BLOCKER";

export type BlocksAt = "APPROVAL" | "CONTRACT_SIGNING" | "DISBURSEMENT" | "EXTERNAL_DATA_CALL" | "NONE";

export interface DecisionEnvelope {
  decisionId: string;
  agent: AgentRole;
  status: "PASS" | "CONDITIONAL_PASS" | "VIOLATION" | "BLOCKED" | "FAIL";
  severity: FindingSeverity;
  blocksAt: BlocksAt;
  finding: string;
  evidence: Record<string, unknown>;
  ruleIds: string[];
  citations: string[];
  requiredFix?: string;
}

export interface ToolCallTrace {
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  status: "success" | "failed";
}

export interface AgentTrace {
  id: string;
  runId: string;
  agent: AgentRole;
  task: string;
  status: AgentStatus | "completed" | "failed" | "blocked";
  summary: string;
  toolCalls: ToolCallTrace[];
  startedAt: string;
  completedAt?: string;
  findings?: DecisionEnvelope[];
}

export interface AuditEvent {
  eventId: string;
  runId: string;
  timestamp: string;
  actor: string;
  actionType: "agent_call" | "tool_call" | "model_call" | "dashboard_output" | "human_approval";
  status: "allowed" | "blocked";
  details: string;
}

export interface CostBudgetStatus {
  piiMasked: boolean;
  missingConsentCalls: number;
  highWritesBeforeApproval: number;
  modelCallsUsed: number;
  maxModelCalls: number;
  estimatedCostUSD: number;
  replayMode: boolean;
}

export interface ConditionPrecedent {
  id: string;
  description: string;
  blocksAt: BlocksAt;
  status: "pending" | "fulfilled";
}

export interface VerifiedCitation {
  id: string;
  documentNumber: string;
  title: string;
  issuer: string;
  locator: string;
  url?: string;
  sourceType: "LAW" | "DECREE" | "CIRCULAR" | "INTERNAL_POLICY" | "STANDARD";
  verificationStatus: "VERIFIED_OFFICIAL" | "INTERNAL_REVIEW_REQUIRED";
  effectiveFrom: string;
  lastVerifiedAt: string;
}

export interface AnswerTransparency {
  generatedAt: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidenceCoveragePercent: number;
  requiresHumanReview: boolean;
  policyVersion: string;
  claims: Array<{
    claimId: string;
    kind: "FACT" | "CALCULATION" | "DECISION" | "LIMITATION";
    text: string;
    citationIds: string[];
    traceIds: string[];
  }>;
  citations: VerifiedCitation[];
  limitations: string[];
}

export interface OrchestrationResponse {
  mode?: "CREDIT_APPRAISAL";
  runId: string;
  finalAnswer: string;
  /** Cross-agent narrative explaining WHY the decision landed where it did — see backend reasoning-narrative.service.ts. */
  reasoning?: string;
  traces: AgentTrace[];
  approvalTicketId?: string;
  conditions?: ConditionPrecedent[];
  budgetStatus?: CostBudgetStatus;
  auditEvents?: AuditEvent[];
  approvalMode?: "AUTO_APPROVAL" | "HYBRID_APPROVAL";
  approvedTerms?: {
    loanAmount: number;
    tenureYears: number;
    annualRate: number;
    source: "ORIGINAL_REQUEST" | "RESTRUCTURED_PROPOSAL";
  };
  businessValue?: {
    riskAdjustedProfit: number;
    rarocPercent: number;
    estimatedManualMinutesSaved: number;
    estimatedProcessingCostSavedVnd: number;
    profitable: boolean;
  };
  confidence?: {
    status: "VERIFIED" | "NEEDS_REVIEW";
    score: number;
    evidenceCoverage: number;
    reasons: string[];
    policyVersions: Record<string, string>;
  };
  transparency?: AnswerTransparency;
}

export type RiskTier = "FAST" | "COMPLEX";

/**
 * Returned instead of OrchestrationResponse when the backend's intent classifier routes
 * a request away from the credit pipeline entirely (see backend intent-classifier.service.ts
 * / advisory.agent.ts) — a single planner trace answers directly, no LangGraph run happened.
 */
export interface AdvisoryResponse {
  mode: "ADVISORY_QA" | "OUT_OF_DOMAIN";
  runId: string;
  finalAnswer: string;
  plannerTrace: AgentTrace;
  auditEvents?: AuditEvent[];
}

export type OrchestrationStreamEvent =
  | { type: "node_lifecycle"; runId: string; node: string; status: "started" | "completed" | "failed" | "paused"; timestamp: string }
  | { type: "validation"; runId: string; issues: Array<{ code: string; message: string; nodeId?: string; retryable: boolean }> }
  | { type: "approval"; runId: string; approval: { id: string; status: string; requiredRole: string; expiresAt: string } }
  | { type: "action"; runId: string; result: { stepId: string; status: string; attempts: number } }
    | { type: "compensation"; runId: string; result: { stepId: string; status: string; error?: string } }
    | { type: "terminal"; runId: string; status: "completed" | "rejected" | "failed" | "manual_intervention_required" }
    | { type: "node_update"; node: AgentRole; trace: AgentTrace; riskTier?: RiskTier }
    | { type: "final"; response: OrchestrationResponse }
    | { type: "advisory_final"; response: AdvisoryResponse }
    | { type: "error"; message: string; code?: string; questions?: string[] };

  export type UserRole = "CREDIT_OFFICER" | "CREDIT_APPROVER";

  export interface AuthUser {
    sub: string;
    role: UserRole;
    tenantId: string;
  }

  export interface CitationPolicy {
    required: boolean;
    rejectIfMissing: boolean;
    minimumConfidence: number;
    allowedSourceTypes: string[];
  }

  export interface TenantRuntimeConfig {
    tenantId: string;
    version: string;
    thresholds: { minCreditScore: number; maxDti: number };
    runtime: { maxRetriesPerAgent: number; maxSteps: number; maxTokens: number; timeoutSeconds: number };
    allowedModels: string[];
    citationPolicy: CitationPolicy;
    effectiveFrom: string;
    updatedBy: string;
  }
