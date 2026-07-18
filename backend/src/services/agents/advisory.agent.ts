import { getFptMarketplaceClient } from "../../config/fpt-marketplace";
import { config } from "../../config/env";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { AgentTrace } from "../../types/trace.types";
import { Intent } from "../orchestration/intent-classifier.service";

const ADVISORY_SYSTEM_PROMPT = `Bạn là Trợ lý tư vấn nghiệp vụ của SHB, hỗ trợ chuyên viên tín dụng trả lời các câu hỏi
chung về chính sách, quy trình, thủ tục và pháp lý liên quan tới nghiệp vụ tín dụng bán lẻ
(lãi suất, điều kiện vay, hồ sơ tài sản bảo đảm, thủ tục thành lập doanh nghiệp liên quan tới
hồ sơ vay, v.v.).

QUY TẮC:
- Trả lời ngắn gọn, chuyên nghiệp, đúng trọng tâm câu hỏi, bằng tiếng Việt.
- Đây là tư vấn nghiệp vụ tổng quát, KHÔNG phải quyết định phê duyệt tín dụng cho một hồ sơ cụ
  thể — nếu người dùng thực sự muốn thẩm định một hồ sơ vay cụ thể, hãy nói rõ họ cần cung cấp
  thông tin hồ sơ (tên khách hàng, số tiền vay, tài sản thế chấp...) để hệ thống thẩm định xử lý.
- Nếu không chắc chắn về một chi tiết chính sách cụ thể, nói rõ giới hạn thay vì suy đoán.`;

const OUT_OF_DOMAIN_ANSWER =
  "Tôi là Trợ lý ảo hỗ trợ thẩm định tín dụng VAIC. Tôi có thể giúp bạn thẩm định hồ sơ vay hoặc tư vấn các câu hỏi nghiệp vụ, chính sách, pháp lý liên quan tới tín dụng bán lẻ. Bạn vui lòng đặt câu hỏi trong phạm vi này nhé.";

/**
 * Handles the two intents the classifier routes away from the credit pipeline. Never
 * touches RETAIL_CASES or orchestrationGraph — this is a single direct LLM answer (or a
 * canned redirect for out-of-domain input), not a credit decision, so none of the
 * decision-matrix/confidence/audit machinery built for loan outcomes applies here.
 */
export const runAdvisoryAgent = async (runId: string, prompt: string, intent: Intent): Promise<{ trace: AgentTrace; finalAnswer: string }> => {
  const startedAt = new Date().toISOString();

  if (intent === "OUT_OF_DOMAIN") {
    return {
      finalAnswer: OUT_OF_DOMAIN_ANSWER,
      trace: {
        id: `trace-planner-advisory-${Date.now()}`,
        runId,
        agent: "planner",
        task: "Answer out-of-domain request",
        status: "completed",
        summary: "Yêu cầu nằm ngoài phạm vi nghiệp vụ tín dụng — đã hướng dẫn người dùng quay lại đúng phạm vi hỗ trợ.",
        toolCalls: [],
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };
  }

  try {
    const client = getFptMarketplaceClient();
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: ADVISORY_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];
    const response = await client.chat.completions.create({ model: config.fptExtractionModel, messages });
    const finalAnswer = response.choices[0].message.content?.trim() || "Xin lỗi, tôi chưa thể trả lời câu hỏi này. Vui lòng thử diễn đạt lại.";

    return {
      finalAnswer,
      trace: {
        id: `trace-planner-advisory-${Date.now()}`,
        runId,
        agent: "planner",
        task: "Answer advisory/policy question",
        status: "completed",
        summary: "Đã trả lời câu hỏi tư vấn nghiệp vụ trực tiếp, không qua luồng thẩm định hồ sơ vay.",
        toolCalls: [{ toolName: "answerAdvisoryQuestion", input: { prompt }, output: { finalAnswer }, status: "success" }],
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const finalAnswer = "Xin lỗi, hệ thống tư vấn nghiệp vụ tạm thời không phản hồi được. Vui lòng thử lại sau.";
    return {
      finalAnswer,
      trace: {
        id: `trace-planner-advisory-${Date.now()}`,
        runId,
        agent: "planner",
        task: "Answer advisory/policy question",
        status: "failed",
        summary: `Trợ lý tư vấn nghiệp vụ gặp lỗi: ${error instanceof Error ? error.message : "unknown error"}`,
        toolCalls: [],
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };
  }
};
