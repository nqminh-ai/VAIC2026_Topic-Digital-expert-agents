import { decisionPolicy, routingCatalog } from "../../config/policy";
import { RetailCase } from "../../types/case.types";
import { extractCaseFromPrompt } from "./case-extraction.service";
import { loadRetailCase, saveRetailCase } from "../data/retail-case-loader";

export type InputErrorCode = "INVALID_INPUT" | "UNSUPPORTED_CASE" | "AMBIGUOUS_CASE" | "NEEDS_MORE_INFO";

export type InputRoutingResult =
  | { ok: true; caseId: string; score: number; matchedSignals: string[] }
  | { ok: false; code: InputErrorCode; message: string };

/**
 * Same shape as InputRoutingResult, plus an optional dynamically-extracted case for
 * requests that didn't match a fixed demo fixture but were successfully parsed by the
 * LLM extractor, and a `questions` list when the model needs more information instead.
 */
export type InputRoutingOrExtractionResult =
  | { ok: true; caseId: string; score: number; matchedSignals: string[]; extractedCase?: RetailCase }
  | { ok: false; code: InputErrorCode; message: string; questions?: string[] };

const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/,(\d)/g, ".$1")
    .replace(/[^a-z0-9\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Signal text may be a single token, an exact phrase, or a multi-word phrase
 * whose words can appear anywhere in the prompt (out of order, with other
 * words in between). This lets differently-phrased demo prompts still match
 * their fixture instead of requiring the exact canned wording.
 */
const signalMatches = (text: string, signalText: string): boolean => {
  if (text.includes(signalText)) return true;
  const words = signalText.split(" ").filter(Boolean);
  if (words.length < 2) return false;
  return words.every(word => text.includes(word));
};

export class OrchestrationInputError extends Error {
  constructor(public readonly code: InputErrorCode, message: string, public readonly questions?: string[]) {
    super(message);
    this.name = "OrchestrationInputError";
  }
}

/**
 * Validates the prompt shape and screens for prompt-injection / off-topic input.
 * Does not resolve a caseId by itself — see routeOrExtractInput for that.
 */
const screenInput = (prompt: unknown): { ok: true; text: string } | { ok: false; code: InputErrorCode; message: string } => {
  if (typeof prompt !== "string") {
    return { ok: false, code: "INVALID_INPUT", message: "Yêu cầu thẩm định phải là một chuỗi văn bản." };
  }

  const raw = prompt.trim();
  const text = normalize(raw);
  if (
    raw.length < decisionPolicy.routing.minimumPromptCharacters ||
    raw.length > decisionPolicy.routing.maximumPromptCharacters ||
    text.split(" ").length < decisionPolicy.routing.minimumPromptTokens
  ) {
    return { ok: false, code: "INVALID_INPUT", message: "Yêu cầu quá ngắn, quá dài hoặc không chứa đủ thông tin để thẩm định." };
  }

  if (!routingCatalog.creditIntentSignals.some(signal => signalMatches(text, signal))) {
    return { ok: false, code: "INVALID_INPUT", message: "Nội dung không phải yêu cầu thẩm định tín dụng." };
  }

  return { ok: true, text };
};

const randomCaseId = (): string => `case-dynamic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Resolves a caseId for this request. Three paths, in order:
 * 1. Prompt-injection signal detected → hard-routed to the fixed security-test caseId.
 * 2. An explicit requestedCaseId was passed → must already exist in the DB.
 * 3. Free-text prompt → extracted into a fresh RetailCase by the LLM (case-extraction.service.ts)
 *    and persisted, since there is no fixed demo catalog to match against anymore.
 */
export const routeOrExtractInput = async (
  prompt: unknown,
  requestedCaseId?: string
): Promise<InputRoutingOrExtractionResult> => {
  const screened = screenInput(prompt);
  if (!screened.ok) return screened;
  const { text } = screened;

  const injection = routingCatalog.injectionSignals.find(signal => signalMatches(text, signal));
  if (injection) {
    return { ok: true, caseId: routingCatalog.injectionCaseId, score: decisionPolicy.routing.exactMatchScore, matchedSignals: [injection] };
  }

  if (requestedCaseId) {
    const existing = await loadRetailCase(requestedCaseId);
    return existing
      ? { ok: true, caseId: requestedCaseId, score: decisionPolicy.routing.exactMatchScore, matchedSignals: ["explicit-case-id"], extractedCase: existing }
      : { ok: false, code: "UNSUPPORTED_CASE", message: `caseId không tồn tại: ${requestedCaseId}.` };
  }

  const extraction = await extractCaseFromPrompt((prompt as string).trim());
  if (!extraction.ok) {
    return {
      ok: false,
      code: "NEEDS_MORE_INFO",
      message: "Nội dung chưa đủ thông tin để dựng hồ sơ tín dụng. Vui lòng bổ sung các thông tin còn thiếu.",
      questions: extraction.questions,
    };
  }

  const caseId = randomCaseId();
  const retailCase: RetailCase = { caseId, customerId: `dyn-${caseId}`, ...extraction.retailCase };
  await saveRetailCase(retailCase);

  return { ok: true, caseId, score: decisionPolicy.routing.exactMatchScore, matchedSignals: ["llm-extracted"], extractedCase: retailCase };
};
