export interface IncomeSource {
  type: "salary" | "freelance" | "rental";
  amount: number; // in VND
  evidence: string;
}

export interface Debt {
  type: "auto" | "credit_card" | "other";
  monthlyOwed: number; // in VND
  outstandingAmount: number; // in VND
  limit?: number; // credit card limit
  evidence: string;
}

export interface RequestedLoan {
  type: "mortgage" | "refinance";
  amount: number; // in VND
  tenureYears: number;
}

export interface PropertyInfo {
  type: "apartment" | "land" | "house";
  value: number; // in VND
  status: "completed" | "future_project";
  projectCode?: string;
  evidence: string;
}

export interface ConsentRegistry {
  credit_check: boolean;
  tax_income_check: boolean;
  social_insurance_check: boolean;
  marketing: boolean;
}

export interface RetailCase {
  caseId: string;
  customerId: string;
  demographic: {
    name: string;
    age: number;
    maritalStatus: "single" | "married";
    cccd: string;
    phone: string;
    email: string;
  };
  incomeSources: IncomeSource[];
  currentDebts: Debt[];
  requestedLoan: RequestedLoan;
  property: PropertyInfo;
  properties?: PropertyInfo[];
  refinanceAutoLoan?: {
    remainingPrincipal: number;
    monthlyPayment: number;
  };
  consent: ConsentRegistry;
  insurancePreference: "accepted" | "declined";
  additionalContext?: string;
}
