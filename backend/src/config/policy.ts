import decisionPolicyJson from "../policy/decision-policy.json";
import routingCatalogJson from "../policy/routing-catalog.json";
import productCatalogJson from "../policy/product-catalog.json";
import agentContractsJson from "../policy/agent-contracts.json";
import { IncomeSource } from "../types/case.types";
import { ProductOption } from "../types/agent.types";
import { AgentContract } from "../types/product.types";

type IncomeType = IncomeSource["type"];

export interface DecisionPolicy {
  policyId: string;
  version: string;
  effectiveFrom: string;
  routing: { minimumPromptCharacters: number; maximumPromptCharacters: number; minimumPromptTokens: number; exactMatchScore: number };
  credit: {
    stressAnnualRate: number; maximumDtiPercent: number; maximumLtvPercent: number; maximumMortgageTenureYears: number;
    autoRefinanceTenureYears: number; creditLimitReductionFactor: number; creditCardMonthlyObligationRate: number;
    incomeRecognitionFactors: Record<IncomeType, number>;
    ruleIds: Record<"incomeCalculated" | "ltvExceeded" | "dtiExceeded" | "restructurePassed" | "restructureFailed", string>;
  };
  fastLane: { maximumLoanAmountVnd: number; requiredPropertyStatus: string; requiredMaritalStatus: string; requireNoExistingDebt: boolean; allowedIncomeTypes: IncomeType[] };
  autoApproval: {
    maximumLoanAmountVnd: number; maximumDtiPercent: number; maximumLtvPercent: number; minimumApplicantAge: number; maximumApplicantAge: number;
    requiredPropertyStatus: string; requireNoExistingDebt: boolean; requiredConsentFields: Array<"credit_check" | "tax_income_check">;
    reasonCodes: Record<"amount" | "dti" | "ltv" | "credit" | "collateral" | "debt" | "consent" | "age" | "product", string>;
  };
  profitability: { fundingCostRate: number; expectedLossRate: number; capitalAllocationRate: number; capitalHurdleRate: number; automatedCaseCostVnd: number; manualCaseCostVnd: number; manualProcessingMinutes: number; minimumRarocPercent: number };
  decisionMatrix: {
    ruleIds: Record<"consentMissing" | "insuranceTying" | "projectNotRegistered" | "creditRestructureFailed" | "creditRestructurePassed", string>;
    supersededByRestructure: string[];
    reasonCodes: Record<"creditRestructured" | "legalConditionsRequired" | "standardCheckPassed", string>;
    requiredFixes: Record<"consentMissing" | "projectEvidenceMissing" | "creditFailed", string>;
  };
  fraud: {
    ruleIds: Record<"incomeDebtMismatch" | "collateralValueOutlier" | "ageTenureMismatch" | "evidenceInconsistency", string>;
    incomeDebtRatioCeiling: number;
    collateralValueToLoanCeiling: number;
    minimumRepaymentAgeMargin: number;
  };
  runtimeBudget: { maximumModelCalls: number; estimatedCostPerModelCallUsd: number; securityBlockEstimatedCostUsd: number };
  uncertainty: { minimumConfidenceScore: number; minimumEvidenceCoverage: number; requireAllMandatoryAgents: boolean; requireSuccessfulToolCalls: boolean; requireLegalCitations: boolean; mandatoryAgentsByLane: Record<"FAST" | "COMPLEX", string[]> };
}

export interface RoutingCatalog {
  catalogId: string; version: string; injectionCaseId: string; injectionSignals: string[]; creditIntentSignals: string[];
}

export interface ProductCatalog {
  catalogId: string; version: string; primaryProductId: string; products: ProductOption[];
  eligibility: { autoRefinanceProductId: string };
  ruleIds: Record<"repricedClean" | "insuranceTying" | "insuranceIndependent" | "legalInsuranceTying", string>;
  citations: Record<"repricedClean" | "insuranceTying" | "insuranceIndependent", string>;
}

const assertPolicyDocument = (name: string, value: unknown): void => {
  if (!value || typeof value !== "object") throw new Error(`${name} is missing or invalid; decision engine is disabled.`);
  const document = value as Record<string, unknown>;
  if (typeof document.version !== "string" || !document.version.trim()) throw new Error(`${name}.version is required; decision engine is disabled.`);
};

const assertRate = (path: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${path} must be between 0 and 1; decision engine is disabled.`);
};

assertPolicyDocument("decision-policy", decisionPolicyJson);
assertPolicyDocument("routing-catalog", routingCatalogJson);
assertPolicyDocument("product-catalog", productCatalogJson);
assertPolicyDocument("agent-contracts", agentContractsJson);

const parsedDecisionPolicy = decisionPolicyJson as DecisionPolicy;
[
  ["credit.stressAnnualRate", parsedDecisionPolicy.credit.stressAnnualRate],
  ["credit.creditLimitReductionFactor", parsedDecisionPolicy.credit.creditLimitReductionFactor],
  ["credit.creditCardMonthlyObligationRate", parsedDecisionPolicy.credit.creditCardMonthlyObligationRate],
  ["profitability.fundingCostRate", parsedDecisionPolicy.profitability.fundingCostRate],
  ["profitability.expectedLossRate", parsedDecisionPolicy.profitability.expectedLossRate],
  ["uncertainty.minimumConfidenceScore", parsedDecisionPolicy.uncertainty.minimumConfidenceScore],
].forEach(([path, value]) => assertRate(String(path), Number(value)));

if (parsedDecisionPolicy.routing.minimumPromptCharacters >= parsedDecisionPolicy.routing.maximumPromptCharacters) {
  throw new Error("Routing prompt bounds are invalid; decision engine is disabled.");
}
if (new Set((productCatalogJson as ProductCatalog).products.map(product => product.productId)).size !== (productCatalogJson as ProductCatalog).products.length) {
  throw new Error("Product IDs must be unique; decision engine is disabled.");
}

export const decisionPolicy = Object.freeze(parsedDecisionPolicy);
export const routingCatalog = Object.freeze(routingCatalogJson as RoutingCatalog);
export const productCatalog = Object.freeze(productCatalogJson as ProductCatalog);
export const agentContracts = Object.freeze((agentContractsJson as { contracts: AgentContract[] }).contracts);
export const policyMetadata = Object.freeze({
  decisionPolicy: { id: decisionPolicy.policyId, version: decisionPolicy.version, effectiveFrom: decisionPolicy.effectiveFrom },
  routingCatalog: { id: routingCatalog.catalogId, version: routingCatalog.version },
  productCatalog: { id: productCatalog.catalogId, version: productCatalog.version },
  agentContracts: { id: agentContractsJson.catalogId, version: agentContractsJson.version },
});
