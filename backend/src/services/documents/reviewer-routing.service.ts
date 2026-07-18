import { pgQuery } from "../../config/pg";
import { transitionDossierStatus } from "./dossier.service";
import { listUsernamesByRole } from "../auth/demo-user.store";
import { recordAuditEvent } from "../governance/audit-log.service";

/**
 * Task 5 routing: workload-based only (least PENDING_REVIEW dossiers currently assigned). This repo
 * has no officer directory beyond the 2 demo accounts and no per-officer loan-type specialization
 * field, so "route theo loại vay" cannot be modeled honestly yet — see demo-user.store.ts comment.
 */
const pickLeastLoadedOfficer = async (tenantId: string): Promise<string> => {
  const officers = listUsernamesByRole("CREDIT_OFFICER");
  if (!officers.length) throw new Error("NO_CREDIT_OFFICER_AVAILABLE");

  const result = await pgQuery(
    `SELECT a.assigned_officer, COUNT(*) AS open_count
     FROM dossier_review_assignments a
     JOIN loan_dossiers d ON d.dossier_id = a.dossier_id AND d.tenant_id = a.tenant_id
     WHERE a.tenant_id = $1 AND d.status = 'PENDING_REVIEW'
     GROUP BY a.assigned_officer`,
    [tenantId]
  );
  const workload = new Map<string, number>(result.rows.map((row: any) => [row.assigned_officer, Number(row.open_count)]));

  return officers.reduce((least, candidate) => ((workload.get(candidate) ?? 0) < (workload.get(least) ?? 0) ? candidate : least), officers[0]);
};

export const assignReviewer = async (tenantId: string, dossierId: string, actor: string): Promise<string> => {
  const officer = await pickLeastLoadedOfficer(tenantId);
  await pgQuery(
    `INSERT INTO dossier_review_assignments (dossier_id,tenant_id,assigned_officer,assigned_at) VALUES ($1,$2,$3,NOW())
     ON CONFLICT (dossier_id) DO UPDATE SET assigned_officer=EXCLUDED.assigned_officer, assigned_at=EXCLUDED.assigned_at`,
    [dossierId, tenantId, officer]
  );
  const moved = await transitionDossierStatus(tenantId, dossierId, ["SCORED"], "PENDING_REVIEW");
  if (!moved) throw new Error("DOSSIER_NOT_SCORED");
  await recordAuditEvent(dossierId, actor, "tool_call", { assignedOfficer: officer }, "allowed", `Hồ sơ ${dossierId} được route tới chuyên viên ${officer} (theo tải công việc hiện tại).`);
  return officer;
};
