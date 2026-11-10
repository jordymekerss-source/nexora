import { describe, expect, it } from "vitest";
import {
  buildTenantObjectPath,
  detectMimeFromMagic,
  evaluateUploadPolicy,
  resolveQuotaBytes,
} from "@/modules/documents/services/upload-policy";

describe("upload policy", () => {
  it("rejects executables by extension", () => {
    const result = evaluateUploadPolicy({
      filename: "malware.exe",
      declaredMime: "application/octet-stream",
      byteSize: 100,
      usedBytes: 0,
      quotaBytes: 10_000_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN_TYPE");
  });

  it("accepts PDF within limits", () => {
    const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const result = evaluateUploadPolicy({
      filename: "invoice.pdf",
      declaredMime: "application/pdf",
      byteSize: 1024,
      headerBytes: header,
      usedBytes: 0,
      quotaBytes: 10_000_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.category).toBe("document");
      expect(result.normalizedMime).toBe("application/pdf");
    }
  });

  it("rejects MIME/magic mismatch", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const result = evaluateUploadPolicy({
      filename: "fake.pdf",
      declaredMime: "application/pdf",
      byteSize: 200,
      headerBytes: jpeg,
      usedBytes: 0,
      quotaBytes: 10_000_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MIME_MISMATCH");
  });

  it("enforces quota", () => {
    const result = evaluateUploadPolicy({
      filename: "a.pdf",
      declaredMime: "application/pdf",
      byteSize: 5000,
      usedBytes: 9000,
      quotaBytes: 10_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("QUOTA_EXCEEDED");
  });

  it("builds tenant-scoped object paths", () => {
    expect(
      buildTenantObjectPath({
        tenantId: "t1",
        documentId: "d1",
        versionId: "v1",
        safeExt: "pdf",
      }),
    ).toBe("tenants/t1/documents/d1/v1.pdf");
  });

  it("resolves tier quotas with override", () => {
    expect(resolveQuotaBytes("basic", null)).toBe(10 * 1024 * 1024 * 1024);
    expect(resolveQuotaBytes("basic", 99)).toBe(99);
  });

  it("detects PNG magic", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectMimeFromMagic(png)).toBe("image/png");
  });
});
