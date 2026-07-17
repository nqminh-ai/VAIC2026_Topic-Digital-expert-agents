import { useState } from "react";
import { triggerOrchestration } from "./api/orchestration.api";
import { OrchestrationResponse } from "./types/orchestration.types";
import { PromptComposer } from "./components/PromptComposer";
import { AgentTraceTimeline } from "./components/AgentTraceTimeline";
import { FinalAnswerPanel } from "./components/FinalAnswerPanel";

function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runData, setRunData] = useState<OrchestrationResponse | null>(null);

  const handlePromptSubmit = async (prompt: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await triggerOrchestration(prompt);
      setRunData(response);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred during orchestration.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", width: "100%", padding: "40px 20px" }}>
      {/* Header Panel */}
      <header style={{ textAlign: "center", marginBottom: "40px" }}>
        <h1
          style={{
            fontSize: "2.8rem",
            background: "linear-gradient(to right, #F59E0B, #3B82F6)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            marginBottom: "8px",
          }}
        >
          SHB Digital Expert Agents
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>
          Vietnam Innovation Challenge 2026 • Multi-Agent Operations System
        </p>
      </header>

      {/* Grid Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 450px) 1fr", gap: "32px" }}>
        {/* Left Column: Compose & System Overview */}
        <div>
          <PromptComposer onSubmit={handlePromptSubmit} isLoading={loading} />

          {/* System status details */}
          <div className="glass" style={{ padding: "20px" }}>
            <h4 style={{ color: "var(--text-primary)", marginBottom: "12px" }}>System Specialist Registry</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span>🎯</span>
                <div>
                  <strong style={{ color: "var(--accent-blue)" }}>Planner Agent</strong>
                  <p style={{ color: "var(--text-secondary)" }}>Decomposes operations task and delegates to specialists.</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span>💳</span>
                <div>
                  <strong style={{ color: "var(--accent-gold)" }}>Credit Specialist</strong>
                  <p style={{ color: "var(--text-secondary)" }}>Calculates credit score models and policy validation.</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span>⚖️</span>
                <div>
                  <strong style={{ color: "var(--accent-green)" }}>Legal & Compliance</strong>
                  <p style={{ color: "var(--text-secondary)" }}>Verifies transactions align with regulatory standards.</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span>⚙️</span>
                <div>
                  <strong style={{ color: "var(--accent-red)" }}>Operations Specialist</strong>
                  <p style={{ color: "var(--text-secondary)" }}>Fulfills the request and publishes transaction tickets.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Visual Tracing & Output */}
        <div>
          {error && (
            <div
              className="glass"
              style={{
                padding: "16px",
                borderColor: "var(--accent-red)",
                backgroundColor: "rgba(239, 68, 68, 0.05)",
                color: "var(--accent-red)",
                marginBottom: "24px",
              }}
            >
              ⚠️ {error}
            </div>
          )}

          {loading && (
            <div
              className="glass"
              style={{
                padding: "40px",
                textAlign: "center",
                color: "var(--text-secondary)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "16px",
              }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  border: "4px solid rgba(245, 158, 11, 0.1)",
                  borderTopColor: "var(--accent-gold)",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              />
              <style>
                {`
                  @keyframes spin {
                    to { transform: rotate(360deg); }
                  }
                `}
              </style>
              <span>Orchestrating agent workflows and processing tool calls...</span>
            </div>
          )}

          {!loading && !runData && !error && (
            <div
              className="glass"
              style={{
                padding: "60px 40px",
                textAlign: "center",
                color: "var(--text-secondary)",
              }}
            >
              <h3>No Active Execution</h3>
              <p style={{ fontSize: "0.95rem", color: "var(--text-muted)", marginTop: "8px" }}>
                Submit a prompt from the composer on the left to see the agent orchestration traces in real-time.
              </p>
            </div>
          )}

          {runData && !loading && (
            <div>
              <h2 style={{ marginBottom: "20px" }}>Agent Execution Traces</h2>
              <AgentTraceTimeline traces={runData.traces} />
              <FinalAnswerPanel
                answer={runData.finalAnswer}
                ticketId={runData.approvalTicketId}
                runId={runData.runId}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
