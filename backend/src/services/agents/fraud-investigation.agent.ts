import { AgentTrace, ToolCallTrace } from "../../types/trace.types";
import { DecisionEnvelope } from "../../types/agent.types";
import { RetailCase } from "../../types/case.types";
import { loadRetailCase } from "../data/retail-case-loader";
import { calculateIncomeAfterHaircut, calculateCurrentMonthlyDebt } from "../calculators/dti.calculator";
import { decisionPolicy } from "../../config/policy";
import { randomUUID } from "crypto";

interface FraudCheckOutcome {
  ruleId: string;
  triggered: boolean;
  detail: string;
  evidence: Record<string, unknown>;
}

/**
 * Deterministic outlier checks, not an LLM — same "rule engine + evidence" philosophy as
 * credit-rule-engine.ts. This is the anomaly-detection capability the brief asks to move
 * beyond "analysis only": findings with BLOCKER severity flow into decideNextAction's
 * catch-all safety net and can flip the final decision to HUMAN_ESCALATION, not just get
 * logged for later review.
 */
const runFraudChecks = (retailCase: RetailCase): FraudCheckOutcome[] => {
  const policy = decisionPolicy.fraud;
  const validIncome = calculateIncomeAfterHaircut(retailCase.incomeSources);
  const currentMonthlyDebt = calculateCurrentMonthlyDebt(retailCase.currentDebts);

  const checks: FraudCheckOutcome[] = [];

  // Total outstanding debt vastly exceeding recognized monthly income is a classic
  // undisclosed-liability / straw-borrower signal, distinct from the DTI policy ceiling
  // the credit agent already enforces (that compares monthly obligations, not principal).
  const outstandingDebt = retailCase.currentDebts.reduce((sum, debt) => sum + debt.outstandingAmount, 0);
  const incomeDebtRatio = validIncome > 0 ? outstandingDebt / validIncome : Infinity;
  checks.push({
    ruleId: policy.ruleIds.incomeDebtMismatch,
    triggered: incomeDebtRatio > policy.incomeDebtRatioCeiling,
    detail: `Tỷ lệ tổng dư nợ hiện tại / thu nhập hợp lệ hàng tháng: ${incomeDebtRatio === Infinity ? "vô hạn (không có thu nhập hợp lệ)" : incomeDebtRatio.toFixed(1)}x, ngưỡng cảnh báo: ${policy.incomeDebtRatioCeiling}x.`,
    evidence: { outstandingDebt, validIncome, incomeDebtRatio: Number.isFinite(incomeDebtRatio) ? Number(incomeDebtRatio.toFixed(2)) : null },
  });

  // Collateral value far above the requested loan amount doesn't itself invalidate a
  // case, but combined with a future-project property it's a common over-valuation
  // pattern used to inflate LTV headroom — worth a human second look, not an auto-block.
  const collateralRatio = retailCase.requestedLoan.amount > 0 ? retailCase.property.value / retailCase.requestedLoan.amount : Infinity;
  checks.push({
    ruleId: policy.ruleIds.collateralValueOutlier,
    triggered: collateralRatio > policy.collateralValueToLoanCeiling,
    detail: `Tỷ lệ giá trị tài sản thế chấp / khoản vay đề xuất: ${collateralRatio === Infinity ? "vô hạn" : collateralRatio.toFixed(1)}x, ngưỡng cảnh báo: ${policy.collateralValueToLoanCeiling}x.`,
    evidence: { propertyValue: retailCase.property.value, loanAmount: retailCase.requestedLoan.amount, collateralRatio: Number.isFinite(collateralRatio) ? Number(collateralRatio.toFixed(2)) : null },
  });

  // Loan tenure that runs the applicant past a normal working lifetime without any
  // explicit affordability note is a repayment-capacity red flag independent of DTI.
  const ageAtMaturity = retailCase.demographic.age + retailCase.requestedLoan.tenureYears;
  const maturityCeiling = 65 + policy.minimumRepaymentAgeMargin;
  checks.push({
    ruleId: policy.ruleIds.ageTenureMismatch,
    triggered: ageAtMaturity > maturityCeiling,
    detail: `Tuổi khách hàng tại thời điểm tất toán khoản vay: ${ageAtMaturity} (ngưỡng: ${maturityCeiling}).`,
    evidence: { currentAge: retailCase.demographic.age, tenureYears: retailCase.requestedLoan.tenureYears, ageAtMaturity },
  });

  // Duplicate or empty evidence strings across independently-sourced income entries
  // suggest copy-pasted or fabricated documentation rather than genuinely distinct proof.
  const evidenceTexts = retailCase.incomeSources.map(source => source.evidence?.trim() ?? "");
  const hasEmptyEvidence = evidenceTexts.some(text => !text);
  const hasDuplicateEvidence = new Set(evidenceTexts).size !== evidenceTexts.length && evidenceTexts.length > 1;
  checks.push({
    ruleId: policy.ruleIds.evidenceInconsistency,
    triggered: hasEmptyEvidence || hasDuplicateEvidence,
    detail: hasEmptyEvidence
      ? "Phát hiện nguồn thu nhập không có bằng chứng đính kèm."
      : hasDuplicateEvidence
        ? "Phát hiện nhiều nguồn thu nhập dùng chung một bằng chứng — nghi ngờ tài liệu bị sao chép."
        : "Không phát hiện bất thường về bằng chứng thu nhập.",
    evidence: { incomeSourceCount: retailCase.incomeSources.length, hasEmptyEvidence, hasDuplicateEvidence },
  });

  return checks;
};

export const runFraudInvestigationAgent = async (runId: string, caseId: string): Promise<AgentTrace> => {
  const startedAt = new Date().toISOString();
  const retailCase = await loadRetailCase(caseId);

  if (!retailCase) {
    return {
      id: `trace-fraud-${Date.now()}`,
      runId,
      agent: "fraud",
      task: "Investigate anomaly signals in the customer profile",
      status: "failed",
      summary: `Không tìm thấy hồ sơ cho caseId: ${caseId}`,
      toolCalls: [],
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  const checks = runFraudChecks(retailCase);
  const triggered = checks.filter(check => check.triggered);

  const toolCalls: ToolCallTrace[] = [
    {
      toolName: "runFraudChecks",
      input: { caseId },
      output: { checks: checks as unknown as Record<string, unknown>[] },
      status: "success",
    },
  ];

  const findings: DecisionEnvelope[] = triggered.map(check => ({
    decisionId: `dec-fraud-${randomUUID()}`,
    agent: "fraud",
    status: "VIOLATION",
    severity: "BLOCKER",
    blocksAt: "APPROVAL",
    finding: check.detail,
    evidence: check.evidence,
    ruleIds: [check.ruleId],
    citations: [],
    requiredFix: "Cần chuyên viên thẩm định thủ công xác minh lại thông tin trước khi phê duyệt do phát hiện tín hiệu bất thường.",
  }));

  const summary = triggered.length
    ? `Phát hiện ${triggered.length}/${checks.length} tín hiệu bất thường: ${triggered.map(c => c.ruleId).join(", ")}.`
    : `Đã kiểm tra ${checks.length} tín hiệu bất thường (thu nhập/nợ, định giá tài sản, tuổi/kỳ hạn, tính nhất quán bằng chứng) — không phát hiện bất thường.`;

  return {
    id: `trace-fraud-${Date.now()}`,
    runId,
    agent: "fraud",
    task: "Investigate anomaly signals in the customer profile",
    status: triggered.length ? "blocked" : "completed",
    summary,
    toolCalls,
    findings,
    startedAt,
    completedAt: new Date().toISOString(),
  };
};
