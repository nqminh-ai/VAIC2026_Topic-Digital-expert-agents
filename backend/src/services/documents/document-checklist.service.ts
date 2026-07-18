import { pgQuery } from "../../config/pg";
import { ChecklistDocumentType, DocumentChecklistVersion, LoanType } from "../../types/document-intake.types";

const toVersion = (row: any): DocumentChecklistVersion => ({
  tenantId: row.tenant_id,
  loanType: row.loan_type,
  version: row.version,
  status: row.status,
  items: row.items,
  createdBy: row.created_by,
  createdAt: row.created_at,
  publishedBy: row.published_by ?? undefined,
  publishedAt: row.published_at ?? undefined,
});

/** Authors a new draft checklist version. Never mutates an existing (possibly published) version. */
export const createChecklistVersion = async (
  tenantId: string,
  loanType: LoanType,
  version: string,
  items: ChecklistDocumentType[],
  actor: string
): Promise<DocumentChecklistVersion> => {
  if (!items.length) throw new Error("CHECKLIST_ITEMS_REQUIRED");
  if (new Set(items.map(item => item.documentType)).size !== items.length) throw new Error("CHECKLIST_DUPLICATE_DOCUMENT_TYPE");
  const createdAt = new Date().toISOString();
  await pgQuery(
    `INSERT INTO document_checklist_versions (tenant_id,loan_type,version,status,items,created_by,created_at) VALUES ($1,$2,$3,'draft',$4,$5,$6)`,
    [tenantId, loanType, version, JSON.stringify(items), actor, createdAt]
  );
  return { tenantId, loanType, version, status: "draft", items, createdBy: actor, createdAt };
};

/** Publishing is the only way a draft checklist becomes effective; the DB trigger then makes this row immutable. */
export const publishChecklistVersion = async (
  tenantId: string,
  loanType: LoanType,
  version: string,
  actor: string
): Promise<DocumentChecklistVersion> => {
  const found = await pgQuery(`SELECT * FROM document_checklist_versions WHERE tenant_id=$1 AND loan_type=$2 AND version=$3`, [tenantId, loanType, version]);
  if (!found.rows[0]) throw new Error("CHECKLIST_VERSION_NOT_FOUND");
  if (found.rows[0].status !== "draft") throw new Error("CHECKLIST_VERSION_IMMUTABLE");
  const publishedAt = new Date().toISOString();
  const updated = await pgQuery(
    `UPDATE document_checklist_versions SET status='published',published_by=$4,published_at=$5 WHERE tenant_id=$1 AND loan_type=$2 AND version=$3 AND status='draft' RETURNING version`,
    [tenantId, loanType, version, actor, publishedAt]
  );
  if (!updated.rows[0]) throw new Error("CHECKLIST_PUBLISH_CONFLICT");
  return toVersion({ ...found.rows[0], status: "published", published_by: actor, published_at: publishedAt });
};

export const listChecklistVersions = async (tenantId: string, loanType: LoanType): Promise<DocumentChecklistVersion[]> => {
  const result = await pgQuery(`SELECT * FROM document_checklist_versions WHERE tenant_id=$1 AND loan_type=$2 ORDER BY created_at DESC`, [tenantId, loanType]);
  return result.rows.map(toVersion);
};

export const getPublishedChecklist = async (tenantId: string, loanType: LoanType): Promise<DocumentChecklistVersion | null> => {
  const result = await pgQuery(
    `SELECT * FROM document_checklist_versions WHERE tenant_id=$1 AND loan_type=$2 AND status='published' ORDER BY published_at DESC LIMIT 1`,
    [tenantId, loanType]
  );
  return result.rows[0] ? toVersion(result.rows[0]) : null;
};

/** Fetches a specific pinned version (not just "whatever is published now") — dossiers must keep evaluating against the version they were created under, even after a newer version is published. */
export const getChecklistVersion = async (tenantId: string, loanType: LoanType, version: string): Promise<DocumentChecklistVersion | null> => {
  const result = await pgQuery(`SELECT * FROM document_checklist_versions WHERE tenant_id=$1 AND loan_type=$2 AND version=$3`, [tenantId, loanType, version]);
  return result.rows[0] ? toVersion(result.rows[0]) : null;
};

export const getPublishedChecklistItem = async (
  tenantId: string,
  loanType: LoanType,
  documentType: string
): Promise<{ checklist: DocumentChecklistVersion; item: ChecklistDocumentType } | null> => {
  const checklist = await getPublishedChecklist(tenantId, loanType);
  if (!checklist) return null;
  const item = checklist.items.find(candidate => candidate.documentType === documentType);
  return item ? { checklist, item } : null;
};
