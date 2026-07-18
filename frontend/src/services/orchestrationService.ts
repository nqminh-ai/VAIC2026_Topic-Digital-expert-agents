import { apiFetch, apiFetchStream } from "./httpClient";
import type { OrchestrationResponse, OrchestrationStreamEvent } from "../types/api";

/**
 * Consumes the backend's NDJSON stream (one OrchestrationStreamEvent per line) and invokes
 * onEvent as each line arrives, so the UI can render agent progress live instead of waiting
 * for the whole pipeline to finish. Not SSE/EventSource because this is a POST carrying an
 * Authorization header, which EventSource cannot send.
 */
export const streamOrchestration = async (
  prompt: string,
  token: string,
  approvalToken: string | undefined,
  onEvent: (event: OrchestrationStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> => {
  const response = await apiFetchStream("/api/orchestrate/stream", { prompt, approvalToken }, token);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }

    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as OrchestrationStreamEvent);
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as OrchestrationStreamEvent);
  }
};

export const getRunTraces = (runId: string, token: string): Promise<OrchestrationResponse> =>
  apiFetch<OrchestrationResponse>(`/api/orchestrate/${runId}/traces`, { token });

export interface SavedRunResult { saved: true; runId: string; dossier: { dossierId: string; status: string; caseId: string | null } }

export const saveRun = (runId: string, token: string): Promise<SavedRunResult> =>
  apiFetch<SavedRunResult>(`/api/runs/${runId}/save`, { method: "POST", token });
