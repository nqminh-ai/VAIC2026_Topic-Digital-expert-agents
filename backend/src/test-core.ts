import assert from "node:assert/strict";
import { RETAIL_CASES } from "./services/data/retail-case-data";
import { calculateCurrentMonthlyDebt, calculateIncomeAfterHaircut } from "./services/calculators/dti.calculator";
import { evaluateCreditRules } from "./services/rules/credit-rule-engine";
import { evaluateAutoApprovalPolicy } from "./services/rules/auto-approval-policy.service";
import { projectBusinessValue } from "./services/business/profitability-engine";
import { routeDemoInput } from "./services/orchestration/input-router.service";
import { buildAnswerTransparency, groundLegalFindings } from "./services/governance/citation-governance.service";
import { DecisionEnvelope } from "./types/agent.types";
import { decideNextAction } from "./services/orchestration/decision-matrix.service";
import { maskPiiPayload } from "./services/governance/pii-masking.service";
import { AgentTrace } from "./types/trace.types";
import { assessDecisionConfidence } from "./services/governance/decision-confidence.service";
import { getKnowledgeGraphCatalog, validateKnowledgeGraphCatalog } from "./services/data/knowledge-graph-seed.service";

validateKnowledgeGraphCatalog();
const knowledgeGraphCatalog = getKnowledgeGraphCatalog();
assert.ok(
  knowledgeGraphCatalog.documents.some(document => document.documentId === "SBV_ASSET_CLASSIFICATION_CONSOLIDATED_2025"),
  "Knowledge graph must use the current consolidated asset-classification source"
);
assert.ok(
  knowledgeGraphCatalog.clauses.some(clause => clause.clauseId === "Clause-Personal-Data-Consent"),
  "Consent decisions must be grounded in a graph clause"
);
assert.ok(
  knowledgeGraphCatalog.policyRules.some(
    rule => rule.ruleId === "LEGAL_CONSENT_MISSING" && rule.gateId === "EXTERNAL_DATA_CALL"
  ),
  "Consent rule must block before an external data call"
);
assert.equal(
  knowledgeGraphCatalog.sourceSystems.find(source => source.sourceSystemId === "CIC")?.ingestionMode,
  "QUERY_JUST_IN_TIME",
  "Personal CIC data must not be bulk-ingested into the legal graph"
);

const assess = (caseId: string) => {
  const retailCase = RETAIL_CASES[caseId];
  return evaluateCreditRules(
    `test-${caseId}`,
    calculateIncomeAfterHaircut(retailCase.incomeSources),
    calculateCurrentMonthlyDebt(retailCase.currentDebts),
    retailCase
  );
};

const fastCase = RETAIL_CASES["case-fast-clean"];
const fastAssessment = assess("case-fast-clean");
assert.equal(fastAssessment.creditDecision, "PASS", "Clean fixture must pass deterministic credit rules");
assert.equal(evaluateAutoApprovalPolicy(fastCase, fastAssessment).eligible, true, "Clean fixture must satisfy every auto-policy gate");

const complexCase = RETAIL_CASES["case-complex-main"];
assert.equal(evaluateAutoApprovalPolicy(complexCase, assess("case-complex-main")).eligible, false, "Complex fixture must never enter auto approval");

const dtiFail = assess("case-dti-fail");
assert.equal(dtiFail.creditDecision, "FAIL", "Unaffordable fixture must fail after restructure search");

const value = projectBusinessValue({
  loanAmount: 500_000_000,
  tenureYears: 10,
  annualRate: 0.083,
  approvalMode: "AUTO_APPROVAL",
  source: "ORIGINAL_REQUEST",
});
assert.equal(value.profitable, true, "Representative clean loan should clear the demo profitability floor");
assert.ok(value.riskAdjustedProfit > 0);
assert.ok(value.estimatedProcessingCostSavedVnd > 0);

assert.deepEqual(routeDemoInput("hello world!!!"), {
  ok: false,
  code: "INVALID_INPUT",
  message: "Yêu cầu quá ngắn, quá dài hoặc không chứa đủ thông tin để thẩm định.",
});

const unsupported = routeDemoInput("Thẩm định khoản vay kinh doanh 987 triệu cho một khách hàng hoàn toàn mới.");
assert.equal(unsupported.ok, false, "Unknown cases must not fall back to a populated fixture");
if (!unsupported.ok) assert.equal(unsupported.code, "UNSUPPORTED_CASE");

const known = routeDemoInput("Thẩm định hồ sơ vay mua căn hộ của chị Bình, khoản vay 500 triệu VND.");
assert.equal(known.ok, true);
if (known.ok) assert.equal(known.caseId, "case-fast-clean");

