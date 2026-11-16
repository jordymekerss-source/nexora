# OFFLINE SYNC ARCHITECTURE

## Goals

Support offline work orders, time/break registration, and photo capture with durable sync.

## Local store

- Expo SQLite (or WatermelonDB) for entities + outbox.
- SecureStore for session tokens / permission snapshot expiry.
- FileSystem for queued photo blobs.

## Outbox

Each mutation: `{ id, type, payload, idempotencyKey, createdAt, attempts, status }`.  
Server RPCs must accept idempotency keys (billing already has `billing_idempotency`; extend pattern).

## Sync

1. On reconnect / app foreground (iOS may not run long background sync).
2. Push outbox in order; retry with backoff.
3. Pull authoritative server state for open assignments.
4. Conflicts: server wins for approved time; client re-queues corrections.

## Permission TTL offline

- Snapshot permissions at last online refresh with `expiresAt` (e.g. 24h for field, shorter for finance).
- Expired snapshot → read-only local view; block new finance/export actions.
- Revoked online permissions fail on next sync push.

## iOS constraints

Do not rely on background fetch for critical sync. Design “sync on open”.
