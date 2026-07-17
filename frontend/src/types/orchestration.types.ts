import { AgentTrace } from "./trace.types";

export interface OrchestrationRequest {
  prompt: string;
}

export interface OrchestrationResponse {
  runId: string;
  finalAnswer: string;
  traces: AgentTrace[];
  approvalTicketId?: string;
}
