import { Router } from "express";
import { orchestratePrompt, getRunTraces } from "../controllers/orchestration.controller";

const router = Router();

router.post("/", orchestratePrompt);
router.get("/:runId/traces", getRunTraces);

export default router;
