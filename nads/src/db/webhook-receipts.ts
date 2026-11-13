import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import pg, { type Pool, type PoolClient } from "pg";

export type WebhookProvider = "github" | "automation_callback" | "completion_claim";

export type WebhookReceipt = {
  id: string;
  projectId: string;
  provider: WebhookProvider;
  deliveryId: string;
  eventType: string;
  payloadHash: string | null;
  taskId: string | null;
  processedAt: string;
};

export type ClaimReceiptInput = {
  projectId: string;
  provider: WebhookProvider;
  deliveryId: string;
  eventType: string;
  payloadHash?: string | null;
  taskId?: string | null;
};

export type ClaimReceiptResult =
  | { claimed: true; receipt: WebhookReceipt }
  | { claimed: false; reason: "duplicate" | "store_unavailable"; existing?: WebhookReceipt };

export type CompletionLeaseStatus = "leased" | "completed" | "released" | "failed";

export type CompletionLease = {
  taskId: string;
  projectId: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  status: CompletionLeaseStatus;
  provider: "github" | "automation_callback";
  deliveryId: string;
  payloadHash: string | null;
  claimedAt: string;
  failureReason?: string | null;
};

export type AcquireCompletionLeaseInput = {
  projectId: string;
  taskId: string;
  provider: "github" | "automation_callback";
  deliveryId: string;
  leaseOwner: string;
  leaseTtlMs?: number;
  payloadHash?: string | null;
  now?: Date;
};

export type AcquireCompletionLeaseResult =
  | { acquired: true; lease: CompletionLease }
  | {
      acquired: false;
      reason: "held" | "completed" | "store_unavailable";
      lease?: CompletionLease;
    };

export type ReleaseCompletionLeaseInput = {
  projectId: string;
  taskId: string;
  leaseOwner: string;
  reason: string;
  status?: "released" | "failed";
};

export type FinalizeCompletionLeaseInput = {
  projectId: string;
  taskId: string;
  leaseOwner: string;
};

/** Default exclusive completion lease TTL (15 minutes). */
export const DEFAULT_COMPLETION_LEASE_TTL_MS = 15 * 60_000;

/**
 * Persistent webhook receipt / recoverable completion-lease store.
 * Delivery claims are permanent (idempotent). Completion leases expire and can be released.
 */
export interface WebhookReceiptStore {
  tryClaim(input: ClaimReceiptInput): Promise<ClaimReceiptResult>;
  tryAcquireCompletionLease(
    input: AcquireCompletionLeaseInput,
  ): Promise<AcquireCompletionLeaseResult>;
  releaseCompletionLease(input: ReleaseCompletionLeaseInput): Promise<boolean>;
  finalizeCompletionLease(input: FinalizeCompletionLeaseInput): Promise<boolean>;
  recoverExpiredLeases(options?: { now?: Date; projectId?: string }): Promise<number>;
  has(provider: WebhookProvider, deliveryId: string, projectId: string): Promise<boolean>;
  list(projectId: string): Promise<WebhookReceipt[]>;
  /** Optional: inspect lease state (tests / ops). */
  getCompletionLease?(projectId: string, taskId: string): Promise<CompletionLease | null>;
}

function hashPayload(raw: string | Buffer | null | undefined): string | null {
  if (raw == null) return null;
  const buf = typeof raw === "string" ? Buffer.from(raw, "utf8") : raw;
  return createHash("sha256").update(buf).digest("hex");
}

export function payloadHashOf(raw: string | Buffer | null | undefined): string | null {
  return hashPayload(raw);
}

function receiptKey(projectId: string, provider: WebhookProvider, deliveryId: string): string {
  return `${projectId}::${provider}::${deliveryId}`;
}

function leaseKey(projectId: string, taskId: string): string {
  return `${projectId}::lease::${taskId}`;
}

function isLeaseExpired(lease: CompletionLease, now: Date): boolean {
  return lease.status === "leased" && new Date(lease.leaseExpiresAt).getTime() <= now.getTime();
}

function makeLease(input: AcquireCompletionLeaseInput, now: Date): CompletionLease {
  const ttl = Math.max(1_000, input.leaseTtlMs ?? DEFAULT_COMPLETION_LEASE_TTL_MS);
  return {
    taskId: input.taskId,
    projectId: input.projectId,
    leaseOwner: input.leaseOwner,
    leaseExpiresAt: new Date(now.getTime() + ttl).toISOString(),
    status: "leased",
    provider: input.provider,
    deliveryId: input.deliveryId,
    payloadHash: input.payloadHash ?? null,
    claimedAt: now.toISOString(),
  };
}

