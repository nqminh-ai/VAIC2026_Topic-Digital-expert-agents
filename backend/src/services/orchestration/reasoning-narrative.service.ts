import { AgentTrace } from "../../types/trace.types";
import { DecisionEnvelope, AgentRole } from "../../types/agent.types";
import { FinalDecision } from "./orchestration-graph";

const AGENT_LABEL: Record<AgentRole, string> = {
  planner: "Planner",
  profile: "Customer Profile Agent",
  credit: "Credit Risk Agent",
  product: "Product & Policy Agent",
  legal: "Legal & Compliance Agent",
  legal_audit: "Legal Audit Agent",
  fraud: "Fraud Investigation Agent",
  risk: "Risk Consolidation",
  operations: "Operations Agent",
  governance: "Governance",
};

const FINAL_DECISION_LABEL: Record<FinalDecision, string> = {
  FAST_PASS: "duyệt nhanh tự động (FAST_PASS)",
  PASS: "đề xuất phê duyệt (PASS)",
  CONDITIONAL_PASS: "phê duyệt có điều kiện sau tái cấu trúc (CONDITIONAL_PASS)",
  REJECTED: "từ chối tín dụng (REJECTED)",
  HUMAN_ESCALATION: "chuyển thẩm định thủ công (HUMAN_ESCALATION)",
};

interface DecisionMatrixOutputShape {
  vetoedBy?: string;
}

/**
 * Renders one sentence per material (non-INFO) finding, in the order its agent ran, so a
 * reviewer can see WHY the final decision landed where it did without reading every trace.
 * Deliberately template-based, not LLM-generated: it only rephrases findings that already
 * exist on the traces, so it can never contradict finalDecision or invent a rationale that
 * isn't backed by an actual DecisionEnvelope — the same "never trust free-form generation
 * for the decision itself" principle applied elsewhere in this codebase (citation-governance,
 * credit-rule-engine).
 */
const describeFinding = (agentLabel: string, finding: DecisionEnvelope): string => {
  const severityWord =
    finding.severity === "BLOCKER" ? "chặn (BLOCKER)" : finding.severity === "CONDITION" ? "gắn điều kiện (CONDITION)" : "cảnh báo (WARNING)";
  return `${agentLabel} phát hiện tín hiệu ${severityWord}: ${finding.finding}`;
};

export const buildReasoningNarrative = (traces: AgentTrace[], finalDecision: FinalDecision, requiredFixes: string[]): string => {
  const sentences: string[] = [];

  for (const trace of traces) {
    const materialFindings = (trace.findings ?? []).filter(f => f.severity !== "INFO");
    if (!materialFindings.length) continue;
    const agentLabel = AGENT_LABEL[trace.agent] ?? trace.agent;
    for (const finding of materialFindings) {
      sentences.push(describeFinding(agentLabel, finding));
    }
  }

  const riskTrace = traces.find(t => t.agent === "risk");
  const matrixOutput = riskTrace?.toolCalls.find(tc => tc.toolName === "decideNextAction")?.output as DecisionMatrixOutputShape | undefined;
  const vetoedByAgent = matrixOutput?.vetoedBy ? AGENT_LABEL[matrixOutput.vetoedBy as AgentRole] ?? matrixOutput.vetoedBy : undefined;

  const conclusionParts = [`Quyết định cuối cùng: ${FINAL_DECISION_LABEL[finalDecision]}.`];
  if (vetoedByAgent) {
    conclusionParts.push(`Quyết định này do ${vetoedByAgent} quyết định (veto) dựa trên phân cấp ưu tiên rủi ro của hệ thống.`);
  } else if (sentences.length === 0) {
    conclusionParts.push("Không phát hiện tín hiệu bất thường nào trong phạm vi các rule đã chạy.");
  }
  if (requiredFixes.length) {
    conclusionParts.push(`Yêu cầu xử lý tiếp: ${requiredFixes.join("; ")}.`);
  }

  return [...sentences, ...conclusionParts].join(" ");
};
