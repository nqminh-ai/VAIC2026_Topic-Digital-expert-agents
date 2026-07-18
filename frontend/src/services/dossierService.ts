import { apiFetch } from "./httpClient";
import type { DossierDetail, DossierReviewDecisionRecord, DossierStatus, LoanDossier, LoanType, ReviewDecision } from "../types/document-intake";

export interface ListDossiersFilter {
  status?: DossierStatus;
  loanType?: LoanType;
  assignedToMe?: boolean;
}

const toQueryString = (filter: ListDossiersFilter): string => {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.loanType) params.set("loanType", filter.loanType);
  if (filter.assignedToMe) params.set("assignedTo", "me");
  const query = params.toString();
  return query ? `?${query}` : "";
};

export const listDossiers = (token: string, filter: ListDossiersFilter): Promise<{ dossiers: LoanDossier[] }> =>
  apiFetch(`/api/dossiers${toQueryString(filter)}`, { token });

export const getDossierDetail = (token: string, dossierId: string): Promise<DossierDetail> =>
  apiFetch(`/api/dossiers/${dossierId}`, { token });

export const submitReviewDecision = (
  token: string,
  dossierId: string,
  decision: ReviewDecision,
  comment: string | undefined
): Promise<DossierReviewDecisionRecord> =>
  apiFetch(`/api/dossiers/${dossierId}/review-decision`, { method: "POST", token, body: { decision, comment } });
