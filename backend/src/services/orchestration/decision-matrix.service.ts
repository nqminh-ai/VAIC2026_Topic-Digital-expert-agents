import { DecisionEnvelope, ConditionPrecedent, BlocksAt } from "../../types/agent.types";
import { randomUUID } from "crypto";
import { decisionPolicy } from "../../config/policy";

export interface DecisionMatrixOutput {
  finalDecision: "FAST_PASS" | "PASS" | "CONDITIONAL_PASS" | "REJECTED" | "HUMAN_ESCALATION";
  vetoedBy?: string;
  reasonCodes: string[];
  conditions: ConditionPrecedent[];
  requiredFixes: string[];
}

export const decideNextAction = (
  creditFindings: DecisionEnvelope[],
  productFindings: DecisionEnvelope[],
  legalFindings: DecisionEnvelope[],
  fraudFindings: DecisionEnvelope[] = []
): DecisionMatrixOutput => {
  const policy = decisionPolicy.decisionMatrix;
  const allFindings = [...creditFindings, ...productFindings, ...legalFindings, ...fraudFindings];
  
  const conditions: ConditionPrecedent[] = [];
  const requiredFixes: string[] = [];
  const reasonCodes: string[] = [];
  let vetoedBy: string | undefined = undefined;

  // 1. Extract conditions and fixes
  for (const finding of allFindings) {
    if (finding.status === "FAIL" || finding.status === "VIOLATION" || finding.status === "BLOCKED") {
      reasonCodes.push(...finding.ruleIds);
      if (finding.requiredFix) {
        requiredFixes.push(finding.requiredFix);
      }
    }
    
    // Convert CONDITION severity to ConditionPrecedent
    if (finding.severity === "CONDITION") {
      conditions.push({
        id: `cond-${randomUUID()}`,
        description: finding.finding,
        blocksAt: finding.blocksAt,
        status: "pending"
      });
    }
  }

  // 2. Apply Veto Hierarchy
  
  // A. Check for Consent Blocker (Blocks external data check)
  const consentBlocker = legalFindings.find(f => f.ruleIds.includes(policy.ruleIds.consentMissing));
  if (consentBlocker) {
    vetoedBy = "legal";
    return {
      finalDecision: "HUMAN_ESCALATION",
      vetoedBy,
      reasonCodes,
      conditions,
      requiredFixes: [policy.requiredFixes.consentMissing]
    };
  }

  // B. Check for Insurance Tying (Violation blocking approval)
  const tyingViolation = legalFindings.find(f => f.ruleIds.includes(policy.ruleIds.insuranceTying));
  if (tyingViolation) {
    vetoedBy = "legal";
    return {
      finalDecision: "HUMAN_ESCALATION",
      vetoedBy,
      reasonCodes: [policy.ruleIds.insuranceTying],
      conditions: [],
      requiredFixes
    };
  }

  // C. Missing/negative guarantee evidence blocks disbursement, but absence of proof is
  // not proof that the collateral is legally invalid. Escalate for documentary review.
  const projectDirty = legalFindings.find(f => f.ruleIds.includes(policy.ruleIds.projectNotRegistered));
  if (projectDirty) {
    vetoedBy = "legal";
    return {
      finalDecision: "HUMAN_ESCALATION",
      vetoedBy,
      reasonCodes,
      conditions: [],
      requiredFixes: [policy.requiredFixes.projectEvidenceMissing]
    };
  }

  // D. Check for credit failure
  const creditFail = creditFindings.find(f => f.ruleIds.includes(policy.ruleIds.creditRestructureFailed));
  if (creditFail) {
    vetoedBy = "credit";
    return {
      finalDecision: "REJECTED",
      vetoedBy,
      reasonCodes,
      conditions: [],
      requiredFixes: [policy.requiredFixes.creditFailed]
    };
  }

  // E. Catch-all safety net: any BLOCKER-severity finding not already matched by a
  // specific rule above (A-D enumerate known cases; new agents/checks will keep adding
  // rule IDs this list doesn't know about yet) must never silently fall through to an
  // automatic PASS or CONDITIONAL_PASS below — escalate to a human reviewer instead.
  //
  // Exception: the credit agent deliberately keeps the *original* LTV/DTI breach findings
  // in its output as an audit trail even after finding a passing restructure — those are
  // superseded, not unresolved, once CREDIT_RESTRUCTURE_PASS is present.
  const creditRestructured = creditFindings.find(f => f.ruleIds.includes(policy.ruleIds.creditRestructurePassed));
  const supersededByRestructure = new Set(policy.supersededByRestructure);

  const unhandledBlocker = allFindings.find(f => {
    if (f.severity !== "BLOCKER") return false;
    if (!(f.status === "FAIL" || f.status === "VIOLATION" || f.status === "BLOCKED")) return false;
    if (creditRestructured && f.agent === "credit" && f.ruleIds.some(id => supersededByRestructure.has(id))) {
      return false;
    }
    return true;
  });
  if (unhandledBlocker) {
    vetoedBy = unhandledBlocker.agent;
    return {
      finalDecision: "HUMAN_ESCALATION",
      vetoedBy,
      reasonCodes,
      conditions: [],
      requiredFixes: unhandledBlocker.requiredFix ? [unhandledBlocker.requiredFix] : requiredFixes
    };
  }

  // F. Check if original failed but restructure passed (Conditional Pass)
  const hasLegalConditions = allFindings.some(f => f.severity === "CONDITION");

  if (creditRestructured || hasLegalConditions) {
    return {
      finalDecision: "CONDITIONAL_PASS",
      reasonCodes: creditRestructured ? [policy.reasonCodes.creditRestructured] : [policy.reasonCodes.legalConditionsRequired],
      conditions,
      requiredFixes
    };
  }

  // G. Fast pass or standard pass
  return {
    finalDecision: "PASS",
    reasonCodes: [policy.reasonCodes.standardCheckPassed],
    conditions: [],
    requiredFixes: []
  };
};
