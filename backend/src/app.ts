import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes";
import orchestrationRoutes from "./routes/orchestration.routes";
import { runRoutes, tenantRoutes, workflowRoutes } from "./routes/platform.routes";
import { documentChecklistRoutes, dossierRoutes } from "./routes/document-intake.routes";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/orchestrate", orchestrationRoutes);
app.use("/api/workflows", workflowRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/runs", runRoutes);
app.use("/api/document-checklists", documentChecklistRoutes);
app.use("/api/dossiers", dossierRoutes);

export default app;
