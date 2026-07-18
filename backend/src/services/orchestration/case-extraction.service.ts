import { getFptMarketplaceClient } from "../../config/fpt-marketplace";
import { config } from "../../config/env";
import { RetailCase } from "../../types/case.types";
import { ChatCompletionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions";

const INCOME_TYPES = new Set(["salary", "freelance", "rental"]);
const DEBT_TYPES = new Set(["auto", "credit_card", "other"]);
const LOAN_TYPES = new Set(["mortgage", "refinance"]);
const PROPERTY_TYPES = new Set(["apartment", "land", "house"]);
const PROPERTY_STATUSES = new Set(["completed", "future_project"]);
const MARITAL_STATUSES = new Set(["single", "married"]);
const INSURANCE_PREFERENCES = new Set(["accepted", "declined"]);

const RETAIL_CASE_SCHEMA = {
  type: "object",
  properties: {
    demographic: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        maritalStatus: { type: "string", enum: ["single", "married"] },
        cccd: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
      },
      required: ["name", "age", "maritalStatus", "cccd", "phone", "email"],
      additionalProperties: false,
    },
    incomeSources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["salary", "freelance", "rental"] },
          amount: { type: "number", description: "VND/tháng" },
          evidence: { type: "string" },
        },
        required: ["type", "amount", "evidence"],
        additionalProperties: false,
      },
    },
    currentDebts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["auto", "credit_card", "other"] },
          monthlyOwed: { type: "number" },
          outstandingAmount: { type: "number" },
          limit: { type: ["number", "null"] },
          evidence: { type: "string" },
        },
        required: ["type", "monthlyOwed", "outstandingAmount", "limit", "evidence"],
        additionalProperties: false,
      },
    },
    requestedLoan: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["mortgage", "refinance"] },
        amount: { type: "number" },
        tenureYears: { type: "number" },
      },
      required: ["type", "amount", "tenureYears"],
      additionalProperties: false,
    },
    property: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["apartment", "land", "house"] },
        value: { type: "number" },
        status: { type: "string", enum: ["completed", "future_project"] },
        projectCode: { type: ["string", "null"] },
        evidence: { type: "string" },
      },
      required: ["type", "value", "status", "projectCode", "evidence"],
      additionalProperties: false,
    },
    consent: {
      type: "object",
      properties: {
        credit_check: { type: "boolean" },
        tax_income_check: { type: "boolean" },
        social_insurance_check: { type: "boolean" },
        marketing: { type: "boolean" },
      },
      required: ["credit_check", "tax_income_check", "social_insurance_check", "marketing"],
      additionalProperties: false,
    },
    insurancePreference: { type: "string", enum: ["accepted", "declined"] },
  },
  required: [
    "demographic",
    "incomeSources",
    "currentDebts",
    "requestedLoan",
    "property",
    "consent",
    "insurancePreference",
  ],
  additionalProperties: false,
};

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "submit_case",
      description:
        "Gửi hồ sơ khách hàng đã được trích xuất đầy đủ theo đúng schema RetailCase. CHỈ gọi tool này khi mọi trường bắt buộc đều có giá trị thực sự lấy được từ nội dung người dùng cung cấp — KHÔNG được tự bịa, đoán hoặc điền giá trị mặc định cho bất kỳ trường nào.",
      parameters: { type: "object", properties: { case: RETAIL_CASE_SCHEMA }, required: ["case"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "request_more_info",
      description:
        "Gọi tool này khi nội dung người dùng cung cấp KHÔNG đủ để điền hết các trường bắt buộc của hồ sơ tín dụng. Liệt kê rõ ràng, bằng tiếng Việt, những thông tin còn thiếu cần hỏi lại chuyên viên/khách hàng.",
      parameters: {
        type: "object",
        properties: {
          missingFields: { type: "array", items: { type: "string" }, description: "Tên các trường dữ liệu còn thiếu, vd. 'thu nhập hàng tháng', 'giá trị tài sản thế chấp'." },
          questions: { type: "array", items: { type: "string" }, description: "Câu hỏi cụ thể, bằng tiếng Việt, để hỏi bổ sung thông tin." },
        },
        required: ["missingFields", "questions"],
        additionalProperties: false,
      },
    },
  },
];

