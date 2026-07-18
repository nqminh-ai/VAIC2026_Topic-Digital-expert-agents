import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.middleware";
import {
  createChecklistVersionHandler,
  createDossierHandler,
  getDossierHandler,
  getPublishedChecklistHandler,
  listChecklistVersionsHandler,
  listDossiersHandler,
  publishChecklistVersionHandler,
  reviewDecisionHandler,
  uploadDocumentHandler,
} from "../controllers/document-intake.controller";

// In-memory buffering: files go straight to Supabase Storage, never touch local disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

export const documentChecklistRoutes = Router();
documentChecklistRoutes.use(requireAuth("CREDIT_OFFICER", "CREDIT_APPROVER"));
documentChecklistRoutes.get("/:loanType", getPublishedChecklistHandler);
documentChecklistRoutes.get("/:loanType/versions", listChecklistVersionsHandler);
documentChecklistRoutes.post("/", requireAuth("CREDIT_APPROVER"), createChecklistVersionHandler);
documentChecklistRoutes.post("/:loanType/versions/:version/publish", requireAuth("CREDIT_APPROVER"), publishChecklistVersionHandler);

export const dossierRoutes = Router();
dossierRoutes.use(requireAuth("CREDIT_OFFICER", "CREDIT_APPROVER"));
dossierRoutes.post("/", createDossierHandler);
dossierRoutes.get("/", listDossiersHandler);
dossierRoutes.get("/:id", getDossierHandler);
dossierRoutes.post("/:id/documents", upload.single("file"), uploadDocumentHandler);
dossierRoutes.post("/:id/review-decision", reviewDecisionHandler);
