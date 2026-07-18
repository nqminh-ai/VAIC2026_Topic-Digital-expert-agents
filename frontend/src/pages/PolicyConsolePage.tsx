import { useEffect, useState } from "react";
import { ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Header } from "../layouts/Header";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Skeleton } from "../components/Skeleton";
import { PolicyField } from "../features/policy/PolicyField";
import { ListEditor } from "../features/policy/ListEditor";
import { RegulatoryBaseline } from "../features/policy/RegulatoryBaseline";
import { useSessionStore } from "../store/sessionStore";
import { getDemoApproverSession } from "../services/authService";
import { getTenantConfig, putTenantConfig } from "../services/tenantConfigService";
import { ApiError } from "../services/httpClient";
import type { TenantRuntimeConfig } from "../types/api";
import styles from "./PolicyConsolePage.module.css";

const formatDate = (iso: string): string => new Date(iso).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" });

/** Trần DTI theo Thông tư 22/2019/TT-NHNN — ngân hàng chỉ được siết chặt hơn (đặt thấp hơn), không được vượt. */
const REGULATORY_MAX_DTI = 0.6;

const buildBlankDraft = (tenantId: string): TenantRuntimeConfig => ({
  tenantId,
  version: "1.0.0",
  thresholds: { minCreditScore: 600, maxDti: 0.5 },
  runtime: { maxRetriesPerAgent: 3, maxSteps: 20, maxTokens: 4000, timeoutSeconds: 60 },
  allowedModels: [],
  citationPolicy: { required: true, rejectIfMissing: true, minimumConfidence: 0.7, allowedSourceTypes: [] },
  effectiveFrom: new Date().toISOString(),
  updatedBy: "",
});

type FieldErrors = Partial<Record<"maxDti" | "maxRetriesPerAgent" | "maxSteps" | "maxTokens" | "timeoutSeconds" | "allowedModels" | "version" | "effectiveFrom", string>>;

const validate = (draft: TenantRuntimeConfig): FieldErrors => {
  const errors: FieldErrors = {};
  if (!(draft.thresholds.maxDti > 0 && draft.thresholds.maxDti <= 1)) errors.maxDti = "Phải nằm trong khoảng (0, 1]";
  else if (draft.thresholds.maxDti > REGULATORY_MAX_DTI)
    errors.maxDti = `Không được vượt trần DTI ${REGULATORY_MAX_DTI * 100}% theo Thông tư 22/2019/TT-NHNN`;
  if (draft.runtime.maxRetriesPerAgent < 1) errors.maxRetriesPerAgent = "Phải lớn hơn hoặc bằng 1";
  if (draft.runtime.maxSteps < 1) errors.maxSteps = "Phải lớn hơn hoặc bằng 1";
  if (draft.runtime.maxTokens <= 0) errors.maxTokens = "Phải lớn hơn 0";
  if (draft.runtime.timeoutSeconds < 1) errors.timeoutSeconds = "Phải lớn hơn hoặc bằng 1";
  if (draft.allowedModels.length === 0) errors.allowedModels = "Cần ít nhất 1 mô hình được phép sử dụng";
  if (!draft.version.trim()) errors.version = "Không được để trống";
  if (!draft.effectiveFrom.trim() || Number.isNaN(new Date(draft.effectiveFrom).getTime())) errors.effectiveFrom = "Ngày hiệu lực không hợp lệ";
  return errors;
};

