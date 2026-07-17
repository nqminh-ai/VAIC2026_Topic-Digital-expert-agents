import { AgentTrace } from "../../types/trace.types";
import { queryCreditPolicies } from "../rag/credit-rag.service";
import { checkCreditScore } from "../tools/credit-score.tool";

export const runCreditAgent = async (
  runId: string, 
  prompt: string
): Promise<AgentTrace> => {
  const startedAt = new Date().toISOString();
  
  // 1. RAG query
  await queryCreditPolicies(prompt);

  // 2. Tool call
  const scoreResult = await checkCreditScore("CUST-12345");

  return {
    id: `trace-credit-${Date.now()}`,
    runId,
    agent: "credit",
    task: "Assess credit risk and evaluate score",
    status: "completed",
    summary: "Credit score retrieved and evaluated against policies. Customer is eligible for standard rates.",
    toolCalls: [{
      toolName: "checkCreditScore",
      input: { customerId: "CUST-12345" },
      output: scoreResult,
      status: "success"
    }],
    startedAt,
    completedAt: new Date().toISOString()
  };
};
