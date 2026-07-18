import { Response } from "express";
import { executeOrchestration, streamOrchestration } from "../services/orchestration/planner.service";
import { getOrchestrationRun } from "../services/orchestration/trace.service";
import { OrchestrationRequest, OrchestrationStreamEvent } from "../types/orchestration.types";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { AGENT_CONTRACTS } from "../services/orchestration/agent-role-registry";
import { OrchestrationInputError } from "../services/orchestration/input-router.service";
import { toPublicOrchestrationError } from "../services/orchestration/orchestration-error.service";

export const orchestratePrompt = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { prompt, approvalToken, caseId } = req.body as OrchestrationRequest;
    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "Prompt is required" });
    }
    // req.user is guaranteed by the requireAuth middleware mounted on this route.
    const requestedBy = req.user!.sub;

    const result = await executeOrchestration(prompt, requestedBy, approvalToken, caseId, req.user!.tenantId);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof OrchestrationInputError) {
      return res.status(422).json({ error: error.message, code: error.code, questions: error.questions });
    }
    console.error("Orchestration error:", error);
    const publicError = toPublicOrchestrationError(error);
    return res.status(publicError.httpStatus).json({ error: publicError.message, code: publicError.code });
  }
};

/**
 * NDJSON (newline-delimited JSON) streaming variant: one OrchestrationStreamEvent per
 * line, flushed as each pipeline stage completes. Chosen over SSE/EventSource because
 * this is a POST carrying an Authorization header, which EventSource cannot send.
 */
export const orchestratePromptStream = async (req: AuthenticatedRequest, res: Response) => {
  const { prompt, approvalToken, caseId } = req.body as OrchestrationRequest;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "Prompt is required" });
  }
  const requestedBy = req.user!.sub;

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  const writeEvent = (event: OrchestrationStreamEvent) => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    await streamOrchestration(prompt, requestedBy, approvalToken, writeEvent, caseId, req.user!.tenantId);
  } catch (error) {
    if (error instanceof OrchestrationInputError) {
      writeEvent({ type: "error", message: error.message, code: error.code, questions: error.questions });
    } else {
      console.error("Orchestration stream error:", error);
      const publicError = toPublicOrchestrationError(error);
      writeEvent({ type: "error", message: publicError.message, code: publicError.code });
    }
  } finally {
    res.end();
  }
};

export const getRunTraces = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { runId } = req.params;
    const run = await getOrchestrationRun(runId, req.user!.tenantId);
    
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    return res.status(200).json(run);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error fetching traces" });
  }
};

export const getAgentContracts = async (_req: AuthenticatedRequest, res: Response) =>
  res.status(200).json({ agents: AGENT_CONTRACTS });
