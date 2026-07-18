import { BookOpenCheck, CheckCircle2, CircleDashed, Clock3, ExternalLink, Landmark, ShieldCheck, TrendingUp, TicketCheck, TriangleAlert, Workflow } from "lucide-react";
import { Card } from "../../components/Card";
import { Badge } from "../../components/Badge";
import { Skeleton } from "../../components/Skeleton";
import { TypingIndicator } from "../../components/TypingIndicator";
import { useOrchestrationStore } from "../../store/orchestrationStore";
import styles from "./FinalAnswerPanel.module.css";

export const FinalAnswerPanel = () => {
  const phase = useOrchestrationStore(s => s.phase);
  const response = useOrchestrationStore(s => s.response);
  const advisoryMode = useOrchestrationStore(s => s.advisoryMode);
  const advisoryFinalAnswer = useOrchestrationStore(s => s.advisoryFinalAnswer);
  const runId = useOrchestrationStore(s => s.runId);
  const error = useOrchestrationStore(s => s.error);

  if (phase === "idle") {
    return (
      <Card title="Kết luận thẩm định">
        <p className={styles.empty}>Nhập yêu cầu thẩm định ở trên để bắt đầu một phiên điều phối AI.</p>
      </Card>
    );
  }

  if (phase === "error") {
    return (
      <Card title="Kết luận thẩm định">
        <div className={styles.errorBox}>{error ?? "Đã xảy ra lỗi không xác định."}</div>
      </Card>
    );
  }

  if (phase === "running" && !response && !advisoryMode) {
    return (
      <Card title="Kết luận thẩm định">
        <div className={styles.loading}>
          <TypingIndicator label="Đang tổng hợp kết luận từ các Agent…" />
          <Skeleton height={16} width="90%" />
          <Skeleton height={16} width="70%" />
        </div>
      </Card>
    );
  }

  if (advisoryMode) {
    return (
      <Card
        title="Trợ lý tư vấn nghiệp vụ"
        action={runId ? <Badge tone="brand">Run {runId.replace("run-", "#")}</Badge> : undefined}
      >
        <p className={styles.answer}>{advisoryFinalAnswer}</p>
      </Card>
    );
  }

  if (!response) return null;

  return (
    <Card title="Kết luận thẩm định" action={<Badge tone="brand">Run {response.runId.replace("run-", "#")}</Badge>}>
      <p className={styles.answer}>{response.finalAnswer}</p>

      {response.reasoning && (
        <div className={styles.reasoningPanel}>
          <Workflow size={16} />
          <div>
            <span className={styles.reasoningLabel}>Diễn giải liên kết đa Agent</span>
            <p className={styles.reasoningText}>{response.reasoning}</p>
          </div>
        </div>
      )}

      {response.confidence?.status === "NEEDS_REVIEW" && (
        <div className={styles.errorBox} role="status">
          Hệ thống chưa đủ chắc chắn để đưa ra quyết định. Hồ sơ đã được chuyển sang người kiểm duyệt; không có hạn mức hoặc giá vay nào được tự động phát hành.
        </div>
      )}

      {response.transparency && (
        <section className={styles.trustPanel} aria-label="Minh bạch và nguồn kiểm chứng">
          <div className={styles.trustHeader}>
            <ShieldCheck size={18} />
            <div>
              <strong>Mức tin cậy: {response.transparency.confidence}</strong>
              <span>Bao phủ bằng chứng {response.transparency.evidenceCoveragePercent}% · {response.transparency.policyVersion}</span>
            </div>
            {response.transparency.requiresHumanReview && <Badge tone="warning">Cần người duyệt</Badge>}
          </div>

          <ol className={styles.sourceList}>
            {response.transparency.citations.map(citation => (
              <li key={citation.id}>
                <BookOpenCheck size={14} />
                <div>
                  {citation.url ? (
                    <a href={citation.url} target="_blank" rel="noreferrer">
                      {citation.documentNumber}: {citation.locator} <ExternalLink size={11} />
                    </a>
                  ) : (
                    <strong>{citation.documentNumber}: {citation.locator}</strong>
                  )}
                  <span>{citation.title} · {citation.issuer}</span>
                </div>
                <Badge tone={citation.verificationStatus === "VERIFIED_OFFICIAL" ? "success" : "warning"}>
                  {citation.verificationStatus === "VERIFIED_OFFICIAL" ? "Nguồn chính thức" : "Cần kiểm duyệt nội bộ"}
                </Badge>
              </li>
            ))}
          </ol>

          {response.transparency.limitations.length > 0 && (
            <div className={styles.limitations}>
              <TriangleAlert size={14} />
              <ul>{response.transparency.limitations.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {(response.approvedTerms || response.businessValue) && (
        <div className={styles.decisionMetrics}>
          <div><Landmark size={16} /><span><small>Đề xuất</small><strong>{response.approvedTerms ? `${response.approvedTerms.loanAmount.toLocaleString("vi-VN")} ₫ · ${response.approvedTerms.tenureYears} năm` : "—"}</strong></span></div>
          <div><TrendingUp size={16} /><span><small>RAROC dự kiến</small><strong>{response.businessValue ? `${response.businessValue.rarocPercent}%` : "—"}</strong></span></div>
          <div><Clock3 size={16} /><span><small>Thời gian tiết kiệm</small><strong>{response.businessValue ? `${response.businessValue.estimatedManualMinutesSaved} phút` : "—"}</strong></span></div>
        </div>
      )}

      {response.approvalTicketId && (
        <div className={styles.ticket}>
          <TicketCheck size={15} />
          Facility ID: <strong>{response.approvalTicketId}</strong>
        </div>
      )}

      {response.conditions && response.conditions.length > 0 && (
        <div className={styles.conditions}>
          <p className={styles.conditionsTitle}>Điều kiện tiên quyết ({response.conditions.length})</p>
          <ul className={styles.conditionList}>
            {response.conditions.map(condition => (
              <li key={condition.id}>
                {condition.status === "fulfilled" ? (
                  <CheckCircle2 size={14} className={styles.fulfilled} />
                ) : (
                  <CircleDashed size={14} className={styles.pending} />
                )}
                <span>{condition.description}</span>
                <Badge tone="neutral">{condition.blocksAt}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};
