import { AgentTrace } from "../../types/trace.types";
import { OrchestrationResponse } from "../../types/orchestration.types";

// In-memory store for the MVP mock phase
const orchestrationStore: Record<string, OrchestrationResponse> = {};

export const saveOrchestrationRun = (runId: string, data: OrchestrationResponse) => {
  orchestrationStore[runId] = data;
};

export const getOrchestrationRun = (runId: string): OrchestrationResponse | null => {
  return orchestrationStore[runId] || null;
};
