import { Router } from "express";
import { createDemoApproverSession, createDemoSession, login } from "../controllers/auth.controller";

const router = Router();

router.post("/login", login);
router.post("/demo-session", createDemoSession);
router.post("/demo-session/approver", createDemoApproverSession);

export default router;
