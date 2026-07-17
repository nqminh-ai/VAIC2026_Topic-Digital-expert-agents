import { Router } from "express";
import { mockCreditScore, mockApprovalTicket } from "../controllers/mock.controller";

const router = Router();

router.post("/credit-score", mockCreditScore);
router.post("/approval-ticket", mockApprovalTicket);

export default router;
