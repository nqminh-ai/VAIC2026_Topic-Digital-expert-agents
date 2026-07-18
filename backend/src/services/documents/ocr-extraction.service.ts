import { randomUUID } from "crypto";
import { pgQuery } from "../../config/pg";
import { recordAuditEvent } from "../governance/audit-log.service";
import { documentChecklistCatalog } from "../../config/document-checklist";
import { ChecklistDocumentType, DocumentStatus, OcrExtractionResult, OcrFieldConfidence } from "../../types/document-intake.types";

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const getLatestOcrResult = async (tenantId: string, documentId: string): Promise<OcrExtractionResult | null> => {
  const result = await pgQuery(
    `SELECT * FROM document_ocr_results WHERE tenant_id=$1 AND document_id=$2 ORDER BY created_at DESC LIMIT 1`,
    [tenantId, documentId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    tenantId: row.tenant_id,
    extractedFields: row.extracted_fields,
    fieldConfidence: row.field_confidence,
    overallConfidence: Number(row.overall_confidence),
    missingRequiredFields: row.missing_required_fields,
    engine: row.engine,
    createdAt: row.created_at,
  };
};

/**
 * Task 3: label-based extraction against our own fixed-layout bank forms (mẫu 01/02/03-TC-KHCN,
 * see mau_don/). This is a heuristic on known templates, not a general document-understanding
 * model — Document AI's native per-field confidence requires a custom-trained processor, which is
 * a GCP console/training step outside this codebase (see plan's manual-prerequisites note).
 */
export const extractFields = (
  ocrText: string,
  checklistItem: ChecklistDocumentType,
  ocrQuality: number
): { extractedFields: Record<string, string>; fieldConfidence: OcrFieldConfidence; missingRequiredFields: string[]; overallConfidence: number } => {
  const labelBoundary = checklistItem.requiredFields.map(field => escapeRegex(field.label)).join("|");
  const extractedFields: Record<string, string> = {};
  const fieldConfidence: OcrFieldConfidence = {};
  const missingRequiredFields: string[] = [];
  const quality = ocrQuality > 0 ? Math.max(0, Math.min(1, ocrQuality)) : 1;

  for (const field of checklistItem.requiredFields) {
    const labelPattern = escapeRegex(field.label);
    const regex = new RegExp(`${labelPattern}\\s*[:\\-]?\\s*([^\\n]*?)(?=(?:${labelBoundary})|\\n|\\s{3,}|$)`, "i");
    const match = ocrText.match(regex);
    const rawValue = match?.[1]?.trim() ?? "";
    const cleanedValue = rawValue.replace(/^[.\-_\s]+|[.\-_\s]+$/g, "").trim();
    if (cleanedValue) {
      extractedFields[field.key] = cleanedValue;
      fieldConfidence[field.key] = quality;
    } else {
      missingRequiredFields.push(field.key);
      fieldConfidence[field.key] = 0;
    }
  }

  const confidenceValues = Object.values(fieldConfidence);
  const overallConfidence = confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : quality;
  return { extractedFields, fieldConfidence, missingRequiredFields, overallConfidence };
};

/**
 * Persists the extraction outcome and moves the document to its terminal per-attempt status.
 * Never auto-advances past OCR_NEEDS_REVIEW — that decision (task 3: "không tự động chuyển bước
 * tiếp theo") is left entirely to checklist-completeness / the reviewer.
 */
export const persistOcrExtraction = async (
  tenantId: string,
  documentId: string,
  dossierId: string,
  checklistItem: ChecklistDocumentType,
  ocrText: string,
  ocrQuality: number,
  actor: string
): Promise<{ result: OcrExtractionResult; status: DocumentStatus }> => {
  const computed = extractFields(ocrText, checklistItem, ocrQuality);
  const passed = computed.missingRequiredFields.length === 0 && computed.overallConfidence >= documentChecklistCatalog.minOverallConfidenceDefault;

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const result = await pgQuery(
    `INSERT INTO document_ocr_results (id,document_id,tenant_id,extracted_fields,field_confidence,overall_confidence,missing_required_fields,engine,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'google_document_ai',$8) RETURNING id,created_at`,
    [id, documentId, tenantId, JSON.stringify(computed.extractedFields), JSON.stringify(computed.fieldConfidence), computed.overallConfidence, JSON.stringify(computed.missingRequiredFields), createdAt]
  );
  const row = result.rows[0] as { id: string; created_at: string } | undefined;
  if (!row) throw new Error("OCR_RESULT_PERSIST_FAILED");

  const nextStatus = passed ? "OCR_COMPLETE" : "OCR_NEEDS_REVIEW";
  const updated = await pgQuery(
    `UPDATE dossier_documents SET status=$3 WHERE tenant_id=$1 AND document_id=$2 AND status='FORM_ACCEPTED' RETURNING document_id`,
    [tenantId, documentId, nextStatus]
  );
  if (!updated.rows[0]) throw new Error("DOCUMENT_NOT_IN_FORM_ACCEPTED_STATE");

  await recordAuditEvent(
    dossierId,
    actor,
    "tool_call",
    { documentId, checklistItem: checklistItem.documentType, missingRequiredFields: computed.missingRequiredFields, overallConfidence: computed.overallConfidence },
    passed ? "allowed" : "blocked",
    passed
      ? `OCR extraction: ${checklistItem.displayName} đủ trường bắt buộc, confidence ${computed.overallConfidence.toFixed(2)}.`
      : `OCR extraction CẦN BỔ SUNG: ${checklistItem.displayName} thiếu [${computed.missingRequiredFields.join(", ") || "không trường nào"}], confidence ${computed.overallConfidence.toFixed(2)}.`
  );

  return {
    status: nextStatus,
    result: {
      id: row.id,
      documentId,
      tenantId,
      extractedFields: computed.extractedFields,
      fieldConfidence: computed.fieldConfidence,
      overallConfidence: computed.overallConfidence,
      missingRequiredFields: computed.missingRequiredFields,
      engine: "google_document_ai",
      createdAt: row.created_at,
    },
  };
};
