import { randomUUID } from "crypto";
import { pgPool, pgQuery } from "../../config/pg";
import { getPublishedChecklist } from "./document-checklist.service";
import { DossierCicReport, DossierDocument, DossierStatus, LoanDossier, LoanType } from "../../types/document-intake.types";

const toDossier = (row: any): LoanDossier => ({
  dossierId: row.dossier_id,
  tenantId: row.tenant_id,
  customerId: row.customer_id,
  customerEmail: row.customer_email,
  caseId: row.case_id,
  runId: row.run_id ?? null,
  loanType: row.loan_type,
  checklistVersion: row.checklist_version,
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toDocument = (row: any): DossierDocument => ({
  documentId: row.document_id,
  dossierId: row.dossier_id,
  tenantId: row.tenant_id,
  documentType: row.document_type,
  storagePath: row.storage_path,
  originalFilename: row.original_filename,
  uploadedBy: row.uploaded_by,
  uploadedAt: row.uploaded_at,
  status: row.status,
});

/** Creates a dossier against whatever checklist version is currently published for the loan type — fails closed if none is published yet. */
export const createDossier = async (tenantId: string, customerId: string, customerEmail: string, loanType: LoanType, actor: string): Promise<LoanDossier> => {
  const checklist = await getPublishedChecklist(tenantId, loanType);
  if (!checklist) throw new Error("CHECKLIST_NOT_PUBLISHED");
  const dossierId = `dossier-${randomUUID()}`;
  const now = new Date().toISOString();
  await pgQuery(
    `INSERT INTO loan_dossiers (dossier_id,tenant_id,customer_id,customer_email,case_id,loan_type,checklist_version,status,created_by,created_at,updated_at)
     VALUES ($1,$2,$3,$4,NULL,$5,$6,'COLLECTING',$7,$8,$8)`,
    [dossierId, tenantId, customerId, customerEmail, loanType, checklist.version, actor, now]
  );
  return { dossierId, tenantId, customerId, customerEmail, caseId: null, loanType, checklistVersion: checklist.version, status: "COLLECTING", createdBy: actor, createdAt: now, updatedAt: now };
};

/**
 * Atomically promotes a completed orchestration run into the human-review dossier queue.
 * The large appraisal payload remains normalized in orchestration_runs and retail_cases;
 * run_id/case_id are durable foreign identities, so no divergent JSON copy is created.
 */
export const saveRunAsDossier = async (tenantId: string, runId: string, actor: string): Promise<LoanDossier> => {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const source = await client.query(
      `SELECT o.case_id,r.customer_id,r.payload
       FROM orchestration_runs o
       JOIN retail_cases r ON r.case_id=o.case_id AND r.tenant_id=o.tenant_id
       WHERE o.run_id=$1 AND o.tenant_id=$2 AND o.response_payload IS NOT NULL
       FOR UPDATE OF o`,
      [runId, tenantId]
    );
    if (!source.rows[0]) throw new Error("RUN_OR_CASE_NOT_FOUND");

    const row = source.rows[0] as { case_id: string; customer_id: string; payload: { demographic?: { email?: string }; requestedLoan?: { type?: string } } };
    const customerEmail = row.payload.demographic?.email;
    if (!customerEmail) throw new Error("CASE_CUSTOMER_EMAIL_REQUIRED");
    // Current appraisal products (mortgage and refinance) are both secured mortgage dossiers.
    const loanType: LoanType = "mortgage";
    const checklist = await client.query(
      `SELECT version FROM document_checklist_versions
       WHERE tenant_id=$1 AND loan_type=$2 AND status='published'
       ORDER BY published_at DESC LIMIT 1`,
      [tenantId, loanType]
    );
    if (!checklist.rows[0]) throw new Error("CHECKLIST_NOT_PUBLISHED");

    const dossierId = `dossier-${randomUUID()}`;
    const now = new Date().toISOString();
    const inserted = await client.query(
      `INSERT INTO loan_dossiers (dossier_id,tenant_id,customer_id,customer_email,case_id,run_id,loan_type,checklist_version,status,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING_REVIEW',$9,$10,$10)
       ON CONFLICT (run_id) WHERE run_id IS NOT NULL DO UPDATE SET run_id=EXCLUDED.run_id
       RETURNING *`,
      [dossierId, tenantId, row.customer_id, customerEmail, row.case_id, runId, loanType, checklist.rows[0].version, actor, now]
    );
    await client.query(
      `UPDATE orchestration_runs SET saved_at=COALESCE(saved_at,NOW()),saved_by=COALESCE(saved_by,$3)
       WHERE run_id=$1 AND tenant_id=$2`,
      [runId, tenantId, actor]
    );
    await client.query("COMMIT");
    return toDossier(inserted.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const getDossier = async (tenantId: string, dossierId: string): Promise<LoanDossier | null> => {
  const result = await pgQuery(`SELECT * FROM loan_dossiers WHERE tenant_id=$1 AND dossier_id=$2`, [tenantId, dossierId]);
  return result.rows[0] ? toDossier(result.rows[0]) : null;
};

/** Every uploaded file is kept (append-only) so re-uploads never destroy evidence — this returns only the most recent row per document_type, which is what checklist/completeness logic must evaluate. */
export const getLatestDocumentsByType = async (tenantId: string, dossierId: string): Promise<DossierDocument[]> => {
  const result = await pgQuery(
    `SELECT DISTINCT ON (document_type) *
     FROM dossier_documents
     WHERE tenant_id=$1 AND dossier_id=$2
     ORDER BY document_type, uploaded_at DESC`,
    [tenantId, dossierId]
  );
  return result.rows.map(toDocument);
};

export const getAllDossierDocuments = async (tenantId: string, dossierId: string): Promise<DossierDocument[]> => {
  const result = await pgQuery(`SELECT * FROM dossier_documents WHERE tenant_id=$1 AND dossier_id=$2 ORDER BY uploaded_at DESC`, [tenantId, dossierId]);
  return result.rows.map(toDocument);
};

const toCicReport = (row: any): DossierCicReport => ({
  id: row.id,
  dossierId: row.dossier_id,
  tenantId: row.tenant_id,
  storagePath: row.storage_path,
  originalFilename: row.original_filename,
  creditScore: row.credit_score,
  totalOutstandingDebt: row.total_outstanding_debt,
  debtGroup: row.debt_group,
  reportDate: row.report_date,
  notes: row.notes,
  uploadedByRole: "STAFF",
  uploadedBy: row.uploaded_by,
  uploadedAt: row.uploaded_at,
});

/**
 * Read-side only — kept here (not in cic-report.service.ts, which owns the write) so that
 * checklist-completeness.service.ts can check CIC presence without importing cic-report.service.ts
 * back, which would create document-upload -> checklist-completeness -> cic-report -> checklist-
 * completeness circular import. cic-report.service.ts re-exports both for callers that only know
 * about the CIC module.
 */
export const getLatestCicReport = async (tenantId: string, dossierId: string): Promise<DossierCicReport | null> => {
  const result = await pgQuery(`SELECT * FROM dossier_cic_reports WHERE tenant_id=$1 AND dossier_id=$2 ORDER BY uploaded_at DESC LIMIT 1`, [tenantId, dossierId]);
  return result.rows[0] ? toCicReport(result.rows[0]) : null;
};

export const hasCicReport = async (tenantId: string, dossierId: string): Promise<boolean> => (await getLatestCicReport(tenantId, dossierId)) !== null;

/** State-machine-safe transition: only applies if the dossier is currently in one of `fromStatuses` — guards against racing writers instead of blindly overwriting status. */
export const transitionDossierStatus = async (
  tenantId: string,
  dossierId: string,
  fromStatuses: DossierStatus[],
  toStatus: DossierStatus
): Promise<boolean> => {
  const updated = await pgQuery(
    `UPDATE loan_dossiers SET status=$3,updated_at=NOW() WHERE tenant_id=$1 AND dossier_id=$2 AND status=ANY($4::varchar[]) RETURNING dossier_id`,
    [tenantId, dossierId, toStatus, fromStatuses]
  );
  return !!updated.rows[0];
};

export interface ListDossiersFilter {
  status?: DossierStatus;
  loanType?: LoanType;
  assignedTo?: string;
}

export const listDossiers = async (tenantId: string, filter: ListDossiersFilter): Promise<LoanDossier[]> => {
  const conditions = ["d.tenant_id=$1"];
  const params: unknown[] = [tenantId];
  if (filter.status) { params.push(filter.status); conditions.push(`d.status=$${params.length}`); }
  if (filter.loanType) { params.push(filter.loanType); conditions.push(`d.loan_type=$${params.length}`); }
  let join = "";
  if (filter.assignedTo) {
    join = "JOIN dossier_review_assignments a ON a.dossier_id=d.dossier_id AND a.tenant_id=d.tenant_id";
    params.push(filter.assignedTo);
    conditions.push(`a.assigned_officer=$${params.length}`);
  }
  const result = await pgQuery(
    `SELECT d.* FROM loan_dossiers d ${join} WHERE ${conditions.join(" AND ")} ORDER BY d.updated_at DESC`,
    params
  );
  return result.rows.map(toDossier);
};
