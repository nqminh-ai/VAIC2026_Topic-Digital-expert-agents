import dotenv from "dotenv";
import { Pool } from "pg";

// Loaded here (not just in config/env.ts) so pgPool's connection string is correct
// regardless of which module happens to import this file first in the dependency graph.
dotenv.config();

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL is required; Postgres now always connects through Supabase.");
}

export const pgPool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 500,
  connectionTimeoutMillis: 5000,
});

pgPool.on("error", (err: Error) => {
  console.error("Unexpected error on idle PostgreSQL client:", err);
});

export const pgQuery = async (text: string, params?: any[]) => {
  return pgPool.query(text, params);
};
