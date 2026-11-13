import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

/**
 * Durable Automation dispatch state (uncertain / reconcile / correlation binding).
 * Required so ambiguous POST outcomes survive process restarts.
 */
export type DispatchStateRecord = {
  taskId: string;
  projectId: string;
  dispatchOutcome: string | null;
  dispatchUncertain: boolean;
  dispatchReconcileToken: string | null;
  expectedRepoUrl: string | null;
  expectedStartingRef: string | null;
  expectedBranchPrefix: string | null;
  expectedTaskMarker: string | null;
  dispatchIdempotencyKey: string | null;
  updatedAt: string;
};

export type DispatchStateInput = Omit<DispatchStateRecord, "updatedAt"> & {
  updatedAt?: string;
};

export interface DispatchStateStore {
  save(input: DispatchStateInput): Promise<void>;
  load(taskId: string): Promise<DispatchStateRecord | null>;
  /** Clear uncertain flag after explicit reconcile (does not dispatch). */
  markReconciled(taskId: string, token: string): Promise<
    { ok: true; record: DispatchStateRecord } | { ok: false; reason: string }
  >;
}

export class MemoryDispatchStateStore implements DispatchStateStore {
  private readonly byTask = new Map<string, DispatchStateRecord>();

  async save(input: DispatchStateInput): Promise<void> {
    const record: DispatchStateRecord = {
      ...input,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    this.byTask.set(input.taskId, record);
  }

  async load(taskId: string): Promise<DispatchStateRecord | null> {
    return this.byTask.get(taskId) ?? null;
  }

  async markReconciled(
    taskId: string,
    token: string,
  ): Promise<{ ok: true; record: DispatchStateRecord } | { ok: false; reason: string }> {
    const existing = this.byTask.get(taskId);
    if (!existing) return { ok: false, reason: "task_not_found" };
    if (!existing.dispatchUncertain) return { ok: false, reason: "not_uncertain" };
    if (!existing.dispatchReconcileToken || existing.dispatchReconcileToken !== token) {
      return { ok: false, reason: "invalid_reconcile_token" };
    }
    const record: DispatchStateRecord = {
      ...existing,
      dispatchUncertain: false,
      dispatchReconcileToken: null,
      dispatchOutcome: "reconciled",
      updatedAt: new Date().toISOString(),
    };
    this.byTask.set(taskId, record);
    return { ok: true, record };
  }
}

type FileSnapshot = {
  version: 1;
  records: Record<string, DispatchStateRecord>;
};

/** Single-node durable dispatch state. Not multi-instance safe. */
export class FileDispatchStateStore implements DispatchStateStore {
  private snapshot: FileSnapshot = { version: 1, records: {} };
  private loaded = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  static defaultPath(cwd = process.cwd()): string {
    return path.join(cwd, ".nads", "dispatch-state.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as FileSnapshot;
      if (parsed?.version === 1 && parsed.records) this.snapshot = parsed;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  private async flush(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
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

  async save(input: DispatchStateInput): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      this.snapshot.records[input.taskId] = {
        ...input,
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      };
      await this.flush();
    });
  }

  async load(taskId: string): Promise<DispatchStateRecord | null> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      return this.snapshot.records[taskId] ?? null;
    });
  }

  async markReconciled(
    taskId: string,
    token: string,
  ): Promise<{ ok: true; record: DispatchStateRecord } | { ok: false; reason: string }> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const existing = this.snapshot.records[taskId];
      if (!existing) return { ok: false as const, reason: "task_not_found" };
      if (!existing.dispatchUncertain) return { ok: false as const, reason: "not_uncertain" };
      if (!existing.dispatchReconcileToken || existing.dispatchReconcileToken !== token) {
        return { ok: false as const, reason: "invalid_reconcile_token" };
      }
      const record: DispatchStateRecord = {
        ...existing,
        dispatchUncertain: false,
        dispatchReconcileToken: null,
        dispatchOutcome: "reconciled",
        updatedAt: new Date().toISOString(),
      };
      this.snapshot.records[taskId] = record;
      await this.flush();
      return { ok: true as const, record };
    });
  }
}

/** Production dispatch-state persistence on development_tasks columns (migration 004). */
export class PostgresDispatchStateStore implements DispatchStateStore {
  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresDispatchStateStore {
    return new PostgresDispatchStateStore(
      new pg.Pool({
        connectionString,
        max: 5,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
      }),
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async save(input: DispatchStateInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `update development_tasks set
           expected_repo_url = $2,
           expected_starting_ref = $3,
           expected_branch_prefix = $4,
           expected_task_marker = $5,
           dispatch_idempotency_key = coalesce($6, dispatch_idempotency_key),
           dispatch_outcome = $7,
           dispatch_uncertain = $8,
           dispatch_reconcile_token = $9,
           updated_at = now()
         where id = $1::uuid`,
        [
          input.taskId,
          input.expectedRepoUrl,
          input.expectedStartingRef,
          input.expectedBranchPrefix,
          input.expectedTaskMarker,
          input.dispatchIdempotencyKey,
          input.dispatchOutcome,
          input.dispatchUncertain,
          input.dispatchReconcileToken,
        ],
      );
    } finally {
      client.release();
    }
  }

