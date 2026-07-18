import { supabase } from "./supabase";
import { config } from "./env";

/** Uploads a document buffer to the intake bucket and returns the storage path used as dossier_documents.storage_path. */
export const uploadDossierDocument = async (
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<string> => {
  const { error } = await supabase.storage
    .from(config.supabaseStorageBucket)
    .upload(path, buffer, { contentType, upsert: false });
  if (error) {
    throw new Error(`Failed to upload document to Supabase Storage: ${error.message}`);
  }
  return path;
};

export const downloadDossierDocument = async (path: string): Promise<Buffer> => {
  const { data, error } = await supabase.storage.from(config.supabaseStorageBucket).download(path);
  if (error || !data) {
    throw new Error(`Failed to download document ${path} from Supabase Storage: ${error?.message ?? "no data"}`);
  }
  return Buffer.from(await data.arrayBuffer());
};

export const getDossierDocumentSignedUrl = async (path: string, expiresInSeconds = 600): Promise<string> => {
  const { data, error } = await supabase.storage
    .from(config.supabaseStorageBucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) {
    throw new Error(`Failed to create signed URL for ${path}: ${error?.message ?? "no data"}`);
  }
  return data.signedUrl;
};
