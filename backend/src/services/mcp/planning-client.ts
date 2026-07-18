import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ChatCompletionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getFptMarketplaceClient } from "../../config/fpt-marketplace";
import { config } from "../../config/env";
import { buildCreditToolServer } from "./tool-server";
import { AgentTrace, ToolCallTrace } from "../../types/trace.types";

const MAX_PLANNING_ITERATIONS = 4;

const SYSTEM_PROMPT = `Bạn là Planner Agent trong hệ thống thẩm định tín dụng bán lẻ.
Bạn KHÔNG quyết định agent bắt buộc nào chạy — profile, product, credit luôn chạy, và với hồ sơ
COMPLEX thì legal cũng luôn chạy. Việc đó do hệ thống ép buộc, không phải quyết định của bạn.

Nhiệm vụ của bạn: xem xét caseId và riskTier hiện tại, và CHỈ chọn thêm các tool BỔ SUNG (tùy
chọn) nếu hồ sơ có tín hiệu cần — ví dụ:
- gọi get_retail_case trước tiên để xem chi tiết hồ sơ.
- gọi ml_credit_risk_score nếu case có dấu hiệu DTI/LTV biên.
- gọi query_project_guarantee sớm nếu tài sản là dự án hình thành trong tương lai.
- gọi project_business_value để ước tính lợi nhuận sơ bộ trước khi các agent chính chạy.
- gọi flag_for_fraud_investigation nếu bạn thấy tín hiệu bất thường thật sự (nợ hiện tại
  nhiều so với thu nhập, tài sản định giá cao bất thường so với khoản vay, kỳ hạn vay kéo
  dài tới tuổi cao, hồ sơ có dấu hiệu không nhất quán) — CHỈ gọi khi có tín hiệu cụ thể,
  không gọi mặc định cho mọi case.

Nếu không có tín hiệu nào cần tool bổ sung, đừng gọi tool nào cả — kết thúc ngay.
Không gọi tool quá 3 lần trong một phiên.`;

const toOpenAiTools = (mcpTools: Array<{ name: string; description?: string; inputSchema: unknown }>): ChatCompletionTool[] =>
  mcpTools.map(tool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    },
  }));

export interface PlanningResult {
  trace: AgentTrace;
  optionalToolResults: Record<string, unknown>;
  shouldRunFraudInvestigation: boolean;
}

/**
 * Runs an optional, read-only planning phase before the mandatory agents. The MCP server
 * and client are wired together in-process via InMemoryTransport — no network hop, no
 * separate deployment. mandatoryAgentsByLane enforcement stays entirely in riskNode; this
 * phase can only ADD extra tool-call context, never skip or replace a mandatory agent.
 */
export const runPlanningPhase = async (runId: string, caseId: string, riskTier: "FAST" | "COMPLEX", tenantId = "bank-default"): Promise<PlanningResult> => {
  const startedAt = new Date().toISOString();
  const server = buildCreditToolServer(tenantId);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "vaic-planner", version: "1.0.0" });

  const toolCallLog: ToolCallTrace[] = [];
  const optionalToolResults: Record<string, unknown> = {};

  try {
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);

    const { tools } = await mcpClient.listTools();
    const openAiTools = toOpenAiTools(tools);

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `caseId: ${caseId}\nriskTier: ${riskTier}` },
    ];

    const llmClient = getFptMarketplaceClient();
    for (let iteration = 0; iteration < MAX_PLANNING_ITERATIONS; iteration++) {
      let response;
      try {
        response = await llmClient.chat.completions.create({
          model: config.fptPlannerModel,
          messages,
          tools: openAiTools,
          tool_choice: "auto",
        });
      } catch (primaryError) {
        console.warn(`Planner model ${config.fptPlannerModel} failed, retrying with fallback model ${config.fptLegalModel}:`, primaryError);
        response = await llmClient.chat.completions.create({
          model: config.fptLegalModel,
          messages,
          tools: openAiTools,
          tool_choice: "auto",
        });
      }

      const message = response.choices[0].message;
      messages.push(message);

      if (!message.tool_calls || message.tool_calls.length === 0) break;

      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== "function") continue;
        const input = JSON.parse(toolCall.function.arguments || "{}");

        try {
          const result = await mcpClient.callTool({ name: toolCall.function.name, arguments: input });
          const isError = Boolean((result as { isError?: boolean }).isError);
          const textContent = (result.content as Array<{ type: string; text?: string }>)
            .filter(part => part.type === "text")
            .map(part => part.text)
            .join("\n");
          const parsedOutput = (() => {
            try {
              return JSON.parse(textContent || "{}");
            } catch {
              return { raw: textContent };
            }
          })();

          toolCallLog.push({ toolName: toolCall.function.name, input, output: parsedOutput, status: isError ? "failed" : "success" });
          if (!isError) optionalToolResults[toolCall.function.name] = parsedOutput;

          messages.push({ role: "tool", tool_call_id: toolCall.id, content: textContent });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "unknown MCP tool error";
          toolCallLog.push({ toolName: toolCall.function.name, input, output: { error: errorMessage }, status: "failed" });
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ error: errorMessage }) });
        }
      }
    }
  } catch (error) {
    return {
      trace: {
        id: `trace-planning-${Date.now()}`,
        runId,
        agent: "planner",
        task: "Optional pre-flight tool planning (MCP)",
        status: "failed",
        summary: `Planning phase thất bại (không chặn pipeline): ${error instanceof Error ? error.message : "unknown error"}`,
        toolCalls: toolCallLog,
        startedAt,
        completedAt: new Date().toISOString(),
      },
      optionalToolResults,
      shouldRunFraudInvestigation: false,
    };
  } finally {
    await mcpClient.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }

  const summary = toolCallLog.length
    ? `Planner đã gọi thêm ${toolCallLog.length} tool tùy chọn qua MCP: ${toolCallLog.map(t => t.toolName).join(", ")}.`
    : "Planner không cần gọi thêm tool tùy chọn nào cho hồ sơ này.";

  return {
    trace: {
      id: `trace-planning-${Date.now()}`,
      runId,
      agent: "planner",
      task: "Optional pre-flight tool planning (MCP)",
      status: "completed",
      summary,
      toolCalls: toolCallLog,
      startedAt,
      completedAt: new Date().toISOString(),
    },
    optionalToolResults,
    shouldRunFraudInvestigation: Boolean(
      (optionalToolResults.flag_for_fraud_investigation as { flagged?: boolean } | undefined)?.flagged
    ),
  };
};
