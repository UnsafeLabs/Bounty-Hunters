// @effect-diagnostics nodeBuiltinImport:off
import NodePath from "node:path";

export const ATTACHMENTS_ROUTE_PREFIX = "/attachments";

export function normalizeAttachmentRelativePath(rawRelativePath: string): string | null {
  const normalized = NodePath.normalize(rawRelativePath).replace(/^[/\\]+/, "");
  if (normalized.length === 0 || normalized.startsWith("..") || normalized.includes("\0")) {
    return null;
  }
  return normalized.replace(/\\/g, "/");
}

export function resolveAttachmentRelativePath(input: {
  readonly attachmentsDir: string;
  readonly relativePath: string;
}): string | null {
  const normalizedRelativePath = normalizeAttachmentRelativePath(input.relativePath);
  if (!normalizedRelativePath) {
    return null;
  }

  const attachmentsRoot = NodePath.resolve(input.attachmentsDir);
  const filePath = NodePath.resolve(NodePath.join(attachmentsRoot, normalizedRelativePath));
  if (!filePath.startsWith(`${attachmentsRoot}${NodePath.sep}`)) {
    return null;
  }
  return filePath;
import { HttpBodyLimit } from "effect/unstable/http";
import { FILE_UPLOAD_BODY_LIMIT } from "./httpCors.ts";

export const ATTACHMENTS_ROUTE_PREFIX = "/attachments";

export const attachmentUploadBodyLimitLayer = HttpBodyLimit.make({
  maxBytes: FILE_UPLOAD_BODY_LIMIT,
});

export function normalizeAttachmentRelativePath(path: string): string { return path; }
export function resolveAttachmentRelativePath(path: string): string { return path; }
}
