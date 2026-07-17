import { Request, Response } from "express";
import { executeMockOrchestration } from "../services/orchestration/planner.service";
import { getOrchestrationRun } from "../services/orchestration/trace.service";
import { OrchestrationRequest } from "../types/orchestration.types";

export const orchestratePrompt = async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body as OrchestrationRequest;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const result = await executeMockOrchestration(prompt);
    return res.status(200).json(result);
  } catch (error) {
    console.error("Orchestration error:", error);
    return res.status(500).json({ error: "Internal server error during orchestration" });
  }
};

export const getRunTraces = async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;
    const run = getOrchestrationRun(runId);
    
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    return res.status(200).json(run);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error fetching traces" });
  }
};
