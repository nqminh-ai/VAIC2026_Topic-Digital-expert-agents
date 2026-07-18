import crypto from "crypto";
import { config } from "../../config/env";
import { UserRole } from "../../config/auth";

/**
 * Placeholder identity directory simulating SHB's SSO/Active Directory.
 * Replace with a real IdP integration (SAML/OIDC against SHB AD) before production rollout;
 * this exists only so the maker-checker auth flow has real accounts to authenticate against.
 */
interface DemoUser {
  username: string;
  role: UserRole;
  passwordHash: string; // format: "<saltHex>:<hashHex>"
}

const SCRYPT_KEY_LENGTH = 64;

const hashPassword = (password: string, saltHex: string): string => {
  return crypto.scryptSync(password, Buffer.from(saltHex, "hex"), SCRYPT_KEY_LENGTH).toString("hex");
};

const buildUser = (username: string, role: UserRole, password: string): DemoUser => {
  if (!password) {
    throw new Error(`Missing bootstrap password for demo account "${username}". Set it via environment variables.`);
  }
  const salt = crypto.randomBytes(16).toString("hex");
  return { username, role, passwordHash: `${salt}:${hashPassword(password, salt)}` };
};

let demoUsers: DemoUser[] | null = null;

const getDemoUsers = (): DemoUser[] => {
  if (!demoUsers) {
    demoUsers = [
      buildUser("officer.tam", "CREDIT_OFFICER", config.demoOfficerPassword),
      buildUser("approver.lan", "CREDIT_APPROVER", config.demoApproverPassword),
    ];
  }
  return demoUsers;
};

/** Called once at server startup so a missing bootstrap password fails fast instead of on the first login. */
export const assertDemoUsersConfigured = (): void => {
  getDemoUsers();
};

/**
 * Only 2 demo accounts exist in this repo (see getDemoUsers above) — real workload-based routing
 * across a full officer directory is out of scope until a real IdP/user table replaces this.
 */
export const listUsernamesByRole = (role: UserRole): string[] =>
  getDemoUsers().filter(user => user.role === role).map(user => user.username);

export const verifyCredentials = (username: string, password: string): { username: string; role: UserRole } | null => {
  const user = getDemoUsers().find((u) => u.username === username);
  if (!user) {
    return null;
  }

  const [saltHex, storedHashHex] = user.passwordHash.split(":");
  const candidateHash = Buffer.from(hashPassword(password, saltHex), "hex");
  const storedHash = Buffer.from(storedHashHex, "hex");

  if (candidateHash.length !== storedHash.length || !crypto.timingSafeEqual(candidateHash, storedHash)) {
    return null;
  }

  return { username: user.username, role: user.role };
};