/** In-memory atomic claims — suitable for single-process tests and dry-run. */
export class MemoryWebhookReceiptStore implements WebhookReceiptStore {
  private readonly byKey = new Map<string, WebhookReceipt>();
  private readonly leases = new Map<string, CompletionLease>();

  async tryClaim(input: ClaimReceiptInput): Promise<ClaimReceiptResult> {
    const key = receiptKey(input.projectId, input.provider, input.deliveryId);
    const existing = this.byKey.get(key);
    if (existing) {
      return { claimed: false, reason: "duplicate", existing };
    }
    const receipt: WebhookReceipt = {
      id: randomUUID(),
      projectId: input.projectId,
      provider: input.provider,
      deliveryId: input.deliveryId,
      eventType: input.eventType,
      payloadHash: input.payloadHash ?? null,
      taskId: input.taskId ?? null,
      processedAt: new Date().toISOString(),
    };
    this.byKey.set(key, receipt);
    return { claimed: true, receipt };
  }

  async tryAcquireCompletionLease(
    input: AcquireCompletionLeaseInput,
  ): Promise<AcquireCompletionLeaseResult> {
    const now = input.now ?? new Date();
    await this.recoverExpiredLeases({ now, projectId: input.projectId });
    const key = leaseKey(input.projectId, input.taskId);
    const existing = this.leases.get(key);
    if (existing?.status === "completed") {
      return { acquired: false, reason: "completed", lease: existing };
    }
    if (existing?.status === "leased" && !isLeaseExpired(existing, now)) {
      if (existing.leaseOwner === input.leaseOwner) {
        const renewed = makeLease(input, now);
        this.leases.set(key, renewed);
        return { acquired: true, lease: renewed };
      }
      return { acquired: false, reason: "held", lease: existing };
    }
    const lease = makeLease(input, now);
    this.leases.set(key, lease);
    return { acquired: true, lease };
  }

  async releaseCompletionLease(input: ReleaseCompletionLeaseInput): Promise<boolean> {
    const key = leaseKey(input.projectId, input.taskId);
    const existing = this.leases.get(key);
    if (!existing || existing.leaseOwner !== input.leaseOwner) return false;
    if (existing.status === "completed") return false;
    existing.status = input.status ?? "released";
    existing.failureReason = input.reason.slice(0, 400);
    this.leases.delete(key);
    return true;
  }

  async finalizeCompletionLease(input: FinalizeCompletionLeaseInput): Promise<boolean> {
    const key = leaseKey(input.projectId, input.taskId);
    const existing = this.leases.get(key);
    if (!existing || existing.leaseOwner !== input.leaseOwner) return false;
    if (existing.status !== "leased") return false;
    existing.status = "completed";
    this.leases.set(key, existing);
    return true;
  }

  async recoverExpiredLeases(options?: { now?: Date; projectId?: string }): Promise<number> {
    const now = options?.now ?? new Date();
    let recovered = 0;
    for (const [key, lease] of [...this.leases.entries()]) {
      if (options?.projectId && lease.projectId !== options.projectId) continue;
      if (isLeaseExpired(lease, now)) {
        this.leases.delete(key);
        recovered += 1;
      }
    }
    return recovered;
  }

  async has(provider: WebhookProvider, deliveryId: string, projectId: string): Promise<boolean> {
    return this.byKey.has(receiptKey(projectId, provider, deliveryId));
  }

  async list(projectId: string): Promise<WebhookReceipt[]> {
    return [...this.byKey.values()].filter((row) => row.projectId === projectId);
  }

  async getCompletionLease(projectId: string, taskId: string): Promise<CompletionLease | null> {
    return this.leases.get(leaseKey(projectId, taskId)) ?? null;
  }
}

type FileSnapshot = {
  version: 2;
  receipts: Record<string, WebhookReceipt>;
  leases: Record<string, CompletionLease>;
};

/**
 * Durable file-backed receipts for single-node local ops.
 * NOT safe for multi-instance production — use PostgresWebhookReceiptStore.
 */
