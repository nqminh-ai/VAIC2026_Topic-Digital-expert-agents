export interface PublicOrchestrationError {
  code: "ORCHESTRATION_TIMEOUT" | "DEPENDENCY_UNAVAILABLE" | "INTERNAL_ERROR";
  message: string;
  httpStatus: 500 | 503 | 504;
}

const dependencyErrorCodes = new Set([
  "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN",
  "08000", "08001", "08003", "08006", "57P01", "57P02", "57P03",
]);

const errorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return candidate.cause === error ? undefined : errorCode(candidate.cause);
};

export const toPublicOrchestrationError = (error: unknown): PublicOrchestrationError => {
  const code = errorCode(error);
  const name = error instanceof Error ? error.name : undefined;

  if (name === "TimeoutError" || name === "AbortError" || code === "ABORT_ERR") {
    return {
      code: "ORCHESTRATION_TIMEOUT",
      message: "Quá trình thẩm định vượt quá thời gian cho phép. Vui lòng thử lại; chưa có hành động nghiệp vụ nào được thực hiện.",
      httpStatus: 504,
    };
  }

  if (code && dependencyErrorCodes.has(code)) {
    return {
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Dịch vụ dữ liệu đang tạm thời không khả dụng. Vui lòng kiểm tra kết nối PostgreSQL/Supabase và thử lại.",
      httpStatus: 503,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "Không thể hoàn tất quy trình thẩm định do lỗi hệ thống. Vui lòng thử lại hoặc liên hệ quản trị viên.",
    httpStatus: 500,
  };
};