export const PolicyConsolePage = () => {
  const { accessToken, tenantId, setSession, clearSession } = useSessionStore();
  const [config, setConfig] = useState<TenantRuntimeConfig | null | undefined>(undefined);
  const [form, setForm] = useState<TenantRuntimeConfig | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error" | "success">("idle");
  const [saveMessage, setSaveMessage] = useState<string>();

  useEffect(() => {
    if (accessToken && tenantId) return;
    getDemoApproverSession().then(setSession);
  }, [accessToken, tenantId, setSession]);

  useEffect(() => {
    if (!accessToken || !tenantId) return;
    setConfig(undefined);
    getTenantConfig(tenantId, accessToken)
      .then(result => {
        setConfig(result);
        setForm(result ?? buildBlankDraft(tenantId));
      })
      .catch(err => {
        setSaveState("error");
        setSaveMessage(err instanceof ApiError ? err.message : "Không thể tải chính sách hiện tại.");
      });
  }, [accessToken, tenantId]);

  if (config === undefined || !form) {
    return (
      <>
        <Header eyebrow="Bank policy console" title="Cấu hình chính sách vận hành" subtitle="Đang tải chính sách hiện hành…" />
        <div className={styles.grid}>
          {[0, 1, 2, 3].map(i => (
            <Card key={i} title={<Skeleton width={160} height={14} />}>
              <Skeleton height={12} width="90%" />
              <div style={{ height: 8 }} />
              <Skeleton height={12} width="70%" />
            </Card>
          ))}
        </div>
      </>
    );
  }

  const updateForm = (patch: (draft: TenantRuntimeConfig) => TenantRuntimeConfig) => setForm(prev => (prev ? patch(prev) : prev));

  const handlePublish = async () => {
    if (!form || !tenantId || !accessToken) return;
    const validationErrors = validate(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setSaveState("error");
      setSaveMessage("Vui lòng sửa các trường không hợp lệ trước khi xuất bản.");
      return;
    }

    setSaveState("saving");
    setSaveMessage(undefined);
    try {
      const saved = await putTenantConfig(tenantId, form, accessToken);
      setConfig(saved);
      setForm(saved);
      setSaveState("success");
      setSaveMessage(`Đã xuất bản phiên bản ${saved.version}, hiệu lực từ ${formatDate(saved.effectiveFrom)}.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        setSaveState("error");
        setSaveMessage("Phiên làm việc đã hết hạn, đang làm mới — vui lòng thử xuất bản lại.");
        return;
      }
      setSaveState("error");
      setSaveMessage(err instanceof ApiError ? err.message : "Xuất bản chính sách thất bại.");
    }
  };

  return (
    <>
      <Header
        eyebrow="Bank policy console"
        title="Cấu hình chính sách vận hành"
        subtitle="Quy định NHNN áp dụng chung toàn ngành, cộng với chính sách vận hành riêng mà ngân hàng của bạn có thể tự tùy chỉnh."
        action={
          <span className={styles.currentVersion}>
            <ShieldCheck size={14} />
            {config ? (
              <span>
                Đang áp dụng: <strong>{config.version}</strong> · hiệu lực {formatDate(config.effectiveFrom)}
              </span>
            ) : (
              <span>Chưa có chính sách — đây sẽ là phiên bản đầu tiên</span>
            )}
          </span>
        }
      />

      <RegulatoryBaseline />

      <h2 className={styles.sectionTitle}>Chính sách tùy chỉnh của ngân hàng</h2>
      <div className={styles.grid}>
        <Card title="Ngưỡng rủi ro tín dụng">
          <div className={styles.fieldStack}>
            <PolicyField
              label="Điểm tín dụng tối thiểu"
              type="number"
              value={form.thresholds.minCreditScore}
              onChange={e => updateForm(d => ({ ...d, thresholds: { ...d.thresholds, minCreditScore: Number(e.target.value) } }))}
            />
            <PolicyField
              label="DTI tối đa"
              hint={`Tối đa ${REGULATORY_MAX_DTI * 100}% theo trần quy định NHNN — có thể đặt thấp hơn để thận trọng hơn`}
              error={errors.maxDti}
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={form.thresholds.maxDti}
              onChange={e => updateForm(d => ({ ...d, thresholds: { ...d.thresholds, maxDti: Number(e.target.value) } }))}
            />
          </div>
        </Card>

        <Card title="Ngân sách vận hành Agent">
          <div className={styles.fieldStack}>
            <PolicyField
              label="Số lần thử lại tối đa / agent"
              error={errors.maxRetriesPerAgent}
              type="number"
              min="1"
              value={form.runtime.maxRetriesPerAgent}
              onChange={e => updateForm(d => ({ ...d, runtime: { ...d.runtime, maxRetriesPerAgent: Number(e.target.value) } }))}
            />
            <PolicyField
              label="Số bước tối đa mỗi phiên"
              error={errors.maxSteps}
              type="number"
              min="1"
              value={form.runtime.maxSteps}
              onChange={e => updateForm(d => ({ ...d, runtime: { ...d.runtime, maxSteps: Number(e.target.value) } }))}
            />
            <PolicyField
              label="Số token tối đa"
              error={errors.maxTokens}
              type="number"
              min="1"
              value={form.runtime.maxTokens}
              onChange={e => updateForm(d => ({ ...d, runtime: { ...d.runtime, maxTokens: Number(e.target.value) } }))}
            />
            <PolicyField
              label="Timeout (giây)"
              error={errors.timeoutSeconds}
              type="number"
              min="1"
              value={form.runtime.timeoutSeconds}
              onChange={e => updateForm(d => ({ ...d, runtime: { ...d.runtime, timeoutSeconds: Number(e.target.value) } }))}
            />
          </div>
        </Card>

        <Card title="Mô hình AI được phép sử dụng">
          <ListEditor
            label="Danh sách mô hình"
            hint={errors.allowedModels ?? "Cần ít nhất 1 mô hình"}
            placeholder="vd. claude-sonnet-5"
            values={form.allowedModels}
            onChange={values => updateForm(d => ({ ...d, allowedModels: values }))}
          />
        </Card>

        <Card title="Chính sách trích dẫn & bằng chứng">
          <div className={styles.fieldStack}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={form.citationPolicy.required}
                onChange={e => updateForm(d => ({ ...d, citationPolicy: { ...d.citationPolicy, required: e.target.checked } }))}
              />
              Bắt buộc trích dẫn nguồn cho mọi kết luận
            </label>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={form.citationPolicy.rejectIfMissing}
                onChange={e => updateForm(d => ({ ...d, citationPolicy: { ...d.citationPolicy, rejectIfMissing: e.target.checked } }))}
              />
              Từ chối kết luận nếu thiếu trích dẫn
            </label>
            <PolicyField
              label="Ngưỡng tin cậy tối thiểu"
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={form.citationPolicy.minimumConfidence}
              onChange={e =>
                updateForm(d => ({ ...d, citationPolicy: { ...d.citationPolicy, minimumConfidence: Number(e.target.value) } }))
              }
            />
            <ListEditor
              label="Loại nguồn được chấp nhận"
              placeholder="vd. INTERNAL_POLICY"
              values={form.citationPolicy.allowedSourceTypes}
              onChange={values => updateForm(d => ({ ...d, citationPolicy: { ...d.citationPolicy, allowedSourceTypes: values } }))}
            />
          </div>
        </Card>

        <Card title="Xuất bản phiên bản chính sách" className={styles.publishCard}>
          <div className={styles.fieldStack}>
            <PolicyField
              label="Phiên bản"
              error={errors.version}
              value={form.version}
              onChange={e => updateForm(d => ({ ...d, version: e.target.value }))}
            />
            <PolicyField
              label="Hiệu lực từ"
              error={errors.effectiveFrom}
              type="datetime-local"
              value={form.effectiveFrom.slice(0, 16)}
              onChange={e => updateForm(d => ({ ...d, effectiveFrom: new Date(e.target.value).toISOString() }))}
            />
          </div>

          {saveMessage && (
            <p className={saveState === "success" ? styles.successMessage : styles.errorMessage}>{saveMessage}</p>
          )}

          <div className={styles.publishActions}>
            {config && <Badge tone="neutral">Hiện tại: {config.version}</Badge>}
            <Button onClick={handlePublish} isLoading={saveState === "saving"}>
              <SlidersHorizontal size={14} /> Xuất bản chính sách mới
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
};
