import crypto from "crypto";
import { AuditEvent } from "../../types/trace.types";
import { pgPool } from "../../config/pg";

// Genesis hash for an empty chain — every subsequent event links to its predecessor's hash.
const GENESIS_HASH = "0".repeat(64);

// Serializes concurrent writers onto a single advisory lock so the hash chain
// (which depends on reading the previous row before writing the next one) never forks.
const AUDIT_CHAIN_LOCK_KEY = 7_272_720_01;

const computeHash = (
  prevHash: string,
  event: Pick<AuditEvent, "eventId" | "runId" | "timestamp" | "actor" | "actionType" | "status" | "details">
): string => {
  const canonical = [
    prevHash,
    event.eventId,
    event.runId,
    event.timestamp,
    event.actor,
    event.actionType,
    event.status,
    event.details,
  ].join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex");
};

interface AuditEventRow {
  event_id: string;
  run_id: string;
  timestamp: string | Date;
  actor: string;
  action_type: AuditEvent["actionType"];
  status: AuditEvent["status"];
  details: string;
}

const toAuditEvent = (row: AuditEventRow): AuditEvent => ({
  eventId: row.event_id,
  runId: row.run_id,
  timestamp: new Date(row.timestamp).toISOString(),
  actor: row.actor,
  actionType: row.action_type,
  status: row.status,
  details: row.details,
});

/**
 * Appends a new, hash-chained audit event and persists it durably (Postgres, append-only —
 * see the `trg_audit_events_immutable` trigger created in seed-db.ts). Scans the payload for
 * common prompt-injection markers and records the event as blocked when found.
 */
export const recordAuditEvent = async (
  runId: string,
  actor: string,
  actionType: "agent_call" | "tool_call" | "model_call" | "dashboard_output" | "human_approval",
  payload: Record<string, any>,
  status: "allowed" | "blocked" = "allowed",
  customDetails?: string
): Promise<AuditEvent> => {
  let details = customDetails || `Actor: ${actor} executed ${actionType}.`;
  let finalStatus = status;

  const payloadString = JSON.stringify(payload).toLowerCase();
  if (
    payloadString.includes("system instruction") ||
    payloadString.includes("ignore all previous instructions") ||
    payloadString.includes("override check")
  ) {
    finalStatus = "blocked";
    details = "PHÁT HIỆN TẤN CÔNG PROMPT INJECTION: Hồ sơ chứa chỉ thị điều khiển hệ thống ngoài phạm vi cho phép. Hệ thống đã cô lập mã độc.";
  }

  const eventId = `evt-${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();

  try {
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      // Holds the lock for the duration of this transaction only (pg_advisory_xact_lock).
      await client.query("SELECT pg_advisory_xact_lock($1)", [AUDIT_CHAIN_LOCK_KEY]);

      const prevResult = await client.query<{ hash: string }>(
        "SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1"
      );
      const prevHash = prevResult.rows[0]?.hash ?? GENESIS_HASH;

      const eventForHash = { eventId, runId, timestamp, actor, actionType, status: finalStatus, details };
      const hash = computeHash(prevHash, eventForHash);

      await client.query(
        `INSERT INTO audit_events (event_id, run_id, timestamp, actor, action_type, status, details, prev_hash, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [eventId, runId, timestamp, actor, actionType, finalStatus, details, prevHash, hash]
      );

      await client.query("COMMIT");
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.warn("Audit Log: Rollback failed, connection likely closed:", rollbackErr);
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (dbErr) {
    console.error("WARNING: Failed to write audit event to database:", dbErr);
  }

  return { eventId, runId, timestamp, actor, actionType, status: finalStatus, details };
};

export const getAuditEventsByRun = async (runId: string): Promise<AuditEvent[]> => {
  const result = await pgPool.query<AuditEventRow>(
    `SELECT event_id, run_id, timestamp, actor, action_type, status, details
     FROM audit_events WHERE run_id = $1 ORDER BY seq ASC`,
    [runId]
  );
  return result.rows.map(toAuditEvent);
};

export const getAllAuditEvents = async (): Promise<AuditEvent[]> => {
  const result = await pgPool.query<AuditEventRow>(
    "SELECT event_id, run_id, timestamp, actor, action_type, status, details FROM audit_events ORDER BY seq ASC"
  );
  return result.rows.map(toAuditEvent);
};

export interface AuditChainIntegrityResult {
  valid: boolean;
  eventsChecked: number;
  brokenAtEventId?: string;
}

/**
 * Recomputes the hash chain end-to-end and reports the first event where a stored hash
 * no longer matches its recomputed value — proof the log has (or has not) been tampered with.
 */
export const verifyAuditChainIntegrity = async (): Promise<AuditChainIntegrityResult> => {
  const result = await pgPool.query<AuditEventRow & { prev_hash: string; hash: string }>(
    `SELECT event_id, run_id, timestamp, actor, action_type, status, details, prev_hash, hash
     FROM audit_events ORDER BY seq ASC`
  );

  let expectedPrevHash = GENESIS_HASH;
  let eventsChecked = 0;

  for (const row of result.rows) {
    const timestamp = new Date(row.timestamp).toISOString();
    const recomputedHash = computeHash(expectedPrevHash, {
      eventId: row.event_id,
      runId: row.run_id,
      timestamp,
      actor: row.actor,
      actionType: row.action_type,
      status: row.status,
      details: row.details,
    });

    if (row.prev_hash !== expectedPrevHash || row.hash !== recomputedHash) {
      return { valid: false, eventsChecked, brokenAtEventId: row.event_id };
    }

    expectedPrevHash = row.hash;
    eventsChecked += 1;
  }

  return { valid: true, eventsChecked };
};
