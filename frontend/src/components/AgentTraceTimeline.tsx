import React from "react";
import { AgentTrace } from "../types/trace.types";
import { ToolCallTable } from "./ToolCallTable";

interface AgentTraceTimelineProps {
  traces: AgentTrace[];
}

const AGENT_COLORS = {
  planner: { text: "#3B82F6", bg: "rgba(59, 130, 246, 0.1)", icon: "🎯", label: "Planner Agent" },
  credit: { text: "#F59E0B", bg: "rgba(245, 158, 11, 0.1)", icon: "💳", label: "Credit Specialist" },
  legal: { text: "#10B981", bg: "rgba(16, 185, 129, 0.1)", icon: "⚖️", label: "Legal & Compliance" },
  operations: { text: "#EF4444", bg: "rgba(239, 68, 68, 0.1)", icon: "⚙️", label: "Operations Specialist" },
};

export const AgentTraceTimeline: React.FC<AgentTraceTimelineProps> = ({ traces }) => {
  if (traces.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", position: "relative" }}>
      {/* Timeline track line */}
      <div
        style={{
          position: "absolute",
          left: "23px",
          top: "16px",
          bottom: "16px",
          width: "2px",
          backgroundColor: "rgba(255, 255, 255, 0.05)",
          zIndex: 0,
        }}
      />

      {traces.map((trace) => {
        const styleInfo = AGENT_COLORS[trace.agent] || {
          text: "#9CA3AF",
          bg: "rgba(156, 163, 175, 0.1)",
          icon: "🤖",
          label: trace.agent,
        };

        return (
          <div key={trace.id} style={{ display: "flex", gap: "16px", zIndex: 1 }}>
            {/* Circle Node */}
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                backgroundColor: styleInfo.bg,
                border: `2px solid ${styleInfo.text}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.3rem",
                flexShrink: 0,
                boxShadow: `0 0 10px ${styleInfo.bg}`,
              }}
            >
              {styleInfo.icon}
            </div>

            {/* Content card */}
            <div
              className="glass"
              style={{
                flexGrow: 1,
                padding: "16px",
                borderLeft: `4px solid ${styleInfo.text}`,
                backgroundColor: "rgba(22, 28, 45, 0.2)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "8px",
                  marginBottom: "8px",
                }}
              >
                <div>
                  <h4 style={{ color: styleInfo.text, display: "inline-block", marginRight: "8px" }}>
                    {styleInfo.label}
                  </h4>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {new Date(trace.startedAt).toLocaleTimeString()}
                  </span>
                </div>

                <span
                  style={{
                    fontSize: "0.75rem",
                    padding: "3px 8px",
                    borderRadius: "12px",
                    backgroundColor: "rgba(16, 185, 129, 0.1)",
                    color: "var(--accent-green)",
                    fontWeight: "600",
                  }}
                >
                  {trace.status.toUpperCase()}
                </span>
              </div>

              <p style={{ fontSize: "0.95rem", color: "var(--text-primary)", fontWeight: "500" }}>
                Task: {trace.task}
              </p>
              <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginTop: "6px" }}>
                {trace.summary}
              </p>

              <ToolCallTable toolCalls={trace.toolCalls} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
