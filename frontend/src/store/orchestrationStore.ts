import { create } from "zustand";
import type { AgentRole, AgentTrace, OrchestrationResponse, OrchestrationStreamEvent, RiskTier } from "../types/api";
import { deriveStepKey, stepTemplateForRiskTier, STEP_AGENT, STEP_LABELS, type StepKey } from "../utils/parseAgentState";

export type StepStatus = "pending" | "in_progress" | "done" | "skipped";

export interface PipelineStep {
  key: StepKey;
  label: string;
  agent: AgentRole;
  status: StepStatus;
  trace?: AgentTrace;
}

export type RunPhase = "idle" | "running" | "done" | "error";

export interface RunMetrics {
  runId: string;
  prompt: string;
  durationMs: number;
  agentStepCount: number;
  toolCallCount: number;
  modelCallsUsed: number;
  finalAnswer: string;
  completedAt: number;
}

interface OrchestrationStoreState {
  phase: RunPhase;
  prompt: string;
  runId?: string;
  riskTier?: RiskTier;
  startedAt?: number;
  steps: PipelineStep[];
  response?: OrchestrationResponse;
  advisoryMode?: "ADVISORY_QA" | "OUT_OF_DOMAIN";
  advisoryFinalAnswer?: string;
  error?: string;
  history: RunMetrics[];

  startRun: (prompt: string) => void;
  applyStreamEvent: (event: OrchestrationStreamEvent) => void;
  fail: (message: string) => void;
  reset: () => void;
}

const buildStep = (key: StepKey, status: StepStatus): PipelineStep => ({
  key,
  label: STEP_LABELS[key],
  agent: STEP_AGENT[key],
  status,
});

export const useOrchestrationStore = create<OrchestrationStoreState>()((set, get) => ({
  phase: "idle",
  prompt: "",
  steps: [],
  history: [],

  startRun: prompt =>
    set({
      phase: "running",
      prompt,
      runId: undefined,
      riskTier: undefined,
      startedAt: Date.now(),
      steps: [],
      response: undefined,
      advisoryMode: undefined,
      advisoryFinalAnswer: undefined,
      error: undefined,
    }),

  applyStreamEvent: event => {
    const state = get();

    if (event.type === "node_update") {
      let steps = state.steps;
      const riskTier = state.riskTier ?? event.riskTier;
      if (steps.length === 0) {
        steps = stepTemplateForRiskTier(riskTier).map((key, idx) => buildStep(key, idx === 0 ? "in_progress" : "pending"));
      }

      const stepKey = deriveStepKey(event.trace);
      let idx = steps.findIndex(s => s.key === stepKey);
      if (idx === -1) {
        // Self-correction re-pricing loop isn't in the static template — splice it in right after "legal".
        const legalIdx = steps.findIndex(s => s.key === "legal");
        const insertAt = legalIdx === -1 ? steps.length : legalIdx + 1;
        steps = [...steps.slice(0, insertAt), buildStep(stepKey, "pending"), ...steps.slice(insertAt)];
        idx = insertAt;
      }

      // The only path that stops the graph before the last template step is the
      // prompt-injection block at the very first (classify/planner) node — every other
      // agent status (blocked/failed included) still hands off to the next real stage.
      const isTerminalBlock = idx === 0 && stepKey === "planner" && event.trace.status !== "completed";

      steps = steps.map((s, i) => {
        if (i === idx) return { ...s, status: "done", trace: event.trace };
        if (!isTerminalBlock && i === idx + 1 && s.status === "pending") return { ...s, status: "in_progress" };
        return s;
      });

      set({ steps, runId: state.runId ?? event.trace.runId, riskTier });
      return;
    }

    if (event.type === "final") {
      const steps = state.steps.map(s => (s.status === "pending" || s.status === "in_progress" ? { ...s, status: "skipped" as StepStatus } : s));
      const completedAt = Date.now();
      const durationMs = state.startedAt ? completedAt - state.startedAt : 0;
      const toolCallCount = event.response.traces.reduce((sum, t) => sum + t.toolCalls.length, 0);

      const metrics: RunMetrics = {
        runId: event.response.runId,
        prompt: state.prompt,
        durationMs,
        agentStepCount: event.response.traces.length,
        toolCallCount,
        modelCallsUsed: event.response.budgetStatus?.modelCallsUsed ?? 0,
        finalAnswer: event.response.finalAnswer,
        completedAt,
      };

      set({
        phase: "done",
        steps,
        response: event.response,
        history: [metrics, ...state.history].slice(0, 20),
      });
      return;
    }

    if (event.type === "advisory_final") {
      // No LangGraph run happened — build the fixed template directly with "planner"
      // done and every other stage skipped, instead of replaying node_update events
      // for a pipeline that never executed.
      const template = stepTemplateForRiskTier(state.riskTier);
      const steps = template.map((key, idx) =>
        idx === 0 ? { ...buildStep(key, "done" as StepStatus), trace: event.response.plannerTrace } : buildStep(key, "skipped" as StepStatus)
      );
      const completedAt = Date.now();
      const durationMs = state.startedAt ? completedAt - state.startedAt : 0;

      const metrics: RunMetrics = {
        runId: event.response.runId,
        prompt: state.prompt,
        durationMs,
        agentStepCount: 1,
        toolCallCount: event.response.plannerTrace.toolCalls.length,
        modelCallsUsed: event.response.plannerTrace.toolCalls.length > 0 ? 1 : 0,
        finalAnswer: event.response.finalAnswer,
        completedAt,
      };

      set({
        phase: "done",
        steps,
        runId: event.response.runId,
        advisoryMode: event.response.mode,
        advisoryFinalAnswer: event.response.finalAnswer,
        history: [metrics, ...state.history].slice(0, 20),
      });
      return;
    }

    // event.type === "error"
    set({ phase: "error", error: event.message });
  },

  fail: message => set({ phase: "error", error: message }),

  reset: () =>
    set({
      phase: "idle",
      prompt: "",
      runId: undefined,
      riskTier: undefined,
      steps: [],
      response: undefined,
      advisoryMode: undefined,
      advisoryFinalAnswer: undefined,
      error: undefined,
    }),
}));
