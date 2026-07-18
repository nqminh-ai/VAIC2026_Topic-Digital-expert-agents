import type { BadgeTone } from "../../components/Badge";
import type { DocumentStatus, DossierStatus } from "../../types/document-intake";

export const dossierStatusTone: Record<DossierStatus, BadgeTone> = {
  COLLECTING: "neutral",
  INCOMPLETE: "warning",
  COMPLETE: "info",
  QUEUED_FOR_SCORING: "info",
  SCORED: "info",
  PENDING_REVIEW: "brand",
  APPROVED: "success",
  REJECTED: "danger",
  NEEDS_MORE_INFO: "warning",
};

export const dossierStatusLabel: Record<DossierStatus, string> = {
  COLLECTING: "Đang thu thập hồ sơ",
  INCOMPLETE: "Thiếu giấy tờ",
  COMPLETE: "Đã đủ hồ sơ",
  QUEUED_FOR_SCORING: "Đang vào hàng đợi đánh giá",
  SCORED: "Đã có kết quả sơ bộ",
  PENDING_REVIEW: "Chờ chuyên viên duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
  NEEDS_MORE_INFO: "Yêu cầu bổ sung",
};

export const documentStatusTone: Record<DocumentStatus, BadgeTone> = {
  UPLOADED: "neutral",
  FORM_REJECTED: "danger",
  FORM_ACCEPTED: "info",
  OCR_PENDING: "info",
  OCR_NEEDS_REVIEW: "warning",
  OCR_COMPLETE: "success",
  OCR_FAILED: "danger",
};

export const documentStatusLabel: Record<DocumentStatus, string> = {
  UPLOADED: "Đã tải lên",
  FORM_REJECTED: "Sai mẫu biểu",
  FORM_ACCEPTED: "Đúng mẫu biểu",
  OCR_PENDING: "Đang OCR",
  OCR_NEEDS_REVIEW: "OCR cần bổ sung",
  OCR_COMPLETE: "OCR hoàn tất",
  OCR_FAILED: "Lỗi OCR",
};

export const loanTypeLabel: Record<"unsecured" | "mortgage", string> = {
  unsecured: "Vay tín chấp",
  mortgage: "Vay thế chấp",
};

// Mirrors backend/src/policy/document-checklist-catalog.json displayName — display-only, not business logic.
export const documentTypeLabel: Record<string, string> = {
  national_id: "CCCD/Hộ chiếu",
  loan_application_unsecured: "Đơn đề nghị vay vốn tín chấp",
  loan_application_mortgage: "Đơn đề nghị vay vốn thế chấp",
  income_confirmation: "Giấy xác nhận thu nhập",
  labor_contract: "Hợp đồng lao động",
  social_insurance_book: "Sổ BHXH",
  cic_report: "Kết quả tra cứu CIC",
  collateral_certificate: "Giấy chứng nhận QSDĐ/QSH nhà",
};

/** camelCase field key -> readable label fallback, for OCR fields not worth a full duplicate catalog on the frontend. */
export const humanizeFieldKey = (key: string): string =>
  key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, char => char.toUpperCase());
