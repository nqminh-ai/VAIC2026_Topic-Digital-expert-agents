import { AgentTrace } from "../../types/trace.types";
import { ProductOption, PricingOffer, DecisionEnvelope } from "../../types/agent.types";
import { loadRetailCase } from "../data/retail-case-loader";
import { productCatalog } from "../../config/policy";

export const runProductPolicyAgent = async (
  runId: string,
  caseId: string,
  isReprice: boolean = false
): Promise<AgentTrace> => {
  const startedAt = new Date().toISOString();

  const retailCase = await loadRetailCase(caseId);

  if (!retailCase) {
    return {
      id: `trace-product-${Date.now()}`,
      runId,
      agent: "product",
      task: "Retrieve product policies and match eligibility",
      status: "failed",
      summary: "Case data not found.",
      toolCalls: [],
      startedAt,
      completedAt: new Date().toISOString()
    };
  }

  // Match eligible products
  const homeLoanProduct = productCatalog.products.find(product => product.productId === productCatalog.primaryProductId);
  if (!homeLoanProduct) {
    return {
      id: `trace-product-${Date.now()}`,
      runId,
      agent: "product",
      task: "Retrieve product policies and match eligibility",
      status: "failed",
      summary: `Primary product ${productCatalog.primaryProductId} is missing from catalog ${productCatalog.catalogId}@${productCatalog.version}.`,
      toolCalls: [],
      startedAt,
      completedAt: new Date().toISOString()
    };
  }

  const eligibleProducts: ProductOption[] = [homeLoanProduct];

  if (retailCase.refinanceAutoLoan) {
    const refinanceProduct = productCatalog.products.find(product => product.productId === productCatalog.eligibility.autoRefinanceProductId);
    if (refinanceProduct) eligibleProducts.push(refinanceProduct);
  }

  // Build pricing offer with the initial "trap"
  let appliedRate = homeLoanProduct.baseRate; // 8.3%
  let insuranceTyingApplied = false;
  let note = "";
  const findings: DecisionEnvelope[] = [];

  if (isReprice) {
    // Re-priced scenario: preferential rate 7.5% for all, no tying
    appliedRate = homeLoanProduct.preferentialRate;
    insuranceTyingApplied = false;
    note = "Ưu đãi lãi suất 7.5% được áp dụng vô điều kiện (Bảo hiểm không bắt buộc).";
    
    findings.push({
      decisionId: `dec-product-reprice-${Date.now()}`,
      agent: "product",
      status: "PASS",
      severity: "INFO",
      blocksAt: "NONE",
      finding: "Đã tái lập định giá khoản vay: Lãi suất 7.5% không đi kèm điều kiện mua bảo hiểm.",
      evidence: { appliedRate, insuranceTyingApplied },
      ruleIds: [productCatalog.ruleIds.repricedClean],
      citations: [productCatalog.citations.repricedClean]
    });
  } else {
    // Normal offers never use optional insurance as a pricing or eligibility input.
    appliedRate = homeLoanProduct.baseRate;
    insuranceTyingApplied = false;
    note = "Bảo hiểm là sản phẩm tuỳ chọn và không ảnh hưởng tới lãi suất hoặc quyết định tín dụng.";
    findings.push({
      decisionId: `dec-product-clean-${Date.now()}`,
      agent: "product",
      status: "PASS",
      severity: "INFO",
      blocksAt: "NONE",
      finding: "Định giá độc lập với quyết định mua bảo hiểm.",
      evidence: { appliedRate, insuranceTyingApplied },
      ruleIds: [productCatalog.ruleIds.insuranceIndependent],
      citations: [productCatalog.citations.insuranceIndependent]
    });
  }

  // Monthly payment estimate
  const monthlyPaymentEstimate = Math.round(
    (retailCase.requestedLoan.amount * (appliedRate / 12)) /
      (1 - Math.pow(1 + appliedRate / 12, -(retailCase.requestedLoan.tenureYears * 12)))
  );

  const pricingOffer: PricingOffer = {
    selectedProduct: homeLoanProduct,
    appliedRate,
    monthlyPaymentEstimate,
    insuranceTyingApplied,
    note
  };

  const summary = `Đã đối chiếu chính sách sản phẩm. Tìm thấy ${eligibleProducts.length} sản phẩm phù hợp. Đề xuất gói định giá mua nhà: Lãi suất ${(appliedRate * 100).toFixed(1)}%/năm, ước tính trả gốc lãi hàng tháng: ${monthlyPaymentEstimate.toLocaleString()} VND. ${note}`;

  const traceResult: AgentTrace = {
    id: `trace-product-${Date.now()}`,
    runId,
    agent: "product",
    task: "Retrieve product policies and match eligibility",
    status: "completed",
    summary,
    toolCalls: [
      {
        toolName: "matchEligibleProducts",
        input: { customerSegment: "retail", requestedLoan: retailCase.requestedLoan },
        output: { eligibleProducts },
        status: "success"
      },
      {
        toolName: "buildPricingOffer",
        input: { options: eligibleProducts, insurancePreference: retailCase.insurancePreference, isReprice },
        output: pricingOffer as unknown as Record<string, unknown>,
        status: "success"
      }
    ],
    findings,
    startedAt,
    completedAt: new Date().toISOString()
  };

  return traceResult;
};
