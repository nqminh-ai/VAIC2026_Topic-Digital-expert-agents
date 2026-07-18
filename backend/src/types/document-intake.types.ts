export type LoanType = "unsecured" | "mortgage";

export type DossierStatus =
  | "COLLECTING"
  | "INCOMPLETE"
  | "COMPLETE"
  | "QUEUED_FOR_SCORING"
  | "SCORED"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "NEEDS_MORE_INFO";

export type DocumentStatus =
  | "UPLOADED"
  | "FORM_REJECTED"
  | "FORM_ACCEPTED"
  | "OCR_PENDING"
  | "OCR_NEEDS_REVIEW"
  | "OCR_COMPLETE"
  | "OCR_FAILED";

export interface ChecklistRequiredField {
  key: string;
  label: string;
}

export interface ChecklistDocumentType {
  documentType: string;
  displayName: string;
  formCode: string | null;
  templateFileRef: string | null;
  formMarkers: string[];
  requiredFields: ChecklistRequiredField[];
  appliesToLoanTypes: LoanType[];
  requiredForLoanTypes: LoanType[];
  note?: string;
}

export interface DocumentChecklistCatalog {
  catalogId: string;
  version: string;
  loanTypes: LoanType[];
  minOverallConfidenceDefault: number;
  documentTypes: ChecklistDocumentType[];
}

export interface DocumentChecklistVersion {
  tenantId: string;
  loanType: LoanType;
  version: string;
  status: "draft" | "published";
  items: ChecklistDocumentType[];
  createdBy: string;
  createdAt: string;
  publishedBy?: string;
  publishedAt?: string;
}

export interface LoanDossier {
  dossierId: string;
  tenantId: string;
  customerId: string;
  customerEmail: string;
  caseId: string | null;
  loanType: LoanType;
  checklistVersion: string;
  status: DossierStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DossierDocument {
  documentId: string;
  dossierId: string;
  tenantId: string;
  documentType: string;
  storagePath: string;
  originalFilename: string;
  uploadedBy: string;
  uploadedAt: string;
  status: DocumentStatus;
}

export interface FormValidationResult {
  passed: boolean;
  reason: string | null;
  matchedMarkers: string[];
  missingMarkers: string[];
}

export interface OcrFieldConfidence {
  [fieldKey: string]: number;
}

export interface OcrExtractionResult {
  id: string;
  documentId: string;
  tenantId: string;
  extractedFields: Record<string, string>;
  fieldConfidence: OcrFieldConfidence;
  overallConfidence: number;
  missingRequiredFields: string[];
  engine: string;
  createdAt: string;
}

export interface DossierCompletenessResult {
  complete: boolean;
  missingDocumentTypes: Array<{ documentType: string; displayName: string }>;
}

export type ReviewDecision = "approved" | "rejected" | "more_info";

export interface DossierReviewDecisionRecord {
  id: string;
  dossierId: string;
  tenantId: string;
  reviewer: string;
  decision: ReviewDecision;
  comment: string | null;
  decidedAt: string;
}