export class FileWebhookReceiptStore implements WebhookReceiptStore {
  private snapshot: FileSnapshot = { version: 2, receipts: {}, leases: {} };
  private loaded = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  static defaultPath(cwd = process.cwd()): string {
    return path.join(cwd, ".nads", "webhook-receipts.json");
  }

  static readonly multiInstanceWarning =
    "FileWebhookReceiptStore is single-node only and is not safe for multi-instance production. Use NADS_WEBHOOK_RECEIPT_STORE=postgres with DATABASE_URL.";

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<FileSnapshot> & { version?: number };
      if (parsed?.receipts && typeof parsed.receipts === "object") {
        this.snapshot = {
          version: 2,
          receipts: parsed.receipts,
          leases: parsed.leases && typeof parsed.leases === "object" ? parsed.leases : {},
        };
      }
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  private async flush(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(this.snapshot, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async tryClaim(input: ClaimReceiptInput): Promise<ClaimReceiptResult> {
    return this.enqueue(async () => {
      try {
        await this.ensureLoaded();
        const key = receiptKey(input.projectId, input.provider, input.deliveryId);
        const existing = this.snapshot.receipts[key];
        if (existing) {
          return { claimed: false as const, reason: "duplicate" as const, existing };
        }
        const receipt: WebhookReceipt = {
          id: randomUUID(),
          projectId: input.projectId,
          provider: input.provider,
          deliveryId: input.deliveryId,
          eventType: input.eventType,
          payloadHash: input.payloadHash ?? null,
          taskId: input.taskId ?? null,
          processedAt: new Date().toISOString(),
        };
        this.snapshot.receipts[key] = receipt;
        await this.flush();
        return { claimed: true as const, receipt };
      } catch {
        return { claimed: false as const, reason: "store_unavailable" as const };
      }
    });
  }

  async tryAcquireCompletionLease(
    input: AcquireCompletionLeaseInput,
  ): Promise<AcquireCompletionLeaseResult> {
    return this.enqueue(async () => {
      try {
        await this.ensureLoaded();
        const now = input.now ?? new Date();
        await this.recoverExpiredLeasesLocked(now, input.projectId);
        const key = leaseKey(input.projectId, input.taskId);
        const existing = this.snapshot.leases[key];
        if (existing?.status === "completed") {
          return { acquired: false as const, reason: "completed" as const, lease: existing };
        }
        if (existing?.status === "leased" && !isLeaseExpired(existing, now)) {
          if (existing.leaseOwner === input.leaseOwner) {
            const renewed = makeLease(input, now);
            this.snapshot.leases[key] = renewed;
            await this.flush();
            return { acquired: true as const, lease: renewed };
          }
          return { acquired: false as const, reason: "held" as const, lease: existing };
        }
        const lease = makeLease(input, now);
        this.snapshot.leases[key] = lease;
        await this.flush();
        return { acquired: true as const, lease };
      } catch {
        return { acquired: false as const, reason: "store_unavailable" as const };
      }
    });
  }

  async releaseCompletionLease(input: ReleaseCompletionLeaseInput): Promise<boolean> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const key = leaseKey(input.projectId, input.taskId);
      const existing = this.snapshot.leases[key];
      if (!existing || existing.leaseOwner !== input.leaseOwner || existing.status === "completed") {
        return false;
      }
      delete this.snapshot.leases[key];
      await this.flush();
      return true;
    });
  }

  async finalizeCompletionLease(input: FinalizeCompletionLeaseInput): Promise<boolean> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const key = leaseKey(input.projectId, input.taskId);
      const existing = this.snapshot.leases[key];
      if (!existing || existing.leaseOwner !== input.leaseOwner || existing.status !== "leased") {
        return false;
      }
      existing.status = "completed";
      this.snapshot.leases[key] = existing;
      await this.flush();
      return true;
    });
  }

  private async recoverExpiredLeasesLocked(now: Date, projectId?: string): Promise<number> {
    let recovered = 0;
    for (const [key, lease] of Object.entries(this.snapshot.leases)) {
      if (projectId && lease.projectId !== projectId) continue;
      if (isLeaseExpired(lease, now)) {
        delete this.snapshot.leases[key];
        recovered += 1;
      }
    }
    if (recovered > 0) await this.flush();
    return recovered;
  }

  async recoverExpiredLeases(options?: { now?: Date; projectId?: string }): Promise<number> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      return this.recoverExpiredLeasesLocked(options?.now ?? new Date(), options?.projectId);
    });
  }

  async has(provider: WebhookProvider, deliveryId: string, projectId: string): Promise<boolean> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      return Boolean(this.snapshot.receipts[receiptKey(projectId, provider, deliveryId)]);
    });
  }

  async list(projectId: string): Promise<WebhookReceipt[]> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      return Object.values(this.snapshot.receipts).filter((row) => row.projectId === projectId);
    });
  }

  async getCompletionLease(projectId: string, taskId: string): Promise<CompletionLease | null> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      return this.snapshot.leases[leaseKey(projectId, taskId)] ?? null;
    });
  }
}

