# STORAGE_AND_UPLOADS_SPEC

## Goal

Central DMS for all modules — not project-photo-only.

## Phase 1 (this session)

- Tables: `documents`, `document_versions`, `storage_usage`, `upload_sessions`
- Allowed MIME + magic-byte policy (server)
- Configurable size limits by category / plan / tenant override
- Soft-delete + retention fields
- Private bucket path convention: `tenants/{tenant_id}/documents/{document_id}/{version_id}`
- Signed URL issuance only after server authz + quota check

## Default size caps (configurable)

| Category | Start limit |
|---|---:|
| photo | 20 MB |
| document | 50 MB |
| spreadsheet | 50 MB |
| video | 500 MB |
| zip | 100 MB |
| audio | 100 MB |

## Forbidden

Executables, scripts-as-upload, HTML/SVG as trusted download without sanitization, public permanent URLs for confidential files.

## Not yet

Antivirus worker, multipart resumable across providers, HEIC conversion pipeline, orphan GC job.
