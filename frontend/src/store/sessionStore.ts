import { create } from "zustand";
import type { UserRole } from "../types/api";

interface Session {
  accessToken: string;
  role: UserRole;
  tenantId: string;
}

interface SessionStoreState extends Partial<Session> {
  setSession: (session: Session) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionStoreState>()(set => ({
  setSession: session => set(session),
  clearSession: () => set({ accessToken: undefined, role: undefined, tenantId: undefined }),
}));
