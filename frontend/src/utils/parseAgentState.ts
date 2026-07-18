import type { AgentRole, AgentTrace, RiskTier } from "../types/api";

// One entry per possible pipeline stage in the real LangGraph topology
// (see backend/src/services/orchestration/orchestration-graph.ts). "self-correction" is not
// a template stage — it's spliced in only when the insurance-tying re-pricing loop actually fires.
export type StepKey = "planner" | "profile" | "product" | "credit" | "legal" | "self-correction" | "legal_audit" | "risk" | "operations";

export const STEP_LABELS: Record<StepKey, string> = {
  planner: "Planner — Phân loại yêu cầu",
  profile: "Customer Profile Agent",
  product: "Product & Policy Agent",
  credit: "Credit Risk Agent",
  legal: "Legal & Compliance Agent",
  "self-correction": "Planner — Tự động định giá lại",
  legal_audit: "Legal Audit Agent — Kiểm chứng căn cứ pháp lý",
  risk: "Risk Consolidation",
  operations: "Operations Agent",
};

export const STEP_AGENT: Record<StepKey, AgentRole> = {
  planner: "planner",
  profile: "profile",
  product: "product",
  credit: "credit",
  legal: "legal",
  "self-correction": "planner",
  legal_audit: "legal_audit",
  risk: "risk",
  operations: "operations",
};

export const FAST_LANE_STEPS: StepKey[] = ["planner", "profile", "product", "operations"];
export const COMPLEX_LANE_STEPS: StepKey[] = ["planner", "profile", "product", "credit", "legal", "legal_audit", "risk", "operations"];

export const stepTemplateForRiskTier = (riskTier: RiskTier | undefined): StepKey[] =>
  riskTier === "FAST" ? FAST_LANE_STEPS : COMPLEX_LANE_STEPS;

/** Distinguishes the classify-time planner trace from the self-correction re-run, which both report agent "planner". */
export const deriveStepKey = (trace: AgentTrace): StepKey =>
  trace.id.startsWith("trace-planner-loop-") ? "self-correction" : (trace.agent as StepKey);
