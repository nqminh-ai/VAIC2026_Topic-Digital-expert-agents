import { randomUUID } from "crypto";
import { pgQuery } from "../../config/pg";
import { getMailTransporter } from "../../config/mailer";
import { config } from "../../config/env";
import { recordAuditEvent } from "../governance/audit-log.service";
import { LoanDossier } from "../../types/document-intake.types";

interface MissingDocEntry {
  documentType: string;
  displayName: string;
}

const sameMissingSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
};

const buildEmailBody = (dossier: LoanDossier, missing: MissingDocEntry[]): string =>
  [
    `Kính gửi Quý khách,`,
    ``,
    `Hồ sơ vay ${dossier.loanType === "mortgage" ? "thế chấp" : "tín chấp"} (mã hồ sơ: ${dossier.dossierId}) hiện còn thiếu ${missing.length} giấy tờ sau, đề nghị Quý khách bổ sung:`,
    ``,
    ...missing.map((item, index) => `${index + 1}. ${item.displayName}`),
    ``,
    `Quý khách chỉ cần nộp bổ sung đúng (các) giấy tờ còn thiếu ở trên, không cần nộp lại toàn bộ hồ sơ.`,
    ``,
    `Trân trọng,`,
    config.gmailSenderName,
  ].join("\n");

/**
 * Task 4: lists missing documents by name (never a generic "hồ sơ chưa đầy đủ"). Only sends when
 * the missing-list actually changed since the last notice, so re-uploading one of several missing
 * files doesn't trigger a fresh email per upload attempt.
 */
export const notifyMissingDocuments = async (tenantId: string, dossier: LoanDossier, missing: MissingDocEntry[], actor: string): Promise<void> => {
  const last = await pgQuery(
    `SELECT missing_document_types FROM dossier_missing_document_notices WHERE tenant_id=$1 AND dossier_id=$2 ORDER BY sent_at DESC LIMIT 1`,
    [tenantId, dossier.dossierId]
  );
  const lastMissingTypes: string[] = last.rows[0]?.missing_document_types ?? [];
  const currentMissingTypes = missing.map(item => item.documentType);
  if (sameMissingSet(lastMissingTypes, currentMissingTypes)) return;

  const id = randomUUID();
  try {
    const transporter = getMailTransporter();
    await transporter.sendMail({
      from: `"${config.gmailSenderName}" <${config.gmailSmtpUser}>`,
      to: dossier.customerEmail,
      subject: `[SHB] Hồ sơ vay ${dossier.dossierId} cần bổ sung giấy tờ`,
      text: buildEmailBody(dossier, missing),
    });
    await pgQuery(
      `INSERT INTO dossier_missing_document_notices (id,dossier_id,tenant_id,missing_document_types,recipient_email,sent_at,status) VALUES ($1,$2,$3,$4,$5,NOW(),'sent')`,
      [id, dossier.dossierId, tenantId, JSON.stringify(currentMissingTypes), dossier.customerEmail]
    );
    await recordAuditEvent(dossier.dossierId, actor, "tool_call", { missingDocumentTypes: currentMissingTypes }, "allowed", `Đã gửi email thông báo thiếu ${missing.length} giấy tờ tới ${dossier.customerEmail}.`);
  } catch (error) {
    // A notification failure (e.g. Gmail credentials not configured yet) must not fail the
    // upload/OCR request that triggered it — it's a side-channel, not the data-integrity path.
    const message = error instanceof Error ? error.message : "UNKNOWN_MAIL_ERROR";
    await pgQuery(
      `INSERT INTO dossier_missing_document_notices (id,dossier_id,tenant_id,missing_document_types,recipient_email,sent_at,status,error) VALUES ($1,$2,$3,$4,$5,NOW(),'failed',$6)`,
      [id, dossier.dossierId, tenantId, JSON.stringify(currentMissingTypes), dossier.customerEmail, message]
    );
    await recordAuditEvent(dossier.dossierId, actor, "tool_call", { missingDocumentTypes: currentMissingTypes, error: message }, "blocked", `Gửi email thông báo thiếu giấy tờ THẤT BẠI: ${message}`);
  }
};
