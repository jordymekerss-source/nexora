export type DocumentFileCategory =
  | "photo"
  | "document"
  | "spreadsheet"
  | "video"
  | "audio"
  | "zip"
  | "other";

export type UploadPolicyDecision =
  | { ok: true; category: DocumentFileCategory; normalizedMime: string; maxBytes: number }
  | { ok: false; code: UploadRejectCode; message: string };

export type UploadRejectCode =
  | "FORBIDDEN_TYPE"
  | "MIME_MISMATCH"
  | "FILE_TOO_LARGE"
  | "QUOTA_EXCEEDED"
  | "EMPTY_FILE"
  | "INVALID_NAME";
