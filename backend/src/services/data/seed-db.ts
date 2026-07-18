import { pgQuery } from "../../config/pg";
import { getNeo4jSession } from "../../config/neo4j";
import { setupOrchestrationCheckpointer } from "../orchestration/orchestration-graph";
import { seedLegalKnowledgeGraph } from "./knowledge-graph-seed.service";

export const seedDatabases = async () => {
  console.log("=== STARTING DATABASE SEED PROCESS ===");

  try {
    // 1. PostgreSQL Seeding
    console.log("Initializing PostgreSQL Tables...");
    
    // Create retail_cases table
    await pgQuery(`
      CREATE TABLE IF NOT EXISTS retail_cases (
        case_id VARCHAR(50) PRIMARY KEY,
        customer_id VARCHAR(50) NOT NULL,
        payload JSONB NOT NULL
      );
    `);

    // Create orchestration_runs table to persist traces in production
    await pgQuery(`
      CREATE TABLE IF NOT EXISTS orchestration_runs (
        run_id VARCHAR(50) PRIMARY KEY,
        case_id VARCHAR(50),
        prompt TEXT,
        status VARCHAR(50),
        response_payload JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create the append-only, hash-chained audit log table required for regulatory audit trails.
    await pgQuery(`
      CREATE TABLE IF NOT EXISTS audit_events (
        seq BIGSERIAL PRIMARY KEY,
        event_id VARCHAR(60) NOT NULL UNIQUE,
        run_id VARCHAR(50) NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        actor VARCHAR(100) NOT NULL,
        action_type VARCHAR(30) NOT NULL,
        status VARCHAR(20) NOT NULL,
        details TEXT NOT NULL,
        prev_hash CHAR(64) NOT NULL,
        hash CHAR(64) NOT NULL
      );
    `);

    await pgQuery(`
      CREATE INDEX IF NOT EXISTS idx_audit_events_run_id ON audit_events (run_id);
    `);

    // Enforce append-only semantics at the database level: even a compromised app
    // credential cannot rewrite or erase history without first dropping this trigger,
    // which itself would be a distinct, auditable DDL event in Postgres's own logs.
    await pgQuery(`
      CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_events is append-only: % is not permitted', TG_OP;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pgQuery(`
      DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
    `);

    await pgQuery(`
      CREATE TRIGGER trg_audit_events_immutable
      BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
    `);

    // Create LangGraph's own checkpoint tables so an in-flight orchestration run's
    // graph state survives a server restart/crash instead of being lost.
    await setupOrchestrationCheckpointer();
    console.log("LangGraph: Postgres checkpointer tables ready.");

    // retail_cases starts empty — cases are only ever written by case-extraction.service.ts
    // (LLM extraction from a real credit officer's request), never seeded from fixtures.

    // 2. Neo4j Seeding
    console.log("Initializing Neo4j Graph Databases...");
    const session = getNeo4jSession();

    try {
      // The versioned graph catalog is merged instead of clearing Neo4j on every boot.
      // This preserves externally curated nodes while keeping application-owned nodes
      // and relationships idempotently up to date. Collateral Project nodes are not
      // seeded here — they must be registered from real project guarantee data as
      // loan applications reference them (see policy-rag.service.ts queryProjectGuarantee).
      await seedLegalKnowledgeGraph(session);

      console.log("Neo4j: Seeded versioned documents, clauses, policy rules and gates successfully.");
    } finally {
      await session.close();
    }

    console.log("=== DATABASE SEED PROCESS COMPLETED SUCCESSFULLY ===");
  } catch (error) {
    console.error("Error during database seed process:", error);
    throw error;
  }
};
