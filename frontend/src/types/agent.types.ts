export type AgentRole = "planner" | "credit" | "legal" | "operations";

export interface AgentTask {
  id: string;
  role: AgentRole;
  description: string;
  status: "pending" | "running" | "completed" | "blocked" | "failed";
}
