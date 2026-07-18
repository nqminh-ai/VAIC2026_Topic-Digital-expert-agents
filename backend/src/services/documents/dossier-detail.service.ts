import { pgQuery } from "../../config/pg";
import { getAllDossierDocuments, getDossier } from "./dossier.service";
import { getLatestOcrResult } from "./ocr-extraction.service";
import { evaluateDossierCompleteness } from "./checklist-completeness.service";
import { listReviewDecisions } from "./review-decision.service";
import { DossierDocument, OcrExtractionResult } from "../../types/document-intake.types";

export interface DossierDocumentWithOcr extends DossierDocument {
  ocrResult: OcrExtractionResult | null;
}

/** Task 6 detail view: every document (full upload history, not just latest-per-type) with its OCR fields, the checklist gap, preliminary score, and who it's assigned to — everything a reviewer needs on one screen. */
export const getDossierDetail = async (tenantId: string, dossierId: string) => {
  const dossier = await getDossier(tenantId, dossierId);
  if (!dossier) return null;

  const documents = await getAllDossierDocuments(tenantId, dossierId);
  const documentsWithOcr: DossierDocumentWithOcr[] = await Promise.all(
    documents.map(async document => ({ ...document, ocrResult: await getLatestOcrResult(tenantId, document.documentId) }))
  );

  const completeness = await evaluateDossierCompleteness(tenantId, dossierId);

  const scoring = await pgQuery(`SELECT status,score_result,scored_at FROM scoring_queue WHERE tenant_id=$1 AND dossier_id=$2`, [tenantId, dossierId]);
  const assignment = await pgQuery(`SELECT assigned_officer,assigned_at FROM dossier_review_assignments WHERE tenant_id=$1 AND dossier_id=$2`, [tenantId, dossierId]);
  const decisions = await listReviewDecisions(tenantId, dossierId);

  return {
    dossier,
    documents: documentsWithOcr,
    completeness,
    scoring: scoring.rows[0] ?? null,
    assignedOfficer: assignment.rows[0]?.assigned_officer ?? null,
    assignedAt: assignment.rows[0]?.assigned_at ?? null,
    reviewDecisions: decisions,
  };
};
