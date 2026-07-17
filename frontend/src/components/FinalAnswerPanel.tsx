import React from "react";

interface FinalAnswerPanelProps {
  answer: string;
  ticketId?: string;
  runId: string;
}

export const FinalAnswerPanel: React.FC<FinalAnswerPanelProps> = ({ answer, ticketId, runId }) => {
  return (
    <div
      className="glass glow-card"
      style={{
        padding: "24px",
        marginTop: "24px",
        borderLeft: "4px solid var(--accent-gold)",
        backgroundColor: "rgba(245, 158, 11, 0.02)",
      }}
    >
      <h3 style={{ color: "var(--accent-gold)", marginBottom: "12px" }}>🎯 Final Resolution</h3>
      <p style={{ fontSize: "1.1rem", lineHeight: "1.6", color: "var(--text-primary)" }}>
        {answer}
      </p>

      <div
        style={{
          marginTop: "16px",
          display: "flex",
          gap: "16px",
          fontSize: "0.85rem",
          color: "var(--text-secondary)",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          paddingTop: "16px",
        }}
      >
        <div>
          <span style={{ fontWeight: "600" }}>Run ID: </span>
          <code style={{ fontSize: "0.8rem", color: "var(--accent-blue)" }}>{runId}</code>
        </div>
        {ticketId && (
          <div>
            <span style={{ fontWeight: "600" }}>Created Ticket: </span>
            <code style={{ fontSize: "0.8rem", color: "var(--accent-green)" }}>{ticketId}</code>
          </div>
        )}
      </div>
    </div>
  );
};
