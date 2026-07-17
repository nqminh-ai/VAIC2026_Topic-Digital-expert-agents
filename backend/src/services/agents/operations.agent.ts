import { AgentTrace } from "../../types/trace.types";
import { createApprovalTicket } from "../tools/approval-ticket.tool";

export const runOperationsAgent = async (
  runId: string,
  legalTrace: AgentTrace
): Promise<{ trace: AgentTrace; ticketId?: string }> => {
  const startedAt = new Date().toISOString();

  if (legalTrace.summary.includes("rejected")) {
    return {
      trace: {
        id: `trace-ops-${Date.now()}`,
        runId,
        agent: "operations",
        task: "Process final request",
        status: "completed",
        summary: "Process halted due to compliance rejection.",
        toolCalls: [],
        startedAt,
        completedAt: new Date().toISOString()
      }
    };
  }

  // 1. Tool call to create ticket
  const ticketResult = await createApprovalTicket({ runId, context: "Auto-approved by Legal Agent" });

  return {
    trace: {
      id: `trace-ops-${Date.now()}`,
      runId,
      agent: "operations",
      task: "Process final request and create ticket",
      status: "completed",
      summary: `Ticket created successfully. Operations flow completed.`,
      toolCalls: [{
        toolName: "createApprovalTicket",
        input: { runId, context: "Auto-approved by Legal Agent" },
        output: ticketResult,
        status: "success"
      }],
      startedAt,
      completedAt: new Date().toISOString()
    },
    ticketId: ticketResult.ticketId as string
  };
};
