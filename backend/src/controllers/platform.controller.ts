import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { maskPiiPayload } from "../services/governance/pii-masking.service";
import { decideApproval } from "../services/platform/approval.service";
import { resumeOrchestration } from "../services/orchestration/planner.service";
import { getTenantConfig, putTenantConfig } from "../services/platform/tenant-config.service";
import { createWorkflowVersion, listWorkflowVersions, publishWorkflowVersion, validateWorkflow } from "../services/platform/workflow-registry.service";
import { TenantRuntimeConfig, WorkflowDefinition } from "../types/platform.types";
import { pgQuery } from "../config/pg";
import { saveRunAsDossier } from "../services/documents/dossier.service";

const fail = (res: Response, error: unknown) => {
  const message=error instanceof Error?error.message:"UNKNOWN_ERROR";
  const status=message.includes("NOT_FOUND")?404:message.includes("FORBIDDEN")||message.includes("TENANT")?403:message.includes("ALREADY")||message.includes("REPLAY")||message.includes("IMMUTABLE")?409:422;
  return res.status(status).json({error:message,issues:(error as {issues?:unknown})?.issues});
};
export const validateWorkflowHandler=(req:AuthenticatedRequest,res:Response)=>{ const definition={...(req.body as WorkflowDefinition),tenantId:req.user!.tenantId}; const issues=validateWorkflow(definition); return res.status(issues.length?422:200).json({valid:!issues.length,issues}); };
export const createWorkflowHandler=async(req:AuthenticatedRequest,res:Response)=>{ try { const {version="1.0.0",...body}=req.body as WorkflowDefinition&{version?:string}; const definition={...body,tenantId:req.user!.tenantId}; return res.status(201).json(await createWorkflowVersion(definition,version,req.user!.sub)); } catch(e){return fail(res,e);} };
export const publishWorkflowHandler=async(req:AuthenticatedRequest,res:Response)=>{ try{return res.json(await publishWorkflowVersion(req.user!.tenantId,req.params.id,req.params.version,req.user!.sub));}catch(e){return fail(res,e);} };
export const listWorkflowVersionsHandler=async(req:AuthenticatedRequest,res:Response)=>{try{return res.json({versions:await listWorkflowVersions(req.user!.tenantId,req.params.id)});}catch(e){return fail(res,e);}};
export const getTenantConfigHandler=async(req:AuthenticatedRequest,res:Response)=>{if(req.params.tenantId!==req.user!.tenantId)return res.status(403).json({error:"TENANT_MISMATCH"}); return res.json(await getTenantConfig(req.user!.tenantId));};
export const putTenantConfigHandler=async(req:AuthenticatedRequest,res:Response)=>{if(req.params.tenantId!==req.user!.tenantId)return res.status(403).json({error:"TENANT_MISMATCH"});try{return res.json(await putTenantConfig(req.user!.tenantId,req.body as TenantRuntimeConfig,req.user!.sub));}catch(e){return fail(res,e);}};
export const getRunHandler=async(req:AuthenticatedRequest,res:Response)=>{const result=await pgQuery(`SELECT run_id,case_id,status,response_payload,created_at,workflow_id,workflow_version,config_version,saved_at,saved_by FROM orchestration_runs WHERE run_id=$1 AND tenant_id=$2`,[req.params.runId,req.user!.tenantId]);if(!result.rows[0])return res.status(404).json({error:"RUN_NOT_FOUND"});return res.json(maskPiiPayload(result.rows[0]));};
export const saveRunHandler=async(req:AuthenticatedRequest,res:Response)=>{try{
  const dossier=await saveRunAsDossier(req.user!.tenantId,req.params.runId,req.user!.sub);
  return res.status(200).json({saved:true,runId:req.params.runId,dossier});
}catch(error){return fail(res,error);}};
export const getRunEventsHandler=async(req:AuthenticatedRequest,res:Response)=>{const owned=await pgQuery(`SELECT 1 FROM orchestration_runs WHERE run_id=$1 AND tenant_id=$2`,[req.params.runId,req.user!.tenantId]);if(!owned.rows[0])return res.status(404).json({error:"RUN_NOT_FOUND"});const result=await pgQuery(`SELECT event_id,run_id,timestamp,actor,action_type,status,details FROM audit_events WHERE run_id=$1 ORDER BY seq`,[req.params.runId]);return res.json({events:maskPiiPayload(result.rows)});};
export const decideApprovalHandler=async(req:AuthenticatedRequest,res:Response)=>{try{const {decision,comment}=req.body;if(!["approved","rejected","more_information"].includes(decision))return res.status(400).json({error:"INVALID_APPROVAL_DECISION"});return res.json(await decideApproval(req.user!.tenantId,req.params.runId,req.params.approvalId,decision,req.user!.sub,req.user!.role,typeof comment==="string"?comment:undefined));}catch(e){return fail(res,e);}};
export const resumeRunHandler=async(req:AuthenticatedRequest,res:Response)=>{try{return res.status(200).json(await resumeOrchestration(req.params.runId,req.user!.tenantId));}catch(e){return fail(res,e);}};