const explicit = routeDemoInput("Thẩm định hồ sơ tín dụng theo case đã chọn.", "case-missing-consent");
assert.equal(explicit.ok, true);
if (explicit.ok) assert.equal(explicit.caseId, "case-missing-consent");

const invalidWithExplicitCase = routeDemoInput("hello world!!!", "case-fast-clean");
assert.equal(invalidWithExplicitCase.ok, false, "A valid caseId must never bypass prompt validation");
if (!invalidWithExplicitCase.ok) assert.equal(invalidWithExplicitCase.code, "INVALID_INPUT");

const untrustedLegalFinding: DecisionEnvelope = {
  decisionId: "dec-legal-test-1",
  agent: "legal",
  status: "VIOLATION",
  severity: "BLOCKER",
  blocksAt: "APPROVAL",
  finding: "Phát hiện gắn bảo hiểm không bắt buộc với khoản vay.",
  evidence: { insuranceTyingApplied: true },
  ruleIds: ["LEGAL_INSURANCE_TYING_DETECTED"],
  citations: ["citation do model tự tạo"],
};
const grounded = groundLegalFindings([untrustedLegalFinding]);
assert.deepEqual(grounded[0].citations, ["32/2024/QH15 - Điều 13, Điều 14 và khoản 5 Điều 15"]);
assert.throws(
  () => groundLegalFindings([{ ...untrustedLegalFinding, ruleIds: ["LEGAL_UNKNOWN_RULE"] }]),
  /Citation governance rejected/,
  "Unknown legal rules must fail closed instead of exposing unverified citations"
);

const transparent = buildAnswerTransparency(
  "Kết luận kiểm thử.",
  [{
    id: "trace-legal-test",
    runId: "run-test",
    agent: "legal",
    task: "test",
    status: "blocked",
    summary: "test",
    toolCalls: [],
    findings: grounded,
    startedAt: new Date(0).toISOString(),
  }],
  "HUMAN_ESCALATION",
  "HYBRID_APPROVAL"
);
assert.equal(transparent.transparency.evidenceCoveragePercent, 100);
assert.equal(transparent.transparency.requiresHumanReview, true);
assert.ok(transparent.finalAnswer.includes("[1]"));
assert.equal(transparent.transparency.citations[0].verificationStatus, "VERIFIED_OFFICIAL");

const missingGuaranteeEvidence: DecisionEnvelope = {
  ...untrustedLegalFinding,
  decisionId: "dec-legal-project-1",
  status: "BLOCKED",
  blocksAt: "DISBURSEMENT",
  finding: "Chưa xác minh được bằng chứng bảo lãnh dự án.",
  ruleIds: ["LEGAL_PROJECT_NOT_REGISTERED"],
};
assert.equal(
  decideNextAction([], [], [missingGuaranteeEvidence]).finalDecision,
  "HUMAN_ESCALATION",
  "Missing documents must trigger review, not an unsupported automatic rejection"
);

const maskedStreamTrace = maskPiiPayload({
  demographic: { name: "Nguyen Van Test", cccd: "012345678901", phone: "0912345678", email: "test.user@example.com" },
});
assert.notEqual(maskedStreamTrace.demographic.name, "Nguyen Van Test");
assert.notEqual(maskedStreamTrace.demographic.cccd, "012345678901");
assert.notEqual(maskedStreamTrace.demographic.phone, "0912345678");
assert.notEqual(maskedStreamTrace.demographic.email, "test.user@example.com");

const trustedTrace = (agent: "profile" | "product" | "credit"): AgentTrace => ({
  id: `trace-${agent}`,
  runId: "run-confidence",
  agent,
  task: "confidence-test",
  status: "completed",
  summary: "verified",
  toolCalls: [{ toolName: "deterministic-check", input: {}, output: { verified: true }, status: "success" }],
  findings: [{ ...untrustedLegalFinding, decisionId: `dec-${agent}`, agent, ruleIds: [`${agent.toUpperCase()}_VERIFIED`] }],
  startedAt: new Date(0).toISOString(),
});
const trustedFastTraces = [trustedTrace("profile"), trustedTrace("product"), trustedTrace("credit")];
assert.equal(assessDecisionConfidence("FAST", trustedFastTraces).status, "VERIFIED");
trustedFastTraces[2].toolCalls[0].status = "failed";
const abstained = assessDecisionConfidence("FAST", trustedFastTraces);
assert.equal(abstained.status, "NEEDS_REVIEW", "A failed tool call must prevent an automated decision");
assert.ok(abstained.reasons.includes("TOOL_FAILURE:credit"));

console.log("AI core checks passed: routing, versioned policy, confidence abstention, citation grounding, affordability and profitability.");
