import { DecisionEnvelope } from "../../types/agent.types";
import citationCatalogJson from "../../policy/citation-catalog.json";
import legalLlmContractJson from "../../policy/legal-llm-contract.json";
import { VerifiedCitation } from "../../types/orchestration.types";

interface CitationCatalog {
  policyVersion: string;
  sources: Record<string, VerifiedCitation>;
  ruleSources: Record<string, string[]>;
  fallbacks: { internalPolicySourceId: string; securitySourceId: string; dataProtectionSourceIds: string[] };
}

interface LegalLlmContract {
  allowedRuleIds: string[];
}

const catalog = citationCatalogJson as CitationCatalog;
const ALLOWED_LEGAL_RULE_IDS = new Set((legalLlmContractJson as LegalLlmContract).allowedRuleIds);

const BLOCKING_STATUSES = new Set(["VIOLATION", "BLOCKED", "FAIL"]);

export type CitationAuditIssueCode =
  | "RULE_NOT_IN_CONTRACT"
  | "RULE_HAS_NO_MAPPED_SOURCE"
  | "SOURCE_MISSING_FROM_CATALOG"
  | "SOURCE_NOT_OFFICIALLY_VERIFIED"
  | "SOURCE_NOT_YET_EFFECTIVE"
  | "EVIDENCE_SUMMARY_EMPTY"
  | "BLOCKING_FINDING_LACKS_OFFICIAL_SOURCE";

export interface CitationAuditIssue {
  decisionId: string;
  ruleId?: string;
  code: CitationAuditIssueCode;
  detail: string;
}

export interface FindingAuditResult {
  decisionId: string;
  passed: boolean;
  resolvedSources: VerifiedCitation[];
  issues: CitationAuditIssue[];
}

export interface CitationAuditReport {
  passed: boolean;
  findingResults: FindingAuditResult[];
  issues: CitationAuditIssue[];
}

/**
 * Independent, deterministic re-verification of the Legal Agent's findings — re-derives
 * each finding's source citations from citation-catalog.json by ruleId (the same
 * ground truth citation-governance.service.ts uses) instead of trusting the trace's
 * already-attached `citations` strings, so a bug or bypass upstream can't slip through.
 * No LLM call: an auditor that itself hallucinates would defeat the point.
 */
export const auditLegalFindings = (findings: DecisionEnvelope[]): CitationAuditReport => {
  const findingResults: FindingAuditResult[] = findings.map(finding => {
    const issues: CitationAuditIssue[] = [];
    const resolvedSources: VerifiedCitation[] = [];

    if (!finding.evidence || typeof finding.evidence.summary !== "string" || !finding.evidence.summary.trim()) {
      issues.push({
        decisionId: finding.decisionId,
        code: "EVIDENCE_SUMMARY_EMPTY",
        detail: "Finding has no non-empty evidence.summary to audit against.",
      });
    }

    for (const ruleId of finding.ruleIds) {
      if (!ALLOWED_LEGAL_RULE_IDS.has(ruleId)) {
        issues.push({
          decisionId: finding.decisionId,
          ruleId,
          code: "RULE_NOT_IN_CONTRACT",
          detail: `Rule ${ruleId} is not in the Legal LLM contract's allowed rule list.`,
        });
        continue;
      }

      const sourceIds = catalog.ruleSources[ruleId];
      if (!sourceIds || !sourceIds.length) {
        issues.push({
          decisionId: finding.decisionId,
          ruleId,
          code: "RULE_HAS_NO_MAPPED_SOURCE",
          detail: `Rule ${ruleId} has no citation source mapping in citation-catalog.json.`,
        });
        continue;
      }

      for (const sourceId of sourceIds) {
        const source = catalog.sources[sourceId];
        if (!source) {
          issues.push({
            decisionId: finding.decisionId,
            ruleId,
            code: "SOURCE_MISSING_FROM_CATALOG",
            detail: `Source ${sourceId} referenced by rule ${ruleId} does not exist in the catalog.`,
          });
          continue;
        }
        resolvedSources.push(source);

        if (source.verificationStatus !== "VERIFIED_OFFICIAL") {
          issues.push({
            decisionId: finding.decisionId,
            ruleId,
            code: "SOURCE_NOT_OFFICIALLY_VERIFIED",
            detail: `Source ${sourceId} (${source.documentNumber}) is not VERIFIED_OFFICIAL (status: ${source.verificationStatus}).`,
          });
        }

        if (source.effectiveFrom && new Date(source.effectiveFrom).getTime() > Date.now()) {
          issues.push({
            decisionId: finding.decisionId,
            ruleId,
            code: "SOURCE_NOT_YET_EFFECTIVE",
            detail: `Source ${sourceId} (${source.documentNumber}) is not yet in effect (effectiveFrom: ${source.effectiveFrom}).`,
          });
        }
      }
    }

    // A finding severe enough to block approval/signing/disbursement must be
    // grounded in at least one officially verified source — an internal-policy-only
    // or unresolved citation is not enough to justify blocking a customer's loan.
    if (BLOCKING_STATUSES.has(finding.status)) {
      const hasOfficialSource = resolvedSources.some(source => source.verificationStatus === "VERIFIED_OFFICIAL");
      if (!hasOfficialSource) {
        issues.push({
          decisionId: finding.decisionId,
          code: "BLOCKING_FINDING_LACKS_OFFICIAL_SOURCE",
          detail: `Finding ${finding.decisionId} has status ${finding.status} but no VERIFIED_OFFICIAL source backs it.`,
        });
      }
    }

    return { decisionId: finding.decisionId, passed: issues.length === 0, resolvedSources, issues };
  });

  const issues = findingResults.flatMap(result => result.issues);
  return { passed: issues.length === 0, findingResults, issues };
};

export const getCitationAuditCatalogVersion = (): string => catalog.policyVersion;
