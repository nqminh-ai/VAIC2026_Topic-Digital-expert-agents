import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadRetailCase } from "../data/retail-case-loader";
import { evaluateCreditRules } from "../rules/credit-rule-engine";
import { queryProjectGuarantee, queryRegulationClause } from "../rag/policy-rag.service";
import { estimateCreditRisk } from "../tools/ml-credit-risk.tool";
import { calculateIncomeAfterHaircut, calculateCurrentMonthlyDebt } from "../calculators/dti.calculator";
import { projectBusinessValue } from "../business/profitability-engine";

const jsonContent = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  ...(isError ? { isError: true as const } : {}),
});

/**
 * Read-only MCP tool registry wrapping existing services. No tool here can write data
 * (no approval tickets, no disbursement) — those stay in operations.agent.ts, outside
 * MCP entirely. Every tool is a thin adapter: no new business logic, just serialization
 * around a service that already exists and is already exercised by the fixed pipeline.
 */
export const buildCreditToolServer = (): McpServer => {
  const server = new McpServer({ name: "vaic-credit-tools", version: "1.0.0" });

  server.registerTool(
    "get_retail_case",
    {
      description: "Tải hồ sơ khách hàng theo caseId. Chỉ dùng để lấy dữ liệu tham khảo, không dùng để ghi.",
      inputSchema: { caseId: z.string() },
    },
    async ({ caseId }) => {
      const retailCase = await loadRetailCase(caseId);
      return jsonContent(retailCase ?? { found: false }, !retailCase);
    }
  );

  server.registerTool(
    "evaluate_credit_rules",
    {
      description: "Chạy credit-rule-engine (DTI/LTV/tái cấu trúc) cho một caseId đã tồn tại trong hệ thống.",
      inputSchema: { caseId: z.string() },
    },
    async ({ caseId }) => {
      const retailCase = await loadRetailCase(caseId);
      if (!retailCase) return jsonContent({ found: false }, true);
      const result = evaluateCreditRules(
        `mcp-${caseId}`,
        calculateIncomeAfterHaircut(retailCase.incomeSources),
        calculateCurrentMonthlyDebt(retailCase.currentDebts),
        retailCase
      );
      return jsonContent(result);
    }
  );

  server.registerTool(
    "query_regulation_clause",
    {
      description: "Tra cứu nội dung một điều khoản quy định trong đồ thị tri thức pháp lý (Neo4j).",
      inputSchema: { clauseId: z.string() },
    },
    async ({ clauseId }) => {
      const clause = await queryRegulationClause(clauseId);
      return jsonContent(clause ?? { found: false }, !clause);
    }
  );

  server.registerTool(
    "query_project_guarantee",
    {
      description: "Tra cứu trạng thái bảo lãnh của một dự án bất động sản hình thành trong tương lai.",
      inputSchema: { projectCode: z.string() },
    },
    async ({ projectCode }) => {
      const project = await queryProjectGuarantee(projectCode);
      return jsonContent(project ?? { found: false }, !project);
    }
  );

  server.registerTool(
    "ml_credit_risk_score",
    {
      description:
        "Gọi mô hình ML risk-scoring bên ngoài (PD/LGD/expected loss) cho một caseId. Model service có thể không sẵn sàng — lỗi được trả về dưới dạng isError thay vì làm sập planning phase.",
      inputSchema: { caseId: z.string() },
    },
    async ({ caseId }) => {
      const retailCase = await loadRetailCase(caseId);
      if (!retailCase) return jsonContent({ found: false }, true);
      try {
        const result = await estimateCreditRisk(caseId, {
          age: retailCase.demographic.age,
          maritalStatus: retailCase.demographic.maritalStatus,
          requestedLoanAmount: retailCase.requestedLoan.amount,
          requestedTenureYears: retailCase.requestedLoan.tenureYears,
          propertyValue: retailCase.property.value,
          propertyStatus: retailCase.property.status,
          incomeAfterHaircut: calculateIncomeAfterHaircut(retailCase.incomeSources),
          currentMonthlyDebt: calculateCurrentMonthlyDebt(retailCase.currentDebts),
        });
        return jsonContent(result);
      } catch (error) {
        return jsonContent({ error: error instanceof Error ? error.message : "ml_credit_risk_score failed closed" }, true);
      }
    }
  );

  server.registerTool(
    "project_business_value",
    {
      description: "Ước tính lợi nhuận điều chỉnh rủi ro và RAROC cho một phương án vay cụ thể.",
      inputSchema: { loanAmount: z.number(), tenureYears: z.number(), annualRate: z.number() },
    },
    async ({ loanAmount, tenureYears, annualRate }) => {
      const result = projectBusinessValue({
        loanAmount,
        tenureYears,
        annualRate,
        approvalMode: "HYBRID_APPROVAL",
        source: "ORIGINAL_REQUEST",
      });
      return jsonContent(result);
    }
  );

  server.registerTool(
    "flag_for_fraud_investigation",
    {
      description:
        "Đánh dấu hồ sơ cần chạy Fraud/Anomaly Investigation Agent bổ sung. Gọi tool này KHI VÀ CHỈ KHI bạn quan sát thấy tín hiệu bất thường thật sự (không phải mặc định gọi cho mọi case) — ví dụ: tài sản là dự án hình thành trong tương lai với giá trị cao bất thường so với khoản vay, hồ sơ có nhiều khoản nợ hiện tại, hoặc kỳ hạn vay kéo dài tới tuổi cao. Tool này KHÔNG tự chạy điều tra — nó chỉ đặt cờ để hệ thống quyết định có chạy agent điều tra chuyên biệt hay không; agent đó sẽ tự chạy các kiểm tra deterministic (không phải bạn tự phán đoán kết quả).",
      inputSchema: { caseId: z.string(), reason: z.string().describe("Lý do ngắn gọn bằng tiếng Việt vì sao nghi ngờ cần điều tra thêm.") },
    },
    async ({ caseId, reason }) => jsonContent({ flagged: true, caseId, reason })
  );

  return server;
};