const SYSTEM_PROMPT = `Bạn là trợ lý trích xuất dữ liệu cho hệ thống thẩm định tín dụng bán lẻ.
Nhiệm vụ: đọc yêu cầu thẩm định bằng ngôn ngữ tự nhiên do chuyên viên tín dụng nhập vào, và trích xuất đúng các trường dữ liệu có trong văn bản để điền vào hồ sơ khách hàng (RetailCase).

QUY TẮC BẮT BUỘC:
- Chỉ trích xuất thông tin THỰC SỰ CÓ trong văn bản. Không suy diễn, không ước tính, không dùng giá trị "hợp lý" thay cho dữ liệu thật.
- Nếu thiếu bất kỳ trường bắt buộc nào (thông tin cá nhân, nguồn thu nhập, khoản nợ hiện tại, khoản vay đề xuất, tài sản thế chấp, đồng thuận tra cứu dữ liệu), PHẢI gọi request_more_info thay vì đoán.
- Chỉ gọi submit_case khi đã có đủ toàn bộ trường bắt buộc từ chính văn bản người dùng cung cấp.
- Luôn gọi đúng một trong hai tool: submit_case hoặc request_more_info. Không trả lời bằng văn bản thuần.`;

export interface CaseExtractionSuccess {
  ok: true;
  retailCase: Omit<RetailCase, "caseId" | "customerId">;
}

export interface CaseExtractionNeedsInfo {
  ok: false;
  missingFields: string[];
  questions: string[];
}

export type CaseExtractionResult = CaseExtractionSuccess | CaseExtractionNeedsInfo;

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const validateExtractedCase = (value: unknown): Omit<RetailCase, "caseId" | "customerId"> => {
  if (!value || typeof value !== "object") throw new Error("Extracted case is not an object.");
  const raw = value as Record<string, unknown>;

  const demographic = raw.demographic as Record<string, unknown> | undefined;
  if (
    !demographic ||
    !isNonEmptyString(demographic.name) ||
    typeof demographic.age !== "number" ||
    !MARITAL_STATUSES.has(String(demographic.maritalStatus)) ||
    !isNonEmptyString(demographic.cccd) ||
    !isNonEmptyString(demographic.phone) ||
    !isNonEmptyString(demographic.email)
  ) {
    throw new Error("Extracted case has invalid or incomplete demographic data.");
  }

  if (!Array.isArray(raw.incomeSources) || raw.incomeSources.length === 0) {
    throw new Error("Extracted case has no income sources.");
  }
  const incomeSources = raw.incomeSources.map((entry, index) => {
    const income = entry as Record<string, unknown>;
    if (!INCOME_TYPES.has(String(income.type)) || typeof income.amount !== "number" || !isNonEmptyString(income.evidence)) {
      throw new Error(`Income source ${index} is invalid.`);
    }
    return { type: income.type as "salary" | "freelance" | "rental", amount: income.amount, evidence: income.evidence as string };
  });

  if (!Array.isArray(raw.currentDebts)) throw new Error("Extracted case is missing currentDebts array.");
  const currentDebts = raw.currentDebts.map((entry, index) => {
    const debt = entry as Record<string, unknown>;
    if (
      !DEBT_TYPES.has(String(debt.type)) ||
      typeof debt.monthlyOwed !== "number" ||
      typeof debt.outstandingAmount !== "number" ||
      !isNonEmptyString(debt.evidence)
    ) {
      throw new Error(`Debt entry ${index} is invalid.`);
    }
    return {
      type: debt.type as "auto" | "credit_card" | "other",
      monthlyOwed: debt.monthlyOwed,
      outstandingAmount: debt.outstandingAmount,
      limit: typeof debt.limit === "number" ? debt.limit : undefined,
      evidence: debt.evidence as string,
    };
  });

  const requestedLoan = raw.requestedLoan as Record<string, unknown> | undefined;
  if (
    !requestedLoan ||
    !LOAN_TYPES.has(String(requestedLoan.type)) ||
    typeof requestedLoan.amount !== "number" ||
    typeof requestedLoan.tenureYears !== "number"
  ) {
    throw new Error("Extracted case has invalid requestedLoan.");
  }

  const property = raw.property as Record<string, unknown> | undefined;
  if (
    !property ||
    !PROPERTY_TYPES.has(String(property.type)) ||
    typeof property.value !== "number" ||
    !PROPERTY_STATUSES.has(String(property.status)) ||
    !isNonEmptyString(property.evidence)
  ) {
    throw new Error("Extracted case has invalid property data.");
  }

  const consent = raw.consent as Record<string, unknown> | undefined;
  if (
    !consent ||
    typeof consent.credit_check !== "boolean" ||
    typeof consent.tax_income_check !== "boolean" ||
    typeof consent.social_insurance_check !== "boolean" ||
    typeof consent.marketing !== "boolean"
  ) {
    throw new Error("Extracted case has invalid consent data.");
  }

  if (!INSURANCE_PREFERENCES.has(String(raw.insurancePreference))) {
    throw new Error("Extracted case has invalid insurancePreference.");
  }

  return {
    demographic: {
      name: demographic.name as string,
      age: demographic.age as number,
      maritalStatus: demographic.maritalStatus as "single" | "married",
      cccd: demographic.cccd as string,
      phone: demographic.phone as string,
      email: demographic.email as string,
    },
    incomeSources,
    currentDebts,
    requestedLoan: {
      type: requestedLoan.type as "mortgage" | "refinance",
      amount: requestedLoan.amount as number,
      tenureYears: requestedLoan.tenureYears as number,
    },
    property: {
      type: property.type as "apartment" | "land" | "house",
      value: property.value as number,
      status: property.status as "completed" | "future_project",
      projectCode: isNonEmptyString(property.projectCode) ? (property.projectCode as string) : undefined,
      evidence: property.evidence as string,
    },
    consent: {
      credit_check: consent.credit_check as boolean,
      tax_income_check: consent.tax_income_check as boolean,
      social_insurance_check: consent.social_insurance_check as boolean,
      marketing: consent.marketing as boolean,
    },
    insurancePreference: raw.insurancePreference as "accepted" | "declined",
  };
};

