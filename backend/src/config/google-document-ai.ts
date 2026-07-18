import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { config } from "./env";

let client: DocumentProcessorServiceClient | null = null;

/** Lazily builds a Document AI client from a service account key JSON stored directly in env (no key file on disk). */
export const getDocumentAiClient = (): DocumentProcessorServiceClient => {
  if (!config.googleApplicationCredentialsJson || !config.googleCloudProjectId || !config.googleDocumentAiProcessorId) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON/GOOGLE_CLOUD_PROJECT_ID/GOOGLE_DOCUMENT_AI_PROCESSOR_ID is not configured. Refusing to call Document AI without full credentials."
    );
  }
  if (!client) {
    const credentials = JSON.parse(config.googleApplicationCredentialsJson);
    client = new DocumentProcessorServiceClient({ credentials, projectId: config.googleCloudProjectId });
  }
  return client;
};

export const getDocumentAiProcessorPath = (): string => {
  const client = getDocumentAiClient();
  return client.processorPath(config.googleCloudProjectId, config.googleDocumentAiLocation, config.googleDocumentAiProcessorId);
};

/** Called once at server startup so missing OCR credentials fail fast instead of on the first upload. */
export const assertDocumentAiConfigured = (): void => {
  getDocumentAiClient();
};
