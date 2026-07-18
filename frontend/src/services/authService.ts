import { apiFetch } from "./httpClient";
import type { UserRole } from "../types/api";

export interface LoginResponse {
  accessToken: string;
  role: UserRole;
  tenantId: string;
  expiresIn: number;
}

export const login = (username: string, password: string): Promise<LoginResponse> =>
  apiFetch<LoginResponse>("/api/auth/login", { method: "POST", body: { username, password } });

let cachedDemoSession: { token: string; expiresAt: number } | null = null;

/** Gets a short-lived officer token without showing a login screen in the hackathon demo. */
export const getDemoAccessToken = async (): Promise<string> => {
  if (cachedDemoSession && cachedDemoSession.expiresAt > Date.now() + 30_000) {
    return cachedDemoSession.token;
  }

  const session = await apiFetch<LoginResponse>("/api/auth/demo-session", { method: "POST" });
  cachedDemoSession = {
    token: session.accessToken,
    expiresAt: Date.now() + session.expiresIn * 1000,
  };
  return session.accessToken;
};

let cachedDemoApproverSession: { session: LoginResponse; expiresAt: number } | null = null;

/** Gets a short-lived approver session (role + tenantId included) for the policy console demo. */
export const getDemoApproverSession = async (): Promise<LoginResponse> => {
  if (cachedDemoApproverSession && cachedDemoApproverSession.expiresAt > Date.now() + 30_000) {
    return cachedDemoApproverSession.session;
  }

  const session = await apiFetch<LoginResponse>("/api/auth/demo-session/approver", { method: "POST" });
  cachedDemoApproverSession = {
    session,
    expiresAt: Date.now() + session.expiresIn * 1000,
  };
  return session;
};
