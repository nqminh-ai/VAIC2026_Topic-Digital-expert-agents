import React, { useState } from "react";

interface PromptComposerProps {
  onSubmit: (prompt: string) => void;
  isLoading: boolean;
}

const TEMPLATE_PROMPTS = [
  "Assess credit score for Customer CUST-9921, check legal policy guidelines, and create an approval ticket.",
  "Run risk assessment on customer CUST-4412 and prepare ticket operations flow.",
];

export const PromptComposer: React.FC<PromptComposerProps> = ({ onSubmit, isLoading }) => {
  const [prompt, setPrompt] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;
    onSubmit(prompt);
  };

  return (
    <div className="glass glow-card" style={{ padding: "24px", marginBottom: "24px" }}>
      <h3 style={{ marginBottom: "12px", fontSize: "1.25rem", color: "var(--accent-gold)" }}>
        Ask Digital Expert Agents
      </h3>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "16px" }}>
        Input a banking request. The Planner Agent will distribute tasks to Credit, Legal, and Operations specialist agents.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Process credit evaluation for customer CUST-1029..."
          rows={3}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            border: "1px solid var(--border-color)",
            backgroundColor: "rgba(0,0,0,0.2)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-sans)",
            fontSize: "1rem",
            outline: "none",
            resize: "none",
            transition: "border-color 0.2s",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--accent-gold)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--border-color)")}
        />
        <button
          type="submit"
          disabled={isLoading || !prompt.trim()}
          style={{
            alignSelf: "flex-end",
            padding: "10px 24px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: isLoading ? "var(--text-muted)" : "var(--accent-gold)",
            color: "#000",
            fontWeight: "bold",
            fontSize: "0.95rem",
            boxShadow: isLoading ? "none" : "0 0 10px var(--glow-gold)",
            cursor: isLoading ? "not-allowed" : "pointer",
          }}
        >
          {isLoading ? "Orchestrating Workflow..." : "Submit Prompt"}
        </button>
      </form>

      <div style={{ marginTop: "16px" }}>
        <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "8px" }}>
          Sample Scenarios:
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {TEMPLATE_PROMPTS.map((t, idx) => (
            <button
              key={idx}
              onClick={() => setPrompt(t)}
              style={{
                textAlign: "left",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid rgba(255,255,255,0.05)",
                backgroundColor: "rgba(255, 255, 255, 0.02)",
                color: "var(--text-secondary)",
                fontSize: "0.85rem",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.05)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.02)";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
