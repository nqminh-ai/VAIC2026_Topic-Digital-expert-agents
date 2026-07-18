import { BookOpenCheck, CheckCircle2, ChevronDown, CircleDashed, Clock3, ExternalLink, Landmark, Loader2, MinusCircle, ShieldCheck, TrendingUp, TicketCheck, TriangleAlert, Workflow } from "lucide-react";
import { Card } from "../../components/Card";
import { Badge } from "../../components/Badge";
import { Skeleton } from "../../components/Skeleton";
import { TypingIndicator } from "../../components/TypingIndicator";
import { useOrchestrationStore } from "../../store/orchestrationStore";
import type { PipelineStep } from "../../store/orchestrationStore";
import type { AnswerTransparency } from "../../types/api";
import baseStyles from "./FinalAnswerPanel.module.css";
import traceStyles from "./DecisionTrace.module.css";

const styles = { ...baseStyles, ...traceStyles };

const TRACE_STATUS = {
  pending: { label: "Chờ xử lý", icon: CircleDashed },
  in_progress: { label: "Đang xử lý", icon: Loader2 },
  done: { label: "Hoàn tất", icon: CheckCircle2 },
  skipped: { label: "Bỏ qua", icon: MinusCircle },
} as const;

const DecisionTrace = ({ steps, reasoning, running = false }: { steps: PipelineStep[]; reasoning?: string; running?: boolean }) => (
  <details className={styles.tracePanel} open={running}>
    <summary className={styles.traceSummary}>
      <span className={styles.traceTitleIcon}><Workflow size={16} /></span>
      <span>
        <strong>{running ? "Tiến trình thẩm định" : "Nhật ký ra quyết định"}</strong>
        <small>{running ? "Cập nhật trực tiếp theo từng bước" : `${steps.filter(step => step.status === "done").length} bước đã hoàn tất`}</small>
      </span>
      <ChevronDown size={16} className={styles.chevron} />
    </summary>
    <div className={styles.traceBody}>
      <p className={styles.traceNotice}>Đây là nhật ký nghiệp vụ đã được tóm tắt và che dữ liệu nhạy cảm, không phải suy luận nội bộ của mô hình.</p>
      <ol className={styles.traceList} aria-label="Các bước xử lý hồ sơ">
        {steps.map(step => {
          const status = TRACE_STATUS[step.status];
          const Icon = status.icon;
          return (
            <li key={step.key} className={styles[step.status]}>
              <span className={styles.traceMarker}><Icon size={13} /></span>
              <div>
                <span className={styles.traceStepHeader}><strong>{step.label}</strong><small>{status.label}</small></span>
                {step.trace?.summary && <p>{step.trace.summary}</p>}
                {step.status === "in_progress" && <p>Đang kiểm tra dữ liệu và áp dụng chính sách liên quan…</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {reasoning && <div className={styles.traceConclusion}><strong>Tổng hợp liên kết đa Agent</strong><p>{reasoning}</p></div>}
    </div>
  </details>
);

const EvidenceClaims = ({ transparency }: { transparency: AnswerTransparency }) => {
  const citationsById = new Map(transparency.citations.map(citation => [citation.id, citation]));
  if (transparency.claims.length === 0) return null;
  return (
    <div className={styles.claimsBlock}>
      <div className={styles.sectionHeading}><BookOpenCheck size={15} /><strong>Kết luận và bằng chứng đối chiếu</strong></div>
      <ol className={styles.claimList}>
        {transparency.claims.map((claim, index) => (
          <li key={claim.claimId}>
            <span className={styles.claimIndex}>{index + 1}</span>
            <div>
              <p>{claim.text}</p>
              <div className={styles.claimCitations}>
                {claim.citationIds.length === 0 && <span className={styles.noCitation}>Không yêu cầu nguồn viện dẫn</span>}
                {claim.citationIds.map(id => {
                  const citation = citationsById.get(id);
                  if (!citation) return <span key={id} className={styles.missingCitation}>Nguồn chưa khả dụng</span>;
                  const label = `${citation.documentNumber} · ${citation.locator}`;
                  return citation.url
                    ? <a key={id} href={citation.url} target="_blank" rel="noreferrer" title={citation.title}>{label}<ExternalLink size={10} /></a>
                    : <span key={id} title={citation.title}>{label}</span>;
                })}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
};

export const FinalAnswerPanel = () => {
  const phase = useOrchestrationStore(s => s.phase);
  const response = useOrchestrationStore(s => s.response);
  const advisoryMode = useOrchestrationStore(s => s.advisoryMode);
  const advisoryFinalAnswer = useOrchestrationStore(s => s.advisoryFinalAnswer);
  const runId = useOrchestrationStore(s => s.runId);
  const error = useOrchestrationStore(s => s.error);
  const steps = useOrchestrationStore(s => s.steps);

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
        <div className={styles.errorBox} style={{ whiteSpace: "pre-wrap" }}>{error ?? "Đã xảy ra lỗi không xác định."}</div>
      </Card>
    );
  }

  if (phase === "running" && !response && !advisoryMode) {
    return (
      <Card title="Kết luận thẩm định">
        <div className={styles.loading}>
          <TypingIndicator label="Đang tổng hợp kết luận từ các Agent…" />
          {steps.length > 0 ? <DecisionTrace steps={steps} running /> : <><Skeleton height={16} width="90%" /><Skeleton height={16} width="70%" /></>}
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

      {steps.length > 0 && <DecisionTrace steps={steps} reasoning={response.reasoning} />}

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

          <EvidenceClaims transparency={response.transparency} />

          {response.transparency.citations.length > 0 && <details className={styles.sourceCatalog}>
            <summary>Danh mục nguồn ({response.transparency.citations.length}) <ChevronDown size={13} /></summary>
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
          </details>}

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
