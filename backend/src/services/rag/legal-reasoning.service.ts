import { getFptMarketplaceClient } from "../../config/fpt-marketplace";
import { config } from "../../config/env";
import legalLlmContractJson from "../../policy/legal-llm-contract.json";
import { RetailCase, ConsentRegistry } from "../../types/case.types";
import { DecisionEnvelope } from "../../types/agent.types";
import { queryProjectGuarantee, queryRegulationClause } from "./policy-rag.service";
import { ToolCallTrace } from "../../types/trace.types";
import { ChatCompletionTool, ChatCompletionMessageParam, ChatCompletionToolMessageParam } from "openai/resources/chat/completions";

const MAX_TOOL_ITERATIONS = 6;

interface LegalLlmContract {
  contractId: string;
  version: string;
  allowedClauseIds: string[];
  allowedRuleIds: string[];
  systemPrompt: string;
}

const LEGAL_LLM_CONTRACT = legalLlmContractJson as LegalLlmContract;
const ALLOWED_LEGAL_RULE_IDS = new Set(LEGAL_LLM_CONTRACT.allowedRuleIds);

const DECISION_ENVELOPE_ITEM_SCHEMA = {
  type: "object",
  properties: {
    decisionId: { type: "string" },
    status: { type: "string", enum: ["PASS", "CONDITIONAL_PASS", "VIOLATION", "BLOCKED", "FAIL"] },
    severity: { type: "string", enum: ["INFO", "CONDITION", "WARNING", "BLOCKER"] },
    blocksAt: {
      type: "string",
      enum: ["APPROVAL", "CONTRACT_SIGNING", "DISBURSEMENT", "EXTERNAL_DATA_CALL", "NONE"],
    },
    finding: {
      type: "string",
      description: "Diễn giải bằng tiếng Việt, phải dựa trên kết quả tool call thực tế — không tự bịa nội dung.",
    },
    evidence: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    },
    ruleIds: { type: "array", items: { type: "string", enum: LEGAL_LLM_CONTRACT.allowedRuleIds } },
    citations: { type: "array", items: { type: "string" }, maxItems: 0 },
    requiredFix: { type: ["string", "null"] },
  },
  required: [
    "decisionId",
    "status",
    "severity",
    "blocksAt",
    "finding",
    "evidence",
    "ruleIds",
    "citations",
    "requiredFix",
  ],
  additionalProperties: false,
};

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_regulation_clause",
      description: "Tra cứu nội dung một điều khoản quy định trong đồ thị tri thức pháp lý (Neo4j) của SHB. Chỉ dùng các clauseId đã được liệt kê trong system prompt — không tự đặt clauseId mới không có trong danh sách.",
      parameters: {
        type: "object",
        properties: {
          clauseId: {
            type: "string",
            enum: LEGAL_LLM_CONTRACT.allowedClauseIds,
            description: "ID điều khoản trong catalog đã được kiểm soát, gồm nguồn luật chính thức và policy nội bộ được gắn trạng thái xác minh.",
          },
        },
        required: ["clauseId"],
      },
    }
  },
  {
    type: "function",
    function: {
      name: "get_project_guarantee_status",
      description: "Tra cứu trạng thái bảo lãnh của một dự án bất động sản hình thành trong tương lai trong đồ thị tri thức (Neo4j), theo projectCode lấy từ hồ sơ khách hàng.",
      parameters: {
        type: "object",
        properties: {
          projectCode: { type: "string", description: "Mã dự án bất động sản, lấy đúng từ dữ liệu hồ sơ được cung cấp." },
        },
        required: ["projectCode"],
      },
    }
  },
  {
    type: "function",
    function: {
      name: "submit_findings",
      description: "Sử dụng tool này để gửi kết quả kiểm tra pháp lý cuối cùng (findings) sau khi đã tra cứu xong thông tin. BẮT BUỘC PHẢI GỌI tool này để trả về kết quả cuối cùng.",
      parameters: {
        type: "object",
        properties: {
          findings: { type: "array", items: DECISION_ENVELOPE_ITEM_SCHEMA },
        },
        required: ["findings"],
        additionalProperties: false,
      },
    }
  }
];

// Canonical, versioned contract shared with the fine-tuning dataset builder.
const SYSTEM_PROMPT = LEGAL_LLM_CONTRACT.systemPrompt;

interface LegalReasoningInput {
  maritalStatus: RetailCase["demographic"]["maritalStatus"];
  hasInsuranceTyingSignal: boolean;
  propertyStatus: RetailCase["property"]["status"];
  projectCode: string | null;
  consent: ConsentRegistry;
  maritalSignatureWarning: boolean;
}

export interface LegalReasoningResult {
  findings: DecisionEnvelope[];
  toolCalls: ToolCallTrace[];
}

const FINDING_STATUSES = new Set(["PASS", "CONDITIONAL_PASS", "VIOLATION", "BLOCKED", "FAIL"]);
const FINDING_SEVERITIES = new Set(["INFO", "CONDITION", "WARNING", "BLOCKER"]);
const FINDING_GATES = new Set(["APPROVAL", "CONTRACT_SIGNING", "DISBURSEMENT", "EXTERNAL_DATA_CALL", "NONE"]);

