import { runDocumentOcr } from "./document-ai-client.service";
import { checkFormMarkers, persistFormValidationResult } from "./form-validation.service";
import { persistOcrExtraction } from "./ocr-extraction.service";
import { ChecklistDocumentType, DocumentStatus, FormValidationResult, OcrExtractionResult } from "../../types/document-intake.types";

export interface DocumentPipelineResult {
  formResult: FormValidationResult;
  ocrResult: OcrExtractionResult | null;
  documentStatus: DocumentStatus;
}

/**
 * Orchestrates the per-document pipeline triggered right after upload: one Document AI call →
 * task 2 form-mismatch gate → (only if passed) task 3 field extraction. A document that fails form
 * validation never reaches field extraction — the two failure modes stay on separate tables/logs.
 */
export const runDocumentIntakePipeline = async (
  tenantId: string,
  dossierId: string,
  documentId: string,
  buffer: Buffer,
  mimeType: string,
  checklistItem: ChecklistDocumentType,
  actor: string
): Promise<DocumentPipelineResult> => {
  const { text, averageConfidence } = await runDocumentOcr(buffer, mimeType);
  const formResult = checkFormMarkers(text, checklistItem);
  await persistFormValidationResult(tenantId, documentId, dossierId, checklistItem, formResult, actor);

  if (!formResult.passed) {
    return { formResult, ocrResult: null, documentStatus: "FORM_REJECTED" };
  }

  const { result: ocrResult, status: documentStatus } = await persistOcrExtraction(tenantId, documentId, dossierId, checklistItem, text, averageConfidence, actor);
  return { formResult, ocrResult, documentStatus };
};
