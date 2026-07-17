import React from "react";
import { ToolCallTrace } from "../types/trace.types";

interface ToolCallTableProps {
  toolCalls: ToolCallTrace[];
}

export const ToolCallTable: React.FC<ToolCallTableProps> = ({ toolCalls }) => {
  if (toolCalls.length === 0) return null;

  return (
    <div style={{ marginTop: "12px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "12px" }}>
      <p style={{ fontSize: "0.85rem", fontWeight: "600", color: "var(--accent-gold)", marginBottom: "8px" }}>
        🛠️ Tool Executions:
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {toolCalls.map((call, idx) => (
          <div
            key={idx}
            style={{
              padding: "10px",
              borderRadius: "6px",
              backgroundColor: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", color: "var(--accent-blue)" }}>
                {call.toolName}()
              </span>
              <span
                style={{
                  fontSize: "0.75rem",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  backgroundColor: call.status === "success" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                  color: call.status === "success" ? "var(--accent-green)" : "var(--accent-red)",
                }}
              >
                {call.status}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "0.75rem" }}>
              <div>
                <span style={{ color: "var(--text-secondary)" }}>Input:</span>
                <pre
                  style={{
                    backgroundColor: "rgba(0,0,0,0.5)",
                    padding: "6px",
                    borderRadius: "4px",
                    overflowX: "auto",
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {JSON.stringify(call.input, null, 2)}
                </pre>
              </div>
              <div>
                <span style={{ color: "var(--text-secondary)" }}>Output:</span>
                <pre
                  style={{
                    backgroundColor: "rgba(0,0,0,0.5)",
                    padding: "6px",
                    borderRadius: "4px",
                    overflowX: "auto",
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {JSON.stringify(call.output, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