  async load(taskId: string): Promise<DispatchStateRecord | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `select id, project_id, expected_repo_url, expected_starting_ref, expected_branch_prefix,
                expected_task_marker, dispatch_idempotency_key, dispatch_outcome,
                dispatch_uncertain, dispatch_reconcile_token, updated_at
           from development_tasks
          where id = $1::uuid`,
        [taskId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        taskId: String(row.id),
        projectId: String(row.project_id),
        expectedRepoUrl: row.expected_repo_url == null ? null : String(row.expected_repo_url),
        expectedStartingRef:
          row.expected_starting_ref == null ? null : String(row.expected_starting_ref),
        expectedBranchPrefix:
          row.expected_branch_prefix == null ? null : String(row.expected_branch_prefix),
        expectedTaskMarker:
          row.expected_task_marker == null ? null : String(row.expected_task_marker),
        dispatchIdempotencyKey:
          row.dispatch_idempotency_key == null ? null : String(row.dispatch_idempotency_key),
        dispatchOutcome: row.dispatch_outcome == null ? null : String(row.dispatch_outcome),
        dispatchUncertain: Boolean(row.dispatch_uncertain),
        dispatchReconcileToken:
          row.dispatch_reconcile_token == null ? null : String(row.dispatch_reconcile_token),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      };
    } finally {
      client.release();
    }
  }

  async markReconciled(
    taskId: string,
    token: string,
  ): Promise<{ ok: true; record: DispatchStateRecord } | { ok: false; reason: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query(
        `select id, project_id, expected_repo_url, expected_starting_ref, expected_branch_prefix,
                expected_task_marker, dispatch_idempotency_key, dispatch_outcome,
                dispatch_uncertain, dispatch_reconcile_token, updated_at
           from development_tasks
          where id = $1::uuid
          for update`,
        [taskId],
      );
      if (!existing.rowCount) {
        await client.query("rollback");
        return { ok: false, reason: "task_not_found" };
      }
      const row = existing.rows[0] as Record<string, unknown>;
      if (!row.dispatch_uncertain) {
        await client.query("rollback");
        return { ok: false, reason: "not_uncertain" };
      }
      if (String(row.dispatch_reconcile_token ?? "") !== token) {
        await client.query("rollback");
        return { ok: false, reason: "invalid_reconcile_token" };
      }
      await client.query(
        `update development_tasks set
           dispatch_uncertain = false,
           dispatch_reconcile_token = null,
           dispatch_outcome = 'reconciled',
           updated_at = now()
         where id = $1::uuid`,
        [taskId],
      );
      await client.query("commit");
      const loaded = await this.load(taskId);
      if (!loaded) return { ok: false, reason: "task_not_found" };
      return { ok: true, record: loaded };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createDispatchStateStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DispatchStateStore {
  const mode = (env.NADS_DISPATCH_STATE_STORE ?? env.NADS_WEBHOOK_RECEIPT_STORE ?? "memory")
    .trim()
    .toLowerCase();
  if (mode === "postgres" || mode === "pg") {
    const url = env.DATABASE_URL?.trim();
    if (!url) {
      throw new Error(
        "NADS_DISPATCH_STATE_STORE=postgres requires DATABASE_URL — refusing silent memory fallback",
      );
    }
    return PostgresDispatchStateStore.fromConnectionString(url);
  }
  if (mode === "file") {
    const filePath =
      env.NADS_DISPATCH_STATE_PATH?.trim() || FileDispatchStateStore.defaultPath();
    return new FileDispatchStateStore(filePath);
  }
  return new MemoryDispatchStateStore();
}

/** Human-readable dispatch lifecycle label for logs/CLI. */
export function classifyDispatchStatus(input: {
  outcome?: string | null;
  uncertain?: boolean;
  sent?: boolean;
}): "accepted" | "failed" | "uncertain" | "reconciled" | "disabled" | "blocked" | "unknown" {
  if (input.uncertain || input.outcome === "ambiguous_timeout" || input.outcome === "ambiguous_server_error") {
    return "uncertain";
  }
  if (input.outcome === "reconciled") return "reconciled";
  if (input.outcome === "dispatched") return "accepted";
  if (input.outcome === "disabled") return "disabled";
  if (input.outcome === "uncertain_requires_reconcile") return "blocked";
  if (
    input.outcome === "error" ||
    input.outcome === "auth_error" ||
    input.outcome === "validation_error" ||
    input.outcome === "rejected"
  ) {
    return "failed";
  }
  return "unknown";
}
