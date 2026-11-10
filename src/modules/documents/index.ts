export {
  DEFAULT_CATEGORY_LIMITS_BYTES,
  TIER_QUOTA_BYTES,
  buildTenantObjectPath,
  detectMimeFromMagic,
  evaluateUploadPolicy,
  extensionOf,
  normalizeMime,
  resolveQuotaBytes,
} from "@/modules/documents/services/upload-policy";
export type {
  DocumentFileCategory,
  UploadPolicyDecision,
  UploadRejectCode,
} from "@/modules/documents/types";
