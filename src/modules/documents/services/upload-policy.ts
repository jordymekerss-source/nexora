import type {
  DocumentFileCategory,
  UploadPolicyDecision,
} from "@/modules/documents/types";

const MB = 1024 * 1024;

/** Configurable start limits — Super Admin / plan may tighten or raise within provider caps. */
export const DEFAULT_CATEGORY_LIMITS_BYTES: Readonly<Record<DocumentFileCategory, number>> = {
  photo: 20 * MB,
  document: 50 * MB,
  spreadsheet: 50 * MB,
  video: 500 * MB,
  audio: 100 * MB,
  zip: 100 * MB,
  other: 10 * MB,
};

export const TIER_QUOTA_BYTES: Readonly<Record<string, number>> = {
  basic: 10 * 1024 * MB,
  professional: 100 * 1024 * MB,
  enterprise: 1024 * 1024 * MB,
  custom: 100 * 1024 * MB,
};

const ALLOWED_MIME: Readonly<Record<string, DocumentFileCategory>> = {
  "image/jpeg": "photo",
  "image/png": "photo",
  "image/webp": "photo",
  "image/heic": "photo",
  "image/heif": "photo",
  "application/pdf": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "text/plain": "document",
  "text/csv": "spreadsheet",
  "application/vnd.ms-excel": "spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "spreadsheet",
  "video/mp4": "video",
  "video/webm": "video",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/wav": "audio",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
};

const FORBIDDEN_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".scr",
  ".ps1",
  ".sh",
  ".bash",
  ".js",
  ".mjs",
  ".cjs",
  ".html",
  ".htm",
  ".svg",
  ".php",
  ".jar",
  ".wasm",
]);

/** Magic-byte signatures for common safe types (prefix match). */
const MAGIC: Array<{ mime: string; bytes: number[] }> = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF….WEBP checked separately
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/zip", bytes: [0x50, 0x4b, 0x05, 0x06] },
];

export function normalizeMime(mime: string): string {
  return mime.trim().toLowerCase().split(";")[0] ?? "";
}

export function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx < 0) return "";
  return filename.slice(idx).toLowerCase();
}

export function detectMimeFromMagic(header: Uint8Array): string | null {
  for (const entry of MAGIC) {
    if (header.length < entry.bytes.length) continue;
    let match = true;
    for (let i = 0; i < entry.bytes.length; i += 1) {
      if (header[i] !== entry.bytes[i]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    if (entry.mime === "image/webp") {
      // RIFF....WEBP
      if (header.length >= 12) {
        const tag = String.fromCharCode(header[8]!, header[9]!, header[10]!, header[11]!);
        if (tag !== "WEBP") continue;
      } else {
        continue;
      }
    }
    return entry.mime;
  }
  return null;
}

export function resolveQuotaBytes(
  tier: string,
  overrideBytes: number | null | undefined,
): number {
  if (overrideBytes !== null && overrideBytes !== undefined && overrideBytes > 0) {
    return overrideBytes;
  }
  return TIER_QUOTA_BYTES[tier] ?? TIER_QUOTA_BYTES["basic"]!;
}

export function buildTenantObjectPath(input: {
  tenantId: string;
  documentId: string;
  versionId: string;
  safeExt: string;
}): string {
  const ext = input.safeExt.replace(/[^a-z0-9.]/gi, "").slice(0, 12);
  return `tenants/${input.tenantId}/documents/${input.documentId}/${input.versionId}${ext ? `.${ext.replace(/^\./, "")}` : ""}`;
}

export function evaluateUploadPolicy(input: {
  filename: string;
  declaredMime: string;
  byteSize: number;
  headerBytes?: Uint8Array;
  usedBytes: number;
  quotaBytes: number;
  categoryLimitOverrides?: Partial<Record<DocumentFileCategory, number>>;
}): UploadPolicyDecision {
  if (!input.filename.trim()) {
    return { ok: false, code: "INVALID_NAME", message: "Bestandsnaam ontbreekt." };
  }
  if (input.byteSize <= 0) {
    return { ok: false, code: "EMPTY_FILE", message: "Leeg bestand is niet toegestaan." };
  }

  const ext = extensionOf(input.filename);
  if (FORBIDDEN_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      code: "FORBIDDEN_TYPE",
      message: `Bestandstype ${ext || "(onbekend)"} is niet toegestaan.`,
    };
  }

  let mime = normalizeMime(input.declaredMime);
  if (input.headerBytes && input.headerBytes.length > 0) {
    const magicMime = detectMimeFromMagic(input.headerBytes);
    if (magicMime !== null) {
      if (mime && mime !== magicMime && !(mime === "application/x-zip-compressed" && magicMime === "application/zip")) {
        return {
          ok: false,
          code: "MIME_MISMATCH",
          message: "Declared MIME komt niet overeen met bestandsinhoud.",
        };
      }
      mime = magicMime;
    }
  }

  const category = ALLOWED_MIME[mime];
  if (category === undefined) {
    return {
      ok: false,
      code: "FORBIDDEN_TYPE",
      message: `MIME-type '${mime || "onbekend"}' is niet toegestaan.`,
    };
  }

  const limit =
    input.categoryLimitOverrides?.[category] ?? DEFAULT_CATEGORY_LIMITS_BYTES[category];
  if (input.byteSize > limit) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `Bestand overschrijdt limiet van ${Math.floor(limit / MB)} MB voor ${category}.`,
    };
  }

  if (input.usedBytes + input.byteSize > input.quotaBytes) {
    return {
      ok: false,
      code: "QUOTA_EXCEEDED",
      message: "Opslagquota van de organisatie is overschreden.",
    };
  }

  return { ok: true, category, normalizedMime: mime, maxBytes: limit };
}
