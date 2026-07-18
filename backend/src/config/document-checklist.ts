import documentChecklistCatalogJson from "../policy/document-checklist-catalog.json";
import { DocumentChecklistCatalog } from "../types/document-intake.types";

const assertCatalog = (value: unknown): void => {
  if (!value || typeof value !== "object") throw new Error("document-checklist-catalog is missing or invalid; document intake module is disabled.");
  const doc = value as Record<string, unknown>;
  if (typeof doc.version !== "string" || !doc.version.trim()) throw new Error("document-checklist-catalog.version is required; document intake module is disabled.");
  if (!Array.isArray(doc.documentTypes) || doc.documentTypes.length === 0) throw new Error("document-checklist-catalog.documentTypes must be a non-empty array.");
};

assertCatalog(documentChecklistCatalogJson);

const parsed = documentChecklistCatalogJson as DocumentChecklistCatalog;
if (new Set(parsed.documentTypes.map(item => item.documentType)).size !== parsed.documentTypes.length) {
  throw new Error("document-checklist-catalog.documentTypes must have unique documentType values; document intake module is disabled.");
}

/** Default (seed) checklist catalog — the source of truth is the versioned `document_checklist_versions` DB table once seeded; this is only the bootstrap payload. */
export const documentChecklistCatalog = Object.freeze(parsed);

export const checklistItemsForLoanType = (loanType: DocumentChecklistCatalog["loanTypes"][number]) =>
  documentChecklistCatalog.documentTypes.filter(item => item.appliesToLoanTypes.includes(loanType));
