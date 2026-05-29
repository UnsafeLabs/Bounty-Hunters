export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
] as const;

export const browserApiCorsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": browserApiCorsAllowedMethods.join(", "),
  "access-control-allow-headers": browserApiCorsAllowedHeaders.join(", "),
export const DEFAULT_BODY_LIMIT = 10 * 1024 * 1024; // 10MB
export const FILE_UPLOAD_BODY_LIMIT = 50 * 1024 * 1024; // 50MB

export const browserApiCorsAllowedHeaders = ["Content-Type", "Authorization"];
export const browserApiCorsAllowedMethods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];
export const browserApiCorsHeaders = { "Access-Control-Allow-Origin": "*" };
} as const;
