export const errorDefinitions = {
  INTERNAL_ERROR: [1, "发生内部错误。", false],
  INVALID_ARGUMENT: [2, "参数无效，请查看命令帮助。", false],
  CONFIG_INVALID: [2, "配置格式或字段无效。", false],
  CONFIG_IO_ERROR: [2, "无法读写配置文件，请检查目录权限。", false],
  CONTEXT_NOT_FOUND: [2, "未找到所选 context，请先创建并选择环境。", false],
  CREDENTIAL_REQUIRED: [3, "缺少当前环境所需的凭据。", false],
  AUTHENTICATION_FAILED: [3, "凭据验证失败。", false],
  TOKEN_EXPIRED: [3, "凭据已过期，请重新登录。", false],
  PERMISSION_DENIED: [4, "服务端拒绝此操作的权限。", false],
  RESOURCE_NOT_FOUND: [5, "资源不存在。", false],
  CONFLICT: [6, "资源已存在或有并发操作，请重试。", false],
  PRECONDITION_FAILED: [6, "执行前提尚未满足。", false],
  NETWORK_ERROR: [7, "网络请求失败。", true],
  RATE_LIMITED: [7, "请求受到限流。", true],
  UPSTREAM_UNAVAILABLE: [7, "上游服务暂时不可用。", true],
  UPSTREAM_RPC_ERROR: [7, "上游 RPC 返回执行错误。", false],
  CAPABILITY_UNAVAILABLE: [8, "当前能力不可用。", false],
  UPSTREAM_CONTRACT_MISMATCH: [8, "上游响应不符合预期契约。", false],
  TIMEOUT: [9, "操作超时。", true],
  CANCELLED: [130, "操作已取消。", false],
} as const;

export type ErrorCode = keyof typeof errorDefinitions;

/** Messages must be application-owned; never pass raw upstream errors or secrets. */
export class CliError extends Error {
  readonly exitCode: number;
  readonly retryable: boolean;

  constructor(readonly code: ErrorCode, message?: string) {
    const definition = errorDefinitions[code];
    super(message ?? definition[1]);
    this.name = "CliError";
    this.exitCode = definition[0];
    this.retryable = definition[2];
  }
}

export function safeError(error: unknown): CliError {
  return error instanceof CliError ? error : new CliError("INTERNAL_ERROR");
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
