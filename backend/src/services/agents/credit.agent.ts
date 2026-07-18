import { AgentTrace } from "../../types/trace.types";
import { calculateIncomeAfterHaircut, calculateCurrentMonthlyDebt } from "../calculators/dti.calculator";
import { evaluateCreditRules } from "../rules/credit-rule-engine";
import { loadRetailCase } from "../data/retail-case-loader";

export const runCreditAgent = async (
  runId: string,
  caseId: string
): Promise<AgentTrace> => {
  const startedAt = new Date().toISOString();

  const retailCase = await loadRetailCase(caseId);

  if (!retailCase) {
    return {
      id: `trace-credit-${Date.now()}`,
      runId,
      agent: "credit",
      task: "Assess credit risk and calculate financial ratios",
      status: "failed",
      summary: "Case data not found.",
      toolCalls: [],
      startedAt,
      completedAt: new Date().toISOString()
    };
  }

  const validIncome = calculateIncomeAfterHaircut(retailCase.incomeSources);
  const currentMonthlyDebt = calculateCurrentMonthlyDebt(retailCase.currentDebts);

  const assessment = evaluateCreditRules(runId, validIncome, currentMonthlyDebt, retailCase);

  const summary = `Đã phân tích báo cáo tài chính rủi ro. Thu nhập hợp lệ sau giảm trừ (Haircut): ${validIncome.toLocaleString()} VND. Tổng nợ phải trả hàng tháng hiện tại: ${currentMonthlyDebt.toLocaleString()} VND. Trạng thái phân vùng thẩm định: [${assessment.creditDecision}].`;

  return {
    id: `trace-credit-${Date.now()}`,
    runId,
    agent: "credit",
    task: "Assess credit risk and calculate financial ratios",
    status: "completed",
    summary,
    toolCalls: [
      {
        toolName: "calculateIncomeAfterHaircut",
        input: { incomeSources: retailCase.incomeSources },
        output: { validIncome },
        status: "success"
      },
      {
        toolName: "calculateCurrentMonthlyDebt",
        input: { debts: retailCase.currentDebts },
        output: { currentMonthlyDebt },
        status: "success"
      },
      {
        toolName: "evaluateCreditRules",
        input: { validIncome, currentMonthlyDebt, requestedLoan: retailCase.requestedLoan },
        output: assessment as unknown as Record<string, unknown>,
        status: "success"
      }
    ],
    findings: assessment.findings,
    startedAt,
    completedAt: new Date().toISOString()
  };
};
