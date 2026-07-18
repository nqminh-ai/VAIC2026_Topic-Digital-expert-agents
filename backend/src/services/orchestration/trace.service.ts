import { OrchestrationResponse } from "../../types/orchestration.types";
import { pgPool, pgQuery } from "../../config/pg";
import { assertJsonEquivalent } from "../data/data-integrity.service";

interface OrchestrationRunMetadata {
  caseId?: string;
  prompt?: string;
  status?: string;
  tenantId?: string;
  workflowId?: string;
  workflowVersion?: string;
  configVersion?: string;
}

// Hot cache only; Postgres remains the durable source of truth.
const orchestrationStore: Record<string, OrchestrationResponse> = {};

const validateStoredResponse = (runId: string, value: unknown): OrchestrationResponse => {
  if (!value || typeof value !== "object") throw new Error(`Run ${runId} has an invalid response payload.`);
  const response = value as OrchestrationResponse;
  if (response.runId !== runId || typeof response.finalAnswer !== "string" || !Array.isArray(response.traces)) {
    throw new Error(`Run ${runId} failed response payload validation.`);
  }
  return response;
};

export const saveOrchestrationRun = async (
  runId: string,
  data: OrchestrationResponse,
  metadata: OrchestrationRunMetadata = {}
): Promise<void> => {
  validateStoredResponse(runId, data);
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ response_payload: unknown }>(
      `INSERT INTO orchestration_runs (run_id, case_id, prompt, status, response_payload, tenant_id, workflow_id, workflow_version, config_version)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
       ON CONFLICT (run_id) DO UPDATE SET
         case_id = EXCLUDED.case_id,
         prompt = EXCLUDED.prompt,
         status = EXCLUDED.status,
         response_payload = EXCLUDED.response_payload,
         tenant_id = EXCLUDED.tenant_id,
         workflow_id = EXCLUDED.workflow_id,
         workflow_version = EXCLUDED.workflow_version,
         config_version = EXCLUDED.config_version
       WHERE orchestration_runs.tenant_id = EXCLUDED.tenant_id
       RETURNING response_payload`,
      [
        runId,
        metadata.caseId ?? null,
        metadata.prompt ?? null,
        metadata.status ?? "COMPLETED",
        JSON.stringify(data),
        metadata.tenantId ?? "bank-default",
        metadata.workflowId ?? "loan-pre-approval",
        metadata.workflowVersion ?? "1.0.0",
        metadata.configVersion ?? "1.0.0",
      ]
    );
    if (result.rowCount !== 1 || !result.rows[0]) {
      throw new Error(`Database did not confirm exactly one orchestration run for ${runId}.`);
    }
    const persisted = validateStoredResponse(runId, result.rows[0].response_payload);
    assertJsonEquivalent(data, persisted, `Orchestration run ${runId}`);
    await client.query("COMMIT");
    orchestrationStore[runId] = persisted;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.warn("Orchestration run rollback failed; connection may already be closed:", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
};

export const getOrchestrationRun = async (runId: string, tenantId?: string): Promise<OrchestrationResponse | null> => {
  if (!tenantId && orchestrationStore[runId]) return orchestrationStore[runId];

  const result = await pgQuery(
    "SELECT response_payload FROM orchestration_runs WHERE run_id = $1 AND ($2::text IS NULL OR tenant_id = $2)",
    [runId, tenantId ?? null]
  );
  const payload = (result.rows[0] as { response_payload: unknown } | undefined)?.response_payload;
  if (!payload) return null;

  const response = validateStoredResponse(runId, payload);
  orchestrationStore[runId] = response;
  return response;
};
