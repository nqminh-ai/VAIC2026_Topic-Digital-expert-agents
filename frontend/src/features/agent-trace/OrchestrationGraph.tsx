import { useMemo } from "react";
import { ReactFlow, Background, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Card } from "../../components/Card";
import { AgentNode, type AgentFlowNode, type GraphNodeStatus } from "./AgentNode";
import { useOrchestrationStore, type PipelineStep } from "../../store/orchestrationStore";
import type { StepKey } from "../../utils/parseAgentState";
import styles from "./OrchestrationGraph.module.css";

// Static positions mirroring the real topology in
// backend/src/services/orchestration/orchestration-graph.ts — this is not a decorative
// diagram, it's the actual compiled StateGraph (classify -> profile -> product -> fast/complex
// split -> ... -> operations), so the highlighted path always matches what really ran.
const NODE_LAYOUT: { id: string; stepKey?: StepKey; label: string; x: number; y: number }[] = [
  { id: "classify", stepKey: "planner", label: "Planner (classify)", x: 300, y: 0 },
  { id: "profile", stepKey: "profile", label: "Customer Profile", x: 300, y: 80 },
  { id: "product", stepKey: "product", label: "Product & Policy", x: 300, y: 160 },
  { id: "markFastPass", label: "Fast Pass", x: 80, y: 260 },
  { id: "credit", stepKey: "credit", label: "Credit Risk", x: 500, y: 260 },
  { id: "legal", stepKey: "legal", label: "Legal & Compliance", x: 500, y: 340 },
  { id: "selfCorrection", stepKey: "self-correction", label: "Self-Correction Loop", x: 700, y: 420 },
  { id: "legalAudit", stepKey: "legal_audit", label: "Legal Audit", x: 500, y: 420 },
  { id: "risk", stepKey: "risk", label: "Risk Consolidation", x: 500, y: 500 },
  { id: "operations", stepKey: "operations", label: "Operations", x: 300, y: 580 },
];

const findStep = (steps: PipelineStep[], key?: StepKey) => (key ? steps.find(s => s.key === key) : undefined);

export const OrchestrationGraph = () => {
  const steps = useOrchestrationStore(s => s.steps);
  const riskTier = useOrchestrationStore(s => s.riskTier);
  const phase = useOrchestrationStore(s => s.phase);

  const hasSelfCorrection = steps.some(s => s.key === "self-correction");
  const opsStep = findStep(steps, "operations");
  const productStep = findStep(steps, "product");

  const nodes: AgentFlowNode[] = useMemo(() => {
    return NODE_LAYOUT.filter(n => n.id !== "selfCorrection" || hasSelfCorrection).map(n => {
      let status: GraphNodeStatus;
      if (n.id === "markFastPass") {
        if (riskTier === "COMPLEX") status = "inactive";
        else if (riskTier === undefined) status = phase === "idle" ? "inactive" : "pending";
        else if (opsStep && opsStep.status !== "pending") status = "done";
        else if (productStep?.status === "done") status = "in_progress";
        else status = "pending";
      } else if (["credit", "legal", "risk", "selfCorrection", "legalAudit"].includes(n.id) && riskTier === "FAST") {
        status = "inactive";
      } else {
        const step = findStep(steps, n.stepKey);
        if (!step) status = phase === "idle" ? "inactive" : "pending";
        else if (step.status === "skipped") status = "inactive";
        else status = step.status === "pending" ? "pending" : step.status === "in_progress" ? "in_progress" : "done";
      }

      return {
        id: n.id,
        type: "agentNode",
        position: { x: n.x, y: n.y },
        data: { label: n.label, status },
        draggable: false,
        selectable: false,
      };
    });
  }, [steps, riskTier, phase, opsStep, productStep, hasSelfCorrection]);

  const edges: Edge[] = useMemo(() => {
    const base: Edge[] = [
      { id: "e-classify-profile", source: "classify", target: "profile" },
      { id: "e-profile-product", source: "profile", target: "product" },
      { id: "e-product-fast", source: "product", target: "markFastPass" },
      { id: "e-product-credit", source: "product", target: "credit" },
      { id: "e-fast-ops", source: "markFastPass", target: "operations" },
      { id: "e-credit-legal", source: "credit", target: "legal" },
      { id: "e-legalaudit-risk", source: "legalAudit", target: "risk" },
      { id: "e-risk-ops", source: "risk", target: "operations" },
    ];

    if (hasSelfCorrection) {
      base.push(
        { id: "e-legal-selfcorrection", source: "legal", target: "selfCorrection" },
        { id: "e-selfcorrection-legalaudit", source: "selfCorrection", target: "legalAudit" }
      );
    } else {
      base.push({ id: "e-legal-legalaudit", source: "legal", target: "legalAudit" });
    }

    return base.map(edge => ({
      ...edge,
      animated: nodes.find(n => n.id === edge.source)?.data.status === "in_progress",
      style: { stroke: "var(--color-border)", strokeWidth: 1.5 },
    }));
  }, [hasSelfCorrection, nodes]);

  return (
    <Card title="Sơ đồ điều phối (LangGraph StateGraph)">
      <div className={styles.canvas}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={{ agentNode: AgentNode }}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={true}
          zoomOnScroll={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
        </ReactFlow>
      </div>
    </Card>
  );
};
