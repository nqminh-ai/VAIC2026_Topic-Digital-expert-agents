import { apiClient } from "./client";
import { OrchestrationResponse } from "../types/orchestration.types";

export const triggerOrchestration = async (prompt: string): Promise<OrchestrationResponse> => {
  return apiClient<OrchestrationResponse>("/api/orchestrate", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
};

export const fetchRunTraces = async (runId: string): Promise<OrchestrationResponse> => {
  return apiClient<OrchestrationResponse>(`/api/orchestrate/${runId}/traces`);
};
