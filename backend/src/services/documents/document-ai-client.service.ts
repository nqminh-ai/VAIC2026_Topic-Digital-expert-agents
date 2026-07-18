import { getDocumentAiClient, getDocumentAiProcessorPath } from "../../config/google-document-ai";

export interface DocumentOcrResult {
  text: string;
  averageConfidence: number;
}

/**
 * Single low-level OCR call shared by form-validation (Phase 2) and field extraction (Phase 3) so a
 * document is only sent to Document AI once. The two callers still log to separate tables and never
 * share pass/fail logic — this only avoids paying for/waiting on the same OCR call twice.
 */
export const runDocumentOcr = async (buffer: Buffer, mimeType: string): Promise<DocumentOcrResult> => {
  const client = getDocumentAiClient();
  const name = getDocumentAiProcessorPath();
  const [result] = await client.processDocument({
    name,
    rawDocument: { content: buffer, mimeType },
  });

  const document = result.document;
  const text = document?.text ?? "";
  const pages = document?.pages ?? [];
  const confidences = pages.map(page => page.layout?.confidence).filter((value): value is number => typeof value === "number");
  const averageConfidence = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0;

  return { text, averageConfidence };
};