function mapPgLease(row: Record<string, unknown>): CompletionLease {
  return {
    taskId: String(row.task_id),
    projectId: String(row.project_id),
    leaseOwner: String(row.lease_owner ?? ""),
    leaseExpiresAt: new Date(String(row.lease_expires_at)).toISOString(),
    status: String(row.status) as CompletionLeaseStatus,
    provider: String(row.provider) as "github" | "automation_callback",
    deliveryId: String(row.delivery_id),
    payloadHash: row.payload_hash == null ? null : String(row.payload_hash),
    claimedAt: new Date(String(row.claimed_at)).toISOString(),
    failureReason: row.failure_reason == null ? null : String(row.failure_reason),
  };
}

/**
 * Production PostgreSQL-backed receipts + exclusive completion leases.
 * Uses INSERT ... ON CONFLICT and transactional lease recovery.
 * Never falls back to memory.
 */
export class PostgresWebhookReceiptStore implements WebhookReceiptStore {
  constructor(private readonly pool: Pool) {}

  static fromConnectionString(
    connectionString: string,
    options?: { max?: number },
  ): PostgresWebhookReceiptStore {
    const pool = new pg.Pool({
      connectionString,
      max: options?.max ?? 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    return new PostgresWebhookReceiptStore(pool);
  }

  /** Fail-fast connectivity check (optional; store methods already fail closed). */
  async ping(): Promise<void> {
    const client = await this.pool.connect();
    client.release();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async tryClaim(input: ClaimReceiptInput): Promise<ClaimReceiptResult> {
    try {
      return await this.withClient(async (client) => {
        const inserted = await client.query(
          `insert into webhook_receipts
             (project_id, provider, delivery_id, event_type, payload_hash, task_id, status)
           values ($1::uuid, $2, $3, $4, $5, $6::uuid, 'processed')
           on conflict (project_id, provider, delivery_id) do nothing
           returning id, project_id, provider, delivery_id, event_type, payload_hash, task_id, processed_at`,
          [
            input.projectId,
            input.provider,
            input.deliveryId,
            input.eventType,
            input.payloadHash ?? null,
            input.taskId ?? null,
          ],
        );
        if (inserted.rowCount && inserted.rows[0]) {
          const row = inserted.rows[0] as Record<string, unknown>;
          return {
            claimed: true as const,
            receipt: {
              id: String(row.id),
              projectId: String(row.project_id),
              provider: String(row.provider) as WebhookProvider,
              deliveryId: String(row.delivery_id),
              eventType: String(row.event_type),
              payloadHash: row.payload_hash == null ? null : String(row.payload_hash),
              taskId: row.task_id == null ? null : String(row.task_id),
              processedAt: new Date(String(row.processed_at)).toISOString(),
            },
          };
        }
        const existing = await client.query(
          `select id, project_id, provider, delivery_id, event_type, payload_hash, task_id, processed_at
             from webhook_receipts
            where project_id = $1::uuid and provider = $2 and delivery_id = $3`,
          [input.projectId, input.provider, input.deliveryId],
        );
        const row = existing.rows[0] as Record<string, unknown> | undefined;
        return {
          claimed: false as const,
          reason: "duplicate" as const,
          existing: row
            ? {
                id: String(row.id),
                projectId: String(row.project_id),
                provider: String(row.provider) as WebhookProvider,
                deliveryId: String(row.delivery_id),
                eventType: String(row.event_type),
                payloadHash: row.payload_hash == null ? null : String(row.payload_hash),
                taskId: row.task_id == null ? null : String(row.task_id),
                processedAt: new Date(String(row.processed_at)).toISOString(),
              }
            : undefined,
        };
      });
    } catch {
      return { claimed: false, reason: "store_unavailable" };
    }
  }

  async tryAcquireCompletionLease(
    input: AcquireCompletionLeaseInput,
  ): Promise<AcquireCompletionLeaseResult> {
    const now = input.now ?? new Date();
    const ttl = Math.max(1_000, input.leaseTtlMs ?? DEFAULT_COMPLETION_LEASE_TTL_MS);
    const expiresAt = new Date(now.getTime() + ttl);
    try {
      return await this.withClient(async (client) => {
        await client.query("begin");
        try {
          // Atomic upsert: insert new lease, or take over expired/released/failed,
          // or renew same owner. Active foreign leases and completed rows are untouched.
          const upsert = await client.query(
            `insert into task_completion_claims
               (task_id, project_id, provider, delivery_id, claimed_at,
                lease_owner, lease_expires_at, status, payload_hash, updated_at)
             values ($1::uuid, $2::uuid, $3, $4, $5::timestamptz,
                     $6, $7::timestamptz, 'leased', $8, now())
             on conflict (task_id) do update set
               provider = excluded.provider,
               delivery_id = excluded.delivery_id,
               claimed_at = excluded.claimed_at,
               lease_owner = excluded.lease_owner,
               lease_expires_at = excluded.lease_expires_at,
               status = 'leased',
               payload_hash = excluded.payload_hash,
               failure_reason = null,
               completed_at = null,
               updated_at = now()
             where task_completion_claims.status in ('released', 'failed')
                or (
                  task_completion_claims.status = 'leased'
                  and (
                    task_completion_claims.lease_expires_at <= $5::timestamptz
                    or task_completion_claims.lease_owner = excluded.lease_owner
                  )
                )
             returning task_id, project_id, provider, delivery_id, claimed_at,
                       lease_owner, lease_expires_at, status, payload_hash, failure_reason`,
            [
              input.taskId,
              input.projectId,
              input.provider,
              input.deliveryId,
              now.toISOString(),
              input.leaseOwner,
              expiresAt.toISOString(),
              input.payloadHash ?? null,
            ],
          );

          if (upsert.rowCount && upsert.rows[0]) {
            await client.query("commit");
            return {
              acquired: true as const,
              lease: mapPgLease(upsert.rows[0] as Record<string, unknown>),
            };
          }

          const existing = await client.query(
            `select task_id, project_id, provider, delivery_id, claimed_at,
                    lease_owner, lease_expires_at, status, payload_hash, failure_reason
               from task_completion_claims
              where task_id = $1::uuid
              for update`,
            [input.taskId],
          );
          await client.query("commit");
          if (existing.rowCount && existing.rows[0]) {
            const lease = mapPgLease(existing.rows[0] as Record<string, unknown>);
            if (lease.status === "completed") {
              return { acquired: false as const, reason: "completed" as const, lease };
            }
            return { acquired: false as const, reason: "held" as const, lease };
          }
          return { acquired: false as const, reason: "store_unavailable" as const };
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      });
    } catch {
      return { acquired: false, reason: "store_unavailable" };
    }
  }

  async releaseCompletionLease(input: ReleaseCompletionLeaseInput): Promise<boolean> {
    try {
      return await this.withClient(async (client) => {
        const result = await client.query(
          `delete from task_completion_claims
            where task_id = $1::uuid
              and project_id = $2::uuid
              and lease_owner = $3
              and status = 'leased'`,
          [input.taskId, input.projectId, input.leaseOwner],
        );
        return (result.rowCount ?? 0) > 0;
      });
    } catch {
      return false;
    }
  }

  async finalizeCompletionLease(input: FinalizeCompletionLeaseInput): Promise<boolean> {
    try {
      return await this.withClient(async (client) => {
        const result = await client.query(
          `update task_completion_claims
              set status = 'completed',
                  completed_at = now(),
                  updated_at = now(),
                  failure_reason = null
            where task_id = $1::uuid
              and project_id = $2::uuid
              and lease_owner = $3
              and status = 'leased'`,
          [input.taskId, input.projectId, input.leaseOwner],
        );
        return (result.rowCount ?? 0) > 0;
      });
    } catch {
      return false;
    }
  }

  async recoverExpiredLeases(options?: { now?: Date; projectId?: string }): Promise<number> {
    const now = options?.now ?? new Date();
    try {
      return await this.withClient(async (client) => {
        const result = options?.projectId
          ? await client.query(
              `delete from task_completion_claims
                where project_id = $1::uuid
                  and status = 'leased'
                  and lease_expires_at <= $2::timestamptz`,
              [options.projectId, now.toISOString()],
            )
          : await client.query(
              `delete from task_completion_claims
                where status = 'leased'
                  and lease_expires_at <= $1::timestamptz`,
              [now.toISOString()],
            );
        return result.rowCount ?? 0;
      });
    } catch {
      return 0;
    }
  }

  async has(provider: WebhookProvider, deliveryId: string, projectId: string): Promise<boolean> {
    try {
      return await this.withClient(async (client) => {
        const result = await client.query(
          `select 1 from webhook_receipts
            where project_id = $1::uuid and provider = $2 and delivery_id = $3
            limit 1`,
          [projectId, provider, deliveryId],
        );
        return (result.rowCount ?? 0) > 0;
      });
    } catch {
      return false;
    }
  }

  async list(projectId: string): Promise<WebhookReceipt[]> {
    try {
      return await this.withClient(async (client) => {
        const result = await client.query(
          `select id, project_id, provider, delivery_id, event_type, payload_hash, task_id, processed_at
             from webhook_receipts
            where project_id = $1::uuid
            order by processed_at asc`,
          [projectId],
        );
        return (result.rows as Record<string, unknown>[]).map((row) => ({
          id: String(row.id),
          projectId: String(row.project_id),
          provider: String(row.provider) as WebhookProvider,
          deliveryId: String(row.delivery_id),
          eventType: String(row.event_type),
          payloadHash: row.payload_hash == null ? null : String(row.payload_hash),
          taskId: row.task_id == null ? null : String(row.task_id),
          processedAt: new Date(String(row.processed_at)).toISOString(),
        }));
      });
    } catch {
      return [];
    }
  }

  async getCompletionLease(projectId: string, taskId: string): Promise<CompletionLease | null> {
    try {
      return await this.withClient(async (client) => {
        const result = await client.query(
          `select task_id, project_id, provider, delivery_id, claimed_at,
                  lease_owner, lease_expires_at, status, payload_hash, failure_reason
             from task_completion_claims
            where project_id = $1::uuid and task_id = $2::uuid`,
          [projectId, taskId],
        );
        if (!result.rowCount) return null;
        return mapPgLease(result.rows[0] as Record<string, unknown>);
      });
    } catch {
      return null;
    }
  }
}

export type ReceiptStoreMode = "memory" | "file" | "postgres";

/**
 * Factory for receipt stores.
 * Production multi-instance: NADS_WEBHOOK_RECEIPT_STORE=postgres + DATABASE_URL.
 * Never silently falls back from postgres to memory.
 */
export function createWebhookReceiptStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): WebhookReceiptStore {
  const mode = (env.NADS_WEBHOOK_RECEIPT_STORE ?? "memory").trim().toLowerCase();
  if (mode === "postgres" || mode === "pg") {
    const url = env.DATABASE_URL?.trim();
    if (!url) {
      throw new Error(
        "NADS_WEBHOOK_RECEIPT_STORE=postgres requires DATABASE_URL — refusing silent memory fallback",
      );
    }
    return PostgresWebhookReceiptStore.fromConnectionString(url);
  }
  if (mode === "file") {
    const filePath = env.NADS_WEBHOOK_RECEIPT_PATH?.trim() || FileWebhookReceiptStore.defaultPath();
    // File mode remains available for single-node local ops only.
    return new FileWebhookReceiptStore(filePath);
  }
  if (mode === "memory" || mode === "") {
    if ((env.NADS_REQUIRE_PG_RECEIPTS ?? "").toLowerCase() === "true") {
      throw new Error(
        "NADS_REQUIRE_PG_RECEIPTS=true forbids memory receipt store — set NADS_WEBHOOK_RECEIPT_STORE=postgres and DATABASE_URL",
      );
    }
    return new MemoryWebhookReceiptStore();
  }
  throw new Error(
    `Unknown NADS_WEBHOOK_RECEIPT_STORE=${mode} (expected memory|file|postgres)`,
  );
}
