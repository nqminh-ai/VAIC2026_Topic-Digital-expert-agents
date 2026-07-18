export type AgentRole =
  | "planner"
  | "profile"
  | "credit"
  | "product"
  | "legal"
  | "legal_audit"
  | "fraud"
  | "risk"
  | "operations"
  | "governance";

export type AgentStatus = "pending" | "running" | "completed" | "blocked" | "failed";

export interface AgentTask {
  id: string;
  role: AgentRole;
  description: string;
  status: AgentStatus;
}

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

export interface ConditionPrecedent {
  id: string;
  description: string;
  blocksAt: BlocksAt;
  status: "pending" | "fulfilled";
}

export interface ProductOption {
  productId: string;
  name: string;
  baseRate: number; // annual rate (e.g., 0.083 for 8.3%)
  preferentialRate: number;
  tenureYearsMax: number;
  insuranceRequired: boolean;
}

export interface PricingOffer {
  selectedProduct: ProductOption;
  appliedRate: number;
  monthlyPaymentEstimate: number;
  insuranceTyingApplied: boolean;
  insurancePremiumEstimate?: number;
  note?: string;
}