const validateSubmittedFindings = (value: unknown): DecisionEnvelope[] => {
  if (!Array.isArray(value)) throw new Error("Legal reasoning returned findings in an invalid format.");

  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Legal finding ${index} is not an object.`);
    const finding = raw as Record<string, unknown>;
    const evidence = finding.evidence;
    if (typeof finding.decisionId !== "string" || !finding.decisionId.trim()) throw new Error(`Legal finding ${index} has no decisionId.`);
    if (!FINDING_STATUSES.has(String(finding.status))) throw new Error(`Legal finding ${index} has an invalid status.`);
    if (!FINDING_SEVERITIES.has(String(finding.severity))) throw new Error(`Legal finding ${index} has an invalid severity.`);
    if (!FINDING_GATES.has(String(finding.blocksAt))) throw new Error(`Legal finding ${index} has an invalid gate.`);
    if (typeof finding.finding !== "string" || !finding.finding.trim()) throw new Error(`Legal finding ${index} has no explanation.`);
    if (!evidence || typeof evidence !== "object" || typeof (evidence as Record<string, unknown>).summary !== "string") {
      throw new Error(`Legal finding ${index} has no structured evidence.`);
    }
    let ruleIds: string[] = [];
    if (Array.isArray(finding.ruleIds)) {
      ruleIds = finding.ruleIds.map(r => String(r));
    } else if (typeof finding.ruleIds === "string") {
      ruleIds = [finding.ruleIds];
    } else if (typeof finding.ruleId === "string") {
      ruleIds = [finding.ruleId];
    } else if (typeof finding.rule === "string") {
      ruleIds = [finding.rule];
    }

    if (!ruleIds.length || ruleIds.some(rule => typeof rule !== "string" || !rule.trim())) {
      throw new Error(`Legal finding ${index} has no valid rule ID.`);
    }
    if (ruleIds.some(rule => !ALLOWED_LEGAL_RULE_IDS.has(rule))) {
      throw new Error(`Legal finding ${index} contains a rule outside the approved contract.`);
    }
    if (!Array.isArray(finding.citations) || finding.citations.some(citation => typeof citation !== "string")) {
      throw new Error(`Legal finding ${index} has an invalid citations field.`);
    }
    // Model-provided citations are untrusted. The governance layer deterministically
    // rebuilds them from citation-catalog.json after this function returns.
    return {
      decisionId: finding.decisionId as string,
      agent: "legal",
      status: finding.status as DecisionEnvelope["status"],
      severity: finding.severity as DecisionEnvelope["severity"],
      blocksAt: finding.blocksAt as DecisionEnvelope["blocksAt"],
      finding: finding.finding as string,
      evidence: evidence as Record<string, unknown>,
      ruleIds: ruleIds,
      citations: [],
      requiredFix: typeof finding.requiredFix === "string" ? finding.requiredFix : undefined,
    };
  });
};

const executeTool = async (
  name: string,
  input: Record<string, unknown>
): Promise<{ output: Record<string, unknown>; status: "success" | "failed" }> => {
  try {
    if (name === "get_regulation_clause") {
      const clause = await queryRegulationClause(input.clauseId as string);
      return { output: clause ? { ...clause, found: true } : { found: false }, status: "success" };
    }
    if (name === "get_project_guarantee_status") {
      const project = await queryProjectGuarantee(input.projectCode as string);
      return { output: project ? { ...project, found: true } : { found: false }, status: "success" };
    }
    return { output: { error: `Unknown tool: ${name}` }, status: "failed" };
  } catch (err) {
    return {
      output: { error: err instanceof Error ? err.message : "unknown error" },
      status: "failed",
    };
  }
};

/**
 * Runs the Legal & Compliance Agent's RAG-backed reasoning through the OpenAI API:
 * the model decides which regulation/project lookups apply to this case (grounded via
 * tool calls against the Neo4j policy graph) and returns findings constrained to the
 * DecisionEnvelope schema via the submit_findings tool call.
 */
export const runLegalComplianceReasoning = async (
  retailCase: RetailCase,
  prompt: string,
  hasInsuranceTyingSignal: boolean
): Promise<LegalReasoningResult> => {
  const client = getFptMarketplaceClient();
  const toolCallLog: ToolCallTrace[] = [];

  // Data minimisation: the model never receives the raw user prompt. Only the narrow,
  // deterministic legal signal needed for this review crosses the model boundary.
  const maritalSignatureWarning = /(thiếu|chưa\s*(có|đủ|có\s+đủ)).{0,40}(chữ\s*ký|ký\s*tên).{0,40}(vợ|chồng)|tài\s*sản\s*chung.{0,50}(thiếu|chưa\s*(có|đủ|có\s+đủ)).{0,30}(chữ\s*ký|ký\s*tên)/iu.test(prompt);
  const reasoningInput: LegalReasoningInput = {
    maritalStatus: retailCase.demographic.maritalStatus,
    hasInsuranceTyingSignal,
    propertyStatus: retailCase.property.status,
    projectCode: retailCase.property.projectCode ?? null,
    consent: retailCase.consent,
    maritalSignatureWarning
  };

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Dữ liệu hồ sơ cần soát xét (JSON):\n${JSON.stringify(reasoningInput, null, 2)}`,
    },
  ];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await client.chat.completions.create({
      model: config.fptLegalModel,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    const message = choice.message;

    // OpenAI requires the assistant message to be appended back if it has tool calls
    messages.push(message);

    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== "function") continue;

        if (toolCall.function.name === "submit_findings") {
          const args = JSON.parse(toolCall.function.arguments) as { findings?: unknown };
          return { findings: validateSubmittedFindings(args.findings), toolCalls: toolCallLog };
        }

        const input = JSON.parse(toolCall.function.arguments);
        const { output, status } = await executeTool(toolCall.function.name, input);
        
        toolCallLog.push({ toolName: toolCall.function.name, input, output, status });
        
        const toolResultMessage: ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(output),
        };
        messages.push(toolResultMessage);
      }
    } else {
      // The model returned text without a tool call. It should have used submit_findings.
      throw new Error("Legal reasoning: model returned text instead of calling submit_findings tool.");
    }
  }

  throw new Error("Legal reasoning: exceeded max tool-use iterations without a final answer.");
};
