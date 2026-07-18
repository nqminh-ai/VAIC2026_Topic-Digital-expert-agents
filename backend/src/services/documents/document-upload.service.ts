import { randomUUID } from "crypto";
import { pgQuery } from "../../config/pg";
import { uploadDossierDocument } from "../../config/document-storage";
import { getDossier } from "./dossier.service";
import { getChecklistVersion } from "./document-checklist.service";
import { recordAuditEvent } from "../governance/audit-log.service";
import { runDocumentIntakePipeline } from "./document-pipeline.service";
import { recomputeDossierAfterDocumentChange } from "./checklist-completeness.service";
import { ChecklistDocumentType, DossierDocument, DossierStatus, FormValidationResult, LoanDossier, OcrExtractionResult } from "../../types/document-intake.types";

export interface UploadFileInput {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
}

// A dossier only accepts new uploads while still collecting evidence. Once it reaches COMPLETE
// or beyond, the only way back to accepting uploads is a reviewer explicitly requesting more info
// (PENDING_REVIEW -> NEEDS_MORE_INFO), which the review-decision endpoint (task 6) sets.
const UPLOAD_ALLOWED_STATUSES = new Set<DossierStatus>(["COLLECTING", "INCOMPLETE", "NEEDS_MORE_INFO"]);
const sanitizeFilename = (name: string): string => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);

/**
 * Task 1: accepts an upload, classifies it against the dossier's published checklist (document_type
 * mapping), and stores it. Files are never overwritten — each upload is a new row so prior evidence
 * and prior OCR results survive a re-upload (task 4's "bổ sung mà không nộp lại toàn bộ").
 */
export const uploadDocument = async (
  tenantId: string,
  dossierId: string,
  documentType: string,
  file: UploadFileInput,
  actor: string
): Promise<{ dossier: LoanDossier; document: DossierDocument; checklistItem: ChecklistDocumentType; formResult: FormValidationResult; ocrResult: OcrExtractionResult | null }> => {
  const dossier = await getDossier(tenantId, dossierId);
  if (!dossier) throw new Error("DOSSIER_NOT_FOUND");
  if (!UPLOAD_ALLOWED_STATUSES.has(dossier.status)) throw new Error("DOSSIER_NOT_ACCEPTING_UPLOADS");

  // Always the checklist version the dossier was created against, not whatever is published now.
  const checklist = await getChecklistVersion(tenantId, dossier.loanType, dossier.checklistVersion);
  const item = checklist?.items.find(candidate => candidate.documentType === documentType);
  if (!checklist || !item) throw new Error("DOCUMENT_TYPE_NOT_IN_CHECKLIST");
  const found = { checklist, item };

  const documentId = `doc-${randomUUID()}`;
  const storagePath = `${tenantId}/${dossierId}/${documentId}-${sanitizeFilename(file.originalFilename)}`;
  await uploadDossierDocument(storagePath, file.buffer, file.mimeType);

  const uploadedAt = new Date().toISOString();
  await pgQuery(
    `INSERT INTO dossier_documents (document_id,dossier_id,tenant_id,document_type,storage_path,original_filename,uploaded_by,uploaded_at,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'UPLOADED')`,
    [documentId, dossierId, tenantId, documentType, storagePath, file.originalFilename, actor, uploadedAt]
  );

  await recordAuditEvent(dossierId, actor, "tool_call", { documentId, documentType, storagePath }, "allowed", `Uploaded ${found.item.displayName} for dossier ${dossierId}.`);

  // Runs synchronously: the caller (HTTP response) reflects the real form-validation/OCR outcome
  // immediately rather than leaving the customer to poll for a background result.
  const { formResult, ocrResult, documentStatus } = await runDocumentIntakePipeline(tenantId, dossierId, documentId, file.buffer, file.mimeType, found.item, actor);

  const document: DossierDocument = {
    documentId, dossierId, tenantId, documentType, storagePath,
    originalFilename: file.originalFilename, uploadedBy: actor, uploadedAt, status: documentStatus,
  };

  // Task 4: every upload attempt (pass or fail) re-evaluates the checklist so INCOMPLETE / the
  // missing-document email always reflect the latest state, and COMPLETE fires the moment it's true.
  await recomputeDossierAfterDocumentChange(tenantId, dossierId, actor);

  return { dossier, document, checklistItem: found.item, formResult, ocrResult };
};
