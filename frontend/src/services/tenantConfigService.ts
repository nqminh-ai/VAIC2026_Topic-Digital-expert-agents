import { apiFetch } from "./httpClient";
import type { TenantRuntimeConfig } from "../types/api";

export const getTenantConfig = (tenantId: string, token: string): Promise<TenantRuntimeConfig | null> =>
  apiFetch<TenantRuntimeConfig | null>(`/api/tenants/${tenantId}/config`, { token });

export const putTenantConfig = (
  tenantId: string,
  config: TenantRuntimeConfig,
  token: string
): Promise<TenantRuntimeConfig> =>
  apiFetch<TenantRuntimeConfig>(`/api/tenants/${tenantId}/config`, { method: "PUT", body: config, token });
