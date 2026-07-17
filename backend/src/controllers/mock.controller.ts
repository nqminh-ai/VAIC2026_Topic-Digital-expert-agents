import { Request, Response } from "express";
import { checkCreditScore } from "../services/tools/credit-score.tool";
import { createApprovalTicket } from "../services/tools/approval-ticket.tool";

export const mockCreditScore = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.body;
    const result = await checkCreditScore(customerId || "UNKNOWN");
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: "Failed to mock credit score" });
  }
};

export const mockApprovalTicket = async (req: Request, res: Response) => {
  try {
    const { details } = req.body;
    const result = await createApprovalTicket(details || {});
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: "Failed to mock approval ticket" });
  }
};
