import { AgentTrace } from "../../types/trace.types";
import { DecisionEnvelope } from "../../types/agent.types";
import { auditLegalFindings, CitationAuditIssue } from "../governance/citation-audit.service";

const summarizeIssues = (issues: CitationAuditIssue[]): string =>
  issues.map(issue => `[${issue.decisionId}${issue.ruleId ? `/${issue.ruleId}` : ""}] ${issue.detail}`).join(" ");

/**
 * Runs immediately after the Legal Agent, before Operations. Independently re-verifies
 * every legal finding's citations against citation-catalog.json (see
 * citation-audit.service.ts) instead of trusting the citations already attached to the
 * trace. If a blocking finding (VIOLATION/BLOCKED/FAIL) turns out to rest on a source
 * that isn't officially verified — or on no resolvable source at all — this agent raises
 * its own BLOCKER finding so the case is force-escalated to human review rather than
 * silently proceeding on an ungrounded legal claim.
 */
export const runLegalAuditAgent = async (
  runId: string,
  legalTrace: AgentTrace | undefined
): Promise<AgentTrace> => {
  const startedAt = new Date().toISOString();
  const legalFindings = (legalTrace?.findings ?? []) as DecisionEnvelope[];

  if (!legalTrace || legalTrace.status === "failed") {
    return {
      id: `trace-legal-audit-${Date.now()}`,
      runId,
      agent: "legal_audit",
      task: "Independently verify Legal Agent citations against the official source catalog",
      status: "completed",
      summary: "Legal Agent không trả về kết quả để kiểm chứng (agent thất bại hoặc bị bỏ qua) — không có citation nào để audit.",
      toolCalls: [],
      findings: [],
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  const report = auditLegalFindings(legalFindings);

  const findings: DecisionEnvelope[] = report.passed
    ? []
    : [
        {
          decisionId: `dec-legal-audit-${Date.now()}`,
          agent: "legal_audit",
          status: "BLOCKED",
          severity: "BLOCKER",
          blocksAt: "APPROVAL",
          finding:
            `Audit độc lập phát hiện ${report.issues.length} vấn đề về căn cứ pháp lý (citation) trong kết luận của Legal Agent — ` +
            "không thể xác nhận kết luận này được hỗ trợ đầy đủ bởi nguồn chính thức đã kiểm chứng. " +
            summarizeIssues(report.issues),
          evidence: { summary: summarizeIssues(report.issues), issues: report.issues as unknown as Record<string, unknown> },
          ruleIds: [],
          citations: [],
          requiredFix: "Chuyên viên pháp lý con người phải soát xét lại căn cứ trích dẫn trước khi phê duyệt hồ sơ.",
        },
      ];

  const summary = report.passed
    ? `Audit độc lập xác nhận toàn bộ ${legalFindings.length} kết luận của Legal Agent đều có căn cứ trích dẫn hợp lệ từ nguồn chính thức (citation-catalog.json).`
    : `Audit độc lập TỪ CHỐI xác nhận ${report.issues.length}/${legalFindings.length} kết luận do thiếu căn cứ trích dẫn chính thức đủ tin cậy. ${summarizeIssues(report.issues)}`;

  return {
    id: `trace-legal-audit-${Date.now()}`,
    runId,
    agent: "legal_audit",
    task: "Independently verify Legal Agent citations against the official source catalog",
    status: report.passed ? "completed" : "blocked",
    summary,
    toolCalls: [
      {
        toolName: "auditLegalFindings",
        input: { findingsChecked: legalFindings.length },
        output: { passed: report.passed, issueCount: report.issues.length },
        status: "success",
      },
    ],
    findings,
    startedAt,
    completedAt: new Date().toISOString(),
  };
};
