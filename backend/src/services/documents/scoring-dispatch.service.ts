import { randomUUID } from "crypto";
import { pgQuery } from "../../config/pg";
import { getDossier, getLatestDocumentsByType, transitionDossierStatus } from "./dossier.service";
import { getLatestOcrResult } from "./ocr-extraction.service";
import { estimateCreditRisk } from "../tools/ml-credit-risk.tool";
import { assignReviewer } from "./reviewer-routing.service";
import { recordAuditEvent } from "../governance/audit-log.service";

/** Merges every OCR_COMPLETE document's extracted fields into one feature bag for the risk model. Field keys are already namespaced by our own checklist config, so a flat merge is safe. */
const buildScoringFeatures = async (tenantId: string, dossierId: string): Promise<Record<string, unknown>> => {
  const documents = await getLatestDocumentsByType(tenantId, dossierId);
  const features: Record<string, unknown> = {};
  for (const document of documents.filter(doc => doc.status === "OCR_COMPLETE")) {
    const ocr = await getLatestOcrResult(tenantId, document.documentId);
    if (ocr) Object.assign(features, ocr.extractedFields);
  }
  return features;
};

/**
 * Task 5: fires only once, right after a dossier becomes COMPLETE. No external broker exists in
 * this repo — the DB-backed scoring_queue row is written synchronously in the same request, then
 * estimateCreditRisk() (fail-closed, cannot itself approve anything — see ml-credit-risk.tool.ts)
 * is called for a preliminary read. A scoring failure never blocks handoff to a human reviewer;
 * "không tự động duyệt" means the reviewer step must always happen, model or no model.
 */
export const dispatchToScoring = async (tenantId: string, dossierId: string, actor: string): Promise<void> => {
  const movedToQueue = await transitionDossierStatus(tenantId, dossierId, ["COMPLETE"], "QUEUED_FOR_SCORING");
  if (!movedToQueue) return; // already progressed past COMPLETE (e.g. a concurrent recompute already dispatched it)

  const dossier = await getDossier(tenantId, dossierId);
  if (!dossier) throw new Error("DOSSIER_NOT_FOUND");

  const queueId = randomUUID();
  await pgQuery(
    `INSERT INTO scoring_queue (id,dossier_id,tenant_id,status,enqueued_at) VALUES ($1,$2,$3,'queued',NOW())`,
    [queueId, dossierId, tenantId]
  );

  let scoreResult: Record<string, unknown>;
  let queueStatus: "scored" | "failed" = "scored";
  try {
    scoreResult = await estimateCreditRisk(dossierId, await buildScoringFeatures(tenantId, dossierId)) as unknown as Record<string, unknown>;
  } catch (error) {
    queueStatus = "failed";
    scoreResult = { error: error instanceof Error ? error.message : "SCORING_UNAVAILABLE" };
  }

  await pgQuery(
    `UPDATE scoring_queue SET status=$3,scored_at=NOW(),score_result=$4 WHERE tenant_id=$1 AND id=$2`,
    [tenantId, queueId, queueStatus, JSON.stringify(scoreResult)]
  );
  await transitionDossierStatus(tenantId, dossierId, ["QUEUED_FOR_SCORING"], "SCORED");
  await recordAuditEvent(
    dossierId,
    actor,
    "tool_call",
    { queueStatus, scoreResult },
    queueStatus === "scored" ? "allowed" : "blocked",
    queueStatus === "scored" ? `Hồ sơ ${dossierId} đã có kết quả đánh giá sơ bộ.` : `Đánh giá sơ bộ THẤT BẠI cho hồ sơ ${dossierId}: ${String(scoreResult.error)}.`
  );

  await assignReviewer(tenantId, dossierId, actor);
};
