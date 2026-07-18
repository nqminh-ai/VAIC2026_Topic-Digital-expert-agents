import { pgQuery } from "../../config/pg";
import { recordAuditEvent } from "../governance/audit-log.service";
import { ChecklistDocumentType, FormValidationResult } from "../../types/document-intake.types";

const normalize = (text: string): string => text.toLocaleUpperCase("vi").replace(/\s+/g, " ");

/**
 * Task 2: template/mã-biểu-mẫu matching against OCR'd text — a distinct, earlier gate than field
 * extraction (task 3). A document that fails this never reaches OCR field extraction; the two
 * failure modes are logged to separate tables (document_form_validation_log vs document_ocr_results)
 * so they are never conflated downstream.
 */
export const checkFormMarkers = (ocrText: string, checklistItem: ChecklistDocumentType): FormValidationResult => {
  const normalizedText = normalize(ocrText);
  const matchedMarkers: string[] = [];
  const missingMarkers: string[] = [];
  for (const marker of checklistItem.formMarkers) {
    if (normalizedText.includes(normalize(marker))) matchedMarkers.push(marker);
    else missingMarkers.push(marker);
  }
  const passed = missingMarkers.length === 0;
  return {
    passed,
    reason: passed ? null : `Tài liệu không đúng mẫu "${checklistItem.displayName}" (${checklistItem.formCode ?? "không có mã biểu mẫu"}) — thiếu dấu hiệu mẫu biểu bắt buộc: ${missingMarkers.join(", ")}.`,
    matchedMarkers,
    missingMarkers,
  };
};

export const persistFormValidationResult = async (
  tenantId: string,
  documentId: string,
  dossierId: string,
  checklistItem: ChecklistDocumentType,
  result: FormValidationResult,
  actor: string
): Promise<void> => {
  await pgQuery(
    `INSERT INTO document_form_validation_log (document_id,tenant_id,passed,reason,checked_at) VALUES ($1,$2,$3,$4,NOW())`,
    [documentId, tenantId, result.passed, result.reason]
  );

  const nextStatus = result.passed ? "FORM_ACCEPTED" : "FORM_REJECTED";
  const updated = await pgQuery(
    `UPDATE dossier_documents SET status=$3 WHERE tenant_id=$1 AND document_id=$2 AND status='UPLOADED' RETURNING document_id`,
    [tenantId, documentId, nextStatus]
  );
  if (!updated.rows[0]) throw new Error("DOCUMENT_NOT_IN_UPLOADED_STATE");

  await recordAuditEvent(
    dossierId,
    actor,
    "tool_call",
    { documentId, checklistItem: checklistItem.documentType, passed: result.passed, missingMarkers: result.missingMarkers },
    result.passed ? "allowed" : "blocked",
    result.passed
      ? `Form validation: ${checklistItem.displayName} đúng mẫu.`
      : `Form validation THẤT BẠI: ${result.reason}`
  );
};
