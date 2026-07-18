import { z } from "zod";
import { RetailCase } from "../../types/case.types";

const nonEmptyText = z.string().trim().min(1);
const money = z.number().finite().nonnegative();

const retailCaseSchema = z.object({
  caseId: nonEmptyText.max(50),
  customerId: nonEmptyText.max(50),
  demographic: z.object({
    name: nonEmptyText.max(200),
    age: z.number().int().min(18).max(120),
    maritalStatus: z.enum(["single", "married"]),
    cccd: nonEmptyText.max(30),
    phone: nonEmptyText.max(30),
    email: nonEmptyText.max(320),
  }).strict(),
  incomeSources: z.array(z.object({
    type: z.enum(["salary", "freelance", "rental"]),
    amount: money.positive(),
    evidence: nonEmptyText,
  }).strict()).min(1),
  currentDebts: z.array(z.object({
    type: z.enum(["auto", "credit_card", "other"]),
    monthlyOwed: money,
    outstandingAmount: money,
    limit: money.optional(),
    evidence: nonEmptyText,
  }).strict()),
  requestedLoan: z.object({
    type: z.enum(["mortgage", "refinance"]),
    amount: money.positive(),
    tenureYears: z.number().int().positive().max(50),
  }).strict(),
  property: z.object({
    type: z.enum(["apartment", "land", "house"]),
    value: money.positive(),
    status: z.enum(["completed", "future_project"]),
    projectCode: nonEmptyText.max(100).optional(),
    evidence: nonEmptyText,
  }).strict(),
  properties: z.array(z.object({
    type: z.enum(["apartment", "land", "house"]),
    value: money.positive(),
    status: z.enum(["completed", "future_project"]),
    projectCode: nonEmptyText.max(100).optional(),
    evidence: nonEmptyText,
  }).strict()).optional(),
  refinanceAutoLoan: z.object({
    remainingPrincipal: money,
    monthlyPayment: money,
  }).strict().optional(),
  consent: z.object({
    credit_check: z.boolean(),
    tax_income_check: z.boolean(),
    social_insurance_check: z.boolean(),
    marketing: z.boolean(),
  }).strict(),
  insurancePreference: z.enum(["accepted", "declined"]),
  additionalContext: z.string().trim().optional(),
}).strict();

const formatIssues = (issues: z.core.$ZodIssue[]): string =>
  issues.map(issue => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");

/** Runtime validation is required because database JSONB and LLM output bypass TypeScript. */
export const validateRetailCase = (value: unknown): RetailCase => {
  const parsed = retailCaseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`RetailCase validation failed: ${formatIssues(parsed.error.issues)}`);
  }
  return parsed.data as RetailCase;
};

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)])
    );
  }
  return value;
};

export const canonicalJson = (value: unknown): string => {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("Cannot canonicalize an undefined value.");
  return JSON.stringify(sortJson(JSON.parse(json)));
};

export const assertJsonEquivalent = (expected: unknown, actual: unknown, label: string): void => {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(`${label} read-back verification failed: persisted JSON differs from the validated input.`);
  }
};

export const assertPersistedRetailCase = (expected: RetailCase, actual: unknown): RetailCase => {
  const validatedActual = validateRetailCase(actual);
  if (validatedActual.caseId !== expected.caseId || validatedActual.customerId !== expected.customerId) {
    throw new Error(`RetailCase identity mismatch for case ${expected.caseId}.`);
  }
  assertJsonEquivalent(expected, validatedActual, `RetailCase ${expected.caseId}`);
  return validatedActual;
};
