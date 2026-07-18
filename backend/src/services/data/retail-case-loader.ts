import { RetailCase } from "../../types/case.types";
import { pgQuery } from "../../config/pg";
import { supabase } from "../../config/supabase";

/** Loads a case from Supabase or local Postgres. Returns undefined if the case doesn't exist. */
export const loadRetailCase = async (caseId: string): Promise<RetailCase | undefined> => {
  if (process.env.SUPABASE_DB_URL) {
    const { data, error } = await supabase
      .from("retail_cases")
      .select("payload")
      .eq("case_id", caseId)
      .single();

    if (error) {
      console.warn("Supabase: failed to load case:", error.message);
      return undefined;
    }
    return data?.payload as RetailCase | undefined;
  }

  const dbResult = await pgQuery("SELECT payload FROM retail_cases WHERE case_id = $1", [caseId]);
  return dbResult.rows[0]?.payload as RetailCase | undefined;
};

/** Persists a case (e.g. one just extracted from free text by the LLM) so later lookups by caseId hit the DB. */
export const saveRetailCase = async (retailCase: RetailCase): Promise<void> => {
  if (process.env.SUPABASE_DB_URL) {
    const { error } = await supabase
      .from("retail_cases")
      .upsert({ case_id: retailCase.caseId, customer_id: retailCase.customerId, payload: retailCase }, { onConflict: "case_id" });
    if (error) throw new Error(`Supabase: failed to save case ${retailCase.caseId}: ${error.message}`);
    return;
  }

  await pgQuery(
    `INSERT INTO retail_cases (case_id, customer_id, payload)
     VALUES ($1, $2, $3)
     ON CONFLICT (case_id) DO UPDATE SET customer_id = EXCLUDED.customer_id, payload = EXCLUDED.payload`,
    [retailCase.caseId, retailCase.customerId, JSON.stringify(retailCase)]
  );
};
