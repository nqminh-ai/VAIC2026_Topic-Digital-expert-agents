import { randomUUID } from "crypto";
import { pgQuery } from "../../config/pg";
import { getDossier, transitionDossierStatus } from "./dossier.service";
import { recordAuditEvent } from "../governance/audit-log.service";
import { DossierReviewDecisionRecord, DossierStatus, ReviewDecision } from "../../types/document-intake.types";

const NEXT_STATUS: Record<ReviewDecision, DossierStatus> = {
  approved: "APPROVED",
  rejected: "REJECTED",
  more_info: "NEEDS_MORE_INFO",
};

/**
 * Task 6: the only place a dossier can ever reach APPROVED/REJECTED — always a named human actor,
 * never a transition any pipeline stage can trigger on its own (task constraint: no auto-approval).
 */
export const submitReviewDecision = async (
  tenantId: string,
  dossierId: string,
  reviewer: string,
  reviewerRole: "CREDIT_OFFICER" | "CREDIT_APPROVER",
  decision: ReviewDecision,
  comment: string | undefined
): Promise<DossierReviewDecisionRecord> => {
  const dossier = await getDossier(tenantId, dossierId);
  if (!dossier) throw new Error("DOSSIER_NOT_FOUND");
  if (dossier.status !== "PENDING_REVIEW") throw new Error("DOSSIER_NOT_PENDING_REVIEW");

  if (reviewerRole !== "CREDIT_APPROVER") {
    const assignment = await pgQuery(`SELECT assigned_officer FROM dossier_review_assignments WHERE tenant_id=$1 AND dossier_id=$2`, [tenantId, dossierId]);
    const assignedOfficer = assignment.rows[0]?.assigned_officer;
    if (assignedOfficer && assignedOfficer !== reviewer) throw new Error("REVIEW_FORBIDDEN_NOT_ASSIGNED_OFFICER");
  }

  const moved = await transitionDossierStatus(tenantId, dossierId, ["PENDING_REVIEW"], NEXT_STATUS[decision]);
  if (!moved) throw new Error("DOSSIER_NOT_PENDING_REVIEW");

  const id = randomUUID();
  const decidedAt = new Date().toISOString();
  await pgQuery(
    `INSERT INTO dossier_review_decisions (id,dossier_id,tenant_id,reviewer,decision,comment,decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, dossierId, tenantId, reviewer, decision, comment ?? null, decidedAt]
  );

  await recordAuditEvent(
    dossierId,
    reviewer,
    "human_approval",
    { decision, comment },
    "allowed",
    `Chuyên viên ${reviewer} đã ${decision === "approved" ? "DUYỆT" : decision === "rejected" ? "TỪ CHỐI" : "YÊU CẦU BỔ SUNG"} hồ sơ ${dossierId}.`
  );

  return { id, dossierId, tenantId, reviewer, decision, comment: comment ?? null, decidedAt };
};

export const listReviewDecisions = async (tenantId: string, dossierId: string): Promise<DossierReviewDecisionRecord[]> => {
  const result = await pgQuery(`SELECT * FROM dossier_review_decisions WHERE tenant_id=$1 AND dossier_id=$2 ORDER BY decided_at DESC`, [tenantId, dossierId]);
  return result.rows.map((row: any) => ({
    id: row.id, dossierId: row.dossier_id, tenantId: row.tenant_id, reviewer: row.reviewer,
    decision: row.decision, comment: row.comment, decidedAt: row.decided_at,
  }));
};