/**
 * Extracts a structured RetailCase from a free-text credit request that didn't match
 * any of the fixed demo fixtures. The model must ground every field in the user's own
 * text (system prompt forbids guessing) and validateExtractedCase re-checks the shape
 * server-side — the model's output is never trusted directly, same as legal-reasoning.
 */
const EXTRACTION_UNAVAILABLE_RESULT: CaseExtractionResult = {
  ok: false,
  missingFields: ["toàn bộ hồ sơ"],
  questions: [
    "Hệ thống trích xuất hồ sơ tạm thời không xử lý được yêu cầu này. Vui lòng cung cấp đầy đủ thông tin khách hàng, thu nhập, khoản vay đề xuất và tài sản thế chấp, hoặc chọn một hồ sơ mẫu có sẵn.",
  ],
};

/**
 * Every failure mode here (missing API key, network error, malformed tool-call JSON, a
 * shape the model produced that fails validateExtractedCase) must degrade to
 * NEEDS_MORE_INFO instead of an uncaught exception — an uncaught throw here surfaces as a
 * generic 500 to the credit officer, which is strictly worse than asking for more detail.
 */
export const extractCaseFromPrompt = async (prompt: string): Promise<CaseExtractionResult> => {
  try {
    const client = getFptMarketplaceClient();
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];

    const response = await client.chat.completions.create({
      model: config.fptExtractionModel,
      messages,
      tools: TOOLS,
      tool_choice: "required",
    });

    const toolCall = response.choices[0].message.tool_calls?.[0];
    if (!toolCall || toolCall.type !== "function") {
      return {
        ok: false,
        missingFields: ["toàn bộ hồ sơ"],
        questions: ["Vui lòng cung cấp đầy đủ thông tin khách hàng, thu nhập, khoản vay đề xuất và tài sản thế chấp."],
      };
    }

    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

    if (toolCall.function.name === "request_more_info") {
      const missingFields = Array.isArray(args.missingFields) ? args.missingFields.filter(isNonEmptyString) : [];
      const questions = Array.isArray(args.questions) ? args.questions.filter(isNonEmptyString) : [];
      return {
        ok: false,
        missingFields: missingFields.length ? missingFields : ["thông tin còn thiếu"],
        questions: questions.length ? questions : ["Vui lòng bổ sung đầy đủ thông tin hồ sơ tín dụng."],
      };
    }

    if (toolCall.function.name === "submit_case") {
      return { ok: true, retailCase: validateExtractedCase(args.case) };
    }

    return EXTRACTION_UNAVAILABLE_RESULT;
  } catch (error) {
    console.error("Case extraction failed, falling back to NEEDS_MORE_INFO:", error);
    return EXTRACTION_UNAVAILABLE_RESULT;
  }
};
