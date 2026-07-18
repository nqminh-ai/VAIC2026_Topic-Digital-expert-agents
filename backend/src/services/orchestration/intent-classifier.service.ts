import { getFptMarketplaceClient } from "../../config/fpt-marketplace";
import { config } from "../../config/env";
import { ChatCompletionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type Intent = "CREDIT_APPRAISAL" | "ADVISORY_QA" | "OUT_OF_DOMAIN";

export interface IntentClassification {
  intent: Intent;
  reason: string;
}

const CLASSIFY_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "classify_intent",
    description: "Phân loại ý định của yêu cầu người dùng gửi tới hệ thống thẩm định tín dụng bán lẻ SHB.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: ["CREDIT_APPRAISAL", "ADVISORY_QA", "OUT_OF_DOMAIN"],
          description:
            "CREDIT_APPRAISAL: yêu cầu thẩm định một hồ sơ vay cụ thể (có tên khách hàng, số tiền vay, tài sản thế chấp...) khớp với một trong các hồ sơ demo. " +
            "ADVISORY_QA: câu hỏi nghiệp vụ/chính sách/pháp lý/thủ tục ngân hàng nói chung, KHÔNG gắn với một hồ sơ vay cụ thể nào (vd. lãi suất vay hiện tại, điều kiện vay mua nhà, hồ sơ cần chuẩn bị, quy trình thành lập doanh nghiệp). " +
            "OUT_OF_DOMAIN: hoàn toàn không liên quan tới nghiệp vụ ngân hàng/tín dụng (thời tiết, tán gẫu, chủ đề khác).",
        },
        reason: { type: "string", description: "Giải thích ngắn gọn bằng tiếng Việt vì sao chọn nhãn này." },
      },
      required: ["intent", "reason"],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT = `Bạn là bộ phân loại ý định cho hệ thống thẩm định tín dụng bán lẻ SHB.
Nhiệm vụ DUY NHẤT: đọc yêu cầu của người dùng và gọi tool classify_intent với đúng MỘT nhãn.

Phân biệt quan trọng: một yêu cầu chỉ được coi là CREDIT_APPRAISAL nếu nó mô tả một hồ sơ vay
CỤ THỂ cần thẩm định (có thông tin khách hàng, số tiền, tài sản...). Câu hỏi chung chung về
chính sách/lãi suất/thủ tục — dù có dùng từ "vay", "tín dụng", "hồ sơ" — vẫn là ADVISORY_QA nếu
không gắn với một hồ sơ cụ thể cần ra quyết định phê duyệt.

Luôn gọi tool classify_intent, không trả lời bằng văn bản thuần.`;

/**
 * Runs before routeOrExtractInput so free-text policy questions and off-topic chat never
 * reach the credit-case router — that router's job is matching/extracting a RetailCase,
 * and forcing every prompt through it produced confusing UNSUPPORTED_CASE/NEEDS_MORE_INFO
 * errors for questions that were never about a specific loan file to begin with.
 */
const FALLBACK: IntentClassification = {
  intent: "CREDIT_APPRAISAL",
  reason: "Không phân loại được ý định; mặc định đi qua luồng thẩm định có kiểm soát.",
};

export const classifyIntent = async (prompt: string): Promise<IntentClassification> => {
  try {
    const client = getFptMarketplaceClient();
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];

    const response = await client.chat.completions.create({
      model: config.fptPlannerModel,
      messages,
      tools: [CLASSIFY_TOOL],
      tool_choice: "required",
    });

    const toolCall = response.choices[0].message.tool_calls?.[0];
    if (!toolCall || toolCall.type !== "function" || toolCall.function.name !== "classify_intent") {
      // Fail closed toward the existing credit pipeline: an unparseable classification
      // must not silently become a free-text answer bypassing every governance gate.
      return FALLBACK;
    }

    const args = JSON.parse(toolCall.function.arguments) as { intent?: string; reason?: string };
    const intent: Intent = args.intent === "ADVISORY_QA" || args.intent === "OUT_OF_DOMAIN" ? args.intent : "CREDIT_APPRAISAL";
    return { intent, reason: typeof args.reason === "string" ? args.reason : "" };
  } catch (error) {
    // Classifier being unavailable (missing key, network, model error) must not block or
    // change behavior — every prompt just falls back to the existing controlled pipeline.
    return FALLBACK;
  }
};
