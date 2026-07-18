import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { Header } from "../layouts/Header";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Skeleton } from "../components/Skeleton";
import { getDemoAccessToken } from "../services/authService";
import { getDossierDetail, submitReviewDecision } from "../services/dossierService";
import { ApiError } from "../services/httpClient";
import {
  documentStatusLabel, documentStatusTone, documentTypeLabel,
  dossierStatusLabel, dossierStatusTone, humanizeFieldKey, loanTypeLabel,
} from "../features/dossier/dossierStatus";
import type { DossierDetail, ReviewDecision } from "../types/document-intake";
import styles from "./DossierDetailPage.module.css";

export const DossierDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<DossierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState<ReviewDecision | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getDemoAccessToken();
      setDetail(await getDossierDetail(token, id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không tải được chi tiết hồ sơ.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const decide = async (decision: ReviewDecision) => {
    if (!id) return;
    setSubmitting(decision);
    setError(null);
    try {
      const token = await getDemoAccessToken();
      await submitReviewDecision(token, id, decision, comment.trim() || undefined);
      setComment("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không thể ghi nhận quyết định.");
    } finally {
      setSubmitting(null);
    }
  };

  if (loading && !detail) {
    return (
      <>
        <Header eyebrow="Chi tiết hồ sơ" title="Đang tải..." />
        <div className={styles.skeletonStack}>
          {[0, 1, 2].map(i => <Skeleton key={i} height={80} />)}
        </div>
      </>
    );
  }

  if (error && !detail) {
    return (
      <>
        <Header eyebrow="Chi tiết hồ sơ" title="Không tải được hồ sơ" />
        <p className={styles.error}>{error}</p>
      </>
    );
  }

  if (!detail) return null;
  const { dossier, documents, completeness, scoring, assignedOfficer, reviewDecisions } = detail;

  return (
    <>
      <Link to="/dossiers" className={styles.backLink}><ArrowLeft size={14} /> Quay lại hàng đợi</Link>
      <Header
        eyebrow={loanTypeLabel[dossier.loanType]}
        title={dossier.dossierId}
        subtitle={`Khách hàng ${dossier.customerId} · ${dossier.customerEmail}`}
        action={<Badge tone={dossierStatusTone[dossier.status]}>{dossierStatusLabel[dossier.status]}</Badge>}
      />

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.grid}>
        <Card title="Checklist">
          {completeness.complete ? (
            <p className={styles.okLine}><CheckCircle2 size={16} /> Đã đủ toàn bộ giấy tờ bắt buộc.</p>
          ) : (
            <>
              <p className={styles.warnLine}><CircleAlert size={16} /> Còn thiếu {completeness.missingDocumentTypes.length} giấy tờ:</p>
              <ul className={styles.missingList}>
                {completeness.missingDocumentTypes.map(item => <li key={item.documentType}>{item.displayName}</li>)}
              </ul>
            </>
          )}
          {assignedOfficer ? <p className={styles.assigned}>Chuyên viên phụ trách: <strong>{assignedOfficer}</strong></p> : null}
        </Card>

        {scoring ? (
          <Card title="Kết quả đánh giá sơ bộ">
            <div className={styles.scoreBox}>
              <Badge tone={scoring.status === "scored" ? "success" : "warning"}>{scoring.status === "scored" ? "Đã có kết quả" : "Không lấy được kết quả"}</Badge>
              <pre className={styles.scoreJson}>{JSON.stringify(scoring.score_result, null, 2)}</pre>
              <p className={styles.disclaimer}>Kết quả mô hình chỉ mang tính tham khảo (DEMO_ONLY) — quyết định cuối cùng luôn do chuyên viên thực hiện.</p>
            </div>
          </Card>
        ) : null}
      </div>

      <Card title={`Giấy tờ đã nộp (${documents.length})`} className={styles.documentsCard}>
        {documents.length === 0 ? (
          <p className={styles.empty}>Chưa có giấy tờ nào được tải lên.</p>
        ) : (
          <div className={styles.documentList}>
            {documents.map(doc => (
              <div key={doc.documentId} className={styles.documentRow}>
                <div className={styles.documentHead}>
                  <strong>{documentTypeLabel[doc.documentType] ?? doc.documentType}</strong>
                  <Badge tone={documentStatusTone[doc.status]}>{documentStatusLabel[doc.status]}</Badge>
                </div>
                <span className={styles.documentMeta}>{doc.originalFilename} · {new Date(doc.uploadedAt).toLocaleString("vi-VN")}</span>
                {doc.ocrResult ? (
                  <div className={styles.fieldGrid}>
                    {Object.entries(doc.ocrResult.extractedFields).map(([key, value]) => (
                      <div key={key} className={styles.fieldCell}>
                        <span className={styles.fieldLabel}>{humanizeFieldKey(key)}</span>
                        <span className={styles.fieldValue}>{value}</span>
                        <span className={styles.fieldConfidence}>{Math.round((doc.ocrResult!.fieldConfidence[key] ?? 0) * 100)}%</span>
                      </div>
                    ))}
                    {doc.ocrResult.missingRequiredFields.map(key => (
                      <div key={key} className={[styles.fieldCell, styles.fieldMissing].join(" ")}>
                        <span className={styles.fieldLabel}>{humanizeFieldKey(key)}</span>
                        <span className={styles.fieldValue}>— thiếu —</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      {dossier.status === "PENDING_REVIEW" ? (
        <Card title="Quyết định của chuyên viên">
          <textarea
            className={styles.commentBox}
            placeholder="Ghi chú / lý do (không bắt buộc)"
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={3}
          />
          <div className={styles.actionRow}>
            <Button variant="primary" isLoading={submitting === "approved"} disabled={!!submitting} onClick={() => decide("approved")}>
              <CheckCircle2 size={15} /> Duyệt
            </Button>
            <Button variant="secondary" isLoading={submitting === "more_info"} disabled={!!submitting} onClick={() => decide("more_info")}>
              <CircleAlert size={15} /> Yêu cầu bổ sung
            </Button>
            <Button variant="ghost" isLoading={submitting === "rejected"} disabled={!!submitting} onClick={() => decide("rejected")}>
              <XCircle size={15} /> Từ chối
            </Button>
          </div>
        </Card>
      ) : null}

      {reviewDecisions.length > 0 ? (
        <Card title="Lịch sử xét duyệt">
          <ul className={styles.decisionList}>
            {reviewDecisions.map(decision => (
              <li key={decision.id}>
                <strong>{decision.reviewer}</strong> — {decision.decision === "approved" ? "Duyệt" : decision.decision === "rejected" ? "Từ chối" : "Yêu cầu bổ sung"}
                <span className={styles.decisionMeta}>{new Date(decision.decidedAt).toLocaleString("vi-VN")}</span>
                {decision.comment ? <p className={styles.decisionComment}>{decision.comment}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
};
