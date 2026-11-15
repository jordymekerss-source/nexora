/**
 * Postgres-backed task/project hydration for ingress-serve.
 * Aligns MemoryStore.projectId with development_projects so receipt FKs succeed.
 * Status writes use optimistic concurrency (row_version CAS) — never silent lost updates.
 */
import pg from "pg";
import type { Pool } from "pg";
import { TASK_STATUSES, type TaskStatus } from "../state-machine.js";
import { MemoryStore, type DevelopmentTask } from "./memory-store.js";
import type { WebhookReceiptStore } from "./webhook-receipts.js";
import { resolveDatabaseUrlFromEnv } from "../config/database-url.js";

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "ACCEPTED",
  "NEXT_TASK",
  "BLOCKED",
  "STOPPED",
]);

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Lease settlement performed in the same transaction as a task CAS persist. */
export type LeaseSettlement =
  | { action: "finalize"; leaseOwner: string }
  | { action: "release"; leaseOwner: string; reason: string };

function asTaskStatus(value: string): TaskStatus {
  if ((TASK_STATUSES as readonly string[]).includes(value)) {
    return value as TaskStatus;
  }
  return "READY";
}

export class TaskConcurrencyConflictError extends Error {
  readonly code = "task_concurrency_conflict" as const;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number | null;
  readonly actualStatus: TaskStatus | null;
  readonly reason: string;

  constructor(input: {
    taskId: string;
    expectedVersion: number;
    actualVersion?: number | null;
    actualStatus?: TaskStatus | null;
    reason: string;
  }) {
    super(
      `Task concurrency conflict for ${input.taskId}: ${input.reason} (expectedVersion=${input.expectedVersion}, actualVersion=${input.actualVersion ?? "unknown"}, actualStatus=${input.actualStatus ?? "unknown"})`,
    );
    this.name = "TaskConcurrencyConflictError";
    this.taskId = input.taskId;
    this.expectedVersion = input.expectedVersion;
    this.actualVersion = input.actualVersion ?? null;
    this.actualStatus = input.actualStatus ?? null;
    this.reason = input.reason;
  }
}

export function isTaskConcurrencyConflictError(
  error: unknown,
): error is TaskConcurrencyConflictError {
  return error instanceof TaskConcurrencyConflictError;
}

function mapTaskRow(row: Record<string, unknown>): DevelopmentTask {
  const criteria = row.acceptance_criteria;
  let acceptanceCriteria: string[] = [];
  if (Array.isArray(criteria)) {
    acceptanceCriteria = criteria.map(String);
  } else if (typeof criteria === "string") {
    try {
      const parsed = JSON.parse(criteria) as unknown;
      acceptanceCriteria = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      acceptanceCriteria = [];
    }
  }

  const executorKind = row.executor_kind;
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    priority: Number(row.priority ?? 100),
    category: String(row.category ?? "general"),
    status: asTaskStatus(String(row.status ?? "READY")),
    acceptanceCriteria,
    retryCount: Number(row.retry_count ?? 0),
    maxRetries: Number(row.max_retries ?? 3),
    assignedAgentId: row.assigned_agent_id == null ? undefined : String(row.assigned_agent_id),
    executorKind:
      executorKind === "automation" || executorKind === "cursor" || executorKind === "mock"
        ? executorKind
        : undefined,
    externalExecutionId:
      row.external_execution_id == null ? undefined : String(row.external_execution_id),
    prNumber: row.pr_number == null ? undefined : Number(row.pr_number),
    prUrl: row.pr_url == null ? undefined : String(row.pr_url),
    headBranch: row.head_branch == null ? undefined : String(row.head_branch),
    dispatchIdempotencyKey:
      row.dispatch_idempotency_key == null ? undefined : String(row.dispatch_idempotency_key),
    expectedRepoUrl: row.expected_repo_url == null ? undefined : String(row.expected_repo_url),
    expectedStartingRef:
      row.expected_starting_ref == null ? undefined : String(row.expected_starting_ref),
    expectedBranchPrefix:
      row.expected_branch_prefix == null ? undefined : String(row.expected_branch_prefix),
    expectedTaskMarker:
      row.expected_task_marker == null ? undefined : String(row.expected_task_marker),
    dispatchOutcome: row.dispatch_outcome == null ? undefined : String(row.dispatch_outcome),
    dispatchUncertain: Boolean(row.dispatch_uncertain),
    dispatchReconcileToken:
      row.dispatch_reconcile_token == null ? undefined : String(row.dispatch_reconcile_token),
    rowVersion: Number(row.row_version ?? 0),
  };
}

const TASK_SELECT = `select id, project_id, title, description, priority, category, status,
            acceptance_criteria, assigned_agent_id, retry_count, max_retries,
            executor_kind, external_execution_id, pr_number, pr_url, head_branch,
            dispatch_idempotency_key, expected_repo_url, expected_starting_ref,
            expected_branch_prefix, expected_task_marker, dispatch_outcome,
            dispatch_uncertain, dispatch_reconcile_token, row_version
       from development_tasks`;

export class PostgresTaskRepository {
  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresTaskRepository {
    return new PostgresTaskRepository(
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

  async resolveProjectId(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
    const explicit = env.NADS_PROJECT_ID?.trim();
    if (explicit) {
      const found = await this.pool.query(
        `select id from development_projects where id = $1::uuid`,
        [explicit],
      );
      return found.rowCount ? String(found.rows[0]!.id) : null;
    }

    const repoUrl = env.NADS_REPO_URL?.trim() || env.GITHUB_REPO?.trim();
    if (repoUrl) {
      const normalized = repoUrl.includes("github.com")
        ? repoUrl
        : `https://github.com/${repoUrl}`;
      const byRepo = await this.pool.query(
        `select id from development_projects
          where repository_url = $1 or repository_url = $2
          order by created_at asc
          limit 1`,
        [repoUrl, normalized],
      );
      if (byRepo.rowCount) return String(byRepo.rows[0]!.id);
    }

    const any = await this.pool.query(
      `select id from development_projects where status = 'active' order by created_at asc limit 1`,
    );
    return any.rowCount ? String(any.rows[0]!.id) : null;
  }

  async loadTask(taskId: string): Promise<DevelopmentTask | null> {
    const result = await this.pool.query(`${TASK_SELECT} where id = $1::uuid`, [taskId]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapTaskRow(row) : null;
  }

  /**
   * Persist task snapshot with compare-and-swap on row_version.
   * Optional leaseSettlement updates task_completion_claims in the SAME transaction
   * so a crash cannot finalize/release a lease without a durable task decision
   * (and vice versa for Postgres-backed leases).
   */
  async persistTaskSnapshot(
    task: DevelopmentTask,
    options?: { leaseSettlement?: LeaseSettlement },
  ): Promise<{ rowVersion: number; leaseSettledInTxn: boolean }> {
    const expectedVersion = Number(task.rowVersion ?? 0);
    const client = await this.pool.connect();
    let started = false;
    try {
      await client.query("begin");
      started = true;

      const current = await client.query(
        `select status, row_version from development_tasks where id = $1::uuid for update`,
        [task.id],
      );
      if (!current.rowCount) {
        throw new TaskConcurrencyConflictError({
          taskId: task.id,
          expectedVersion,
          reason: "task_not_found",
        });
      }
      const currentRow = current.rows[0] as { status: string; row_version: string | number };
      const actualVersion = Number(currentRow.row_version ?? 0);
      const actualStatus = asTaskStatus(String(currentRow.status));

      if (actualVersion !== expectedVersion) {
        throw new TaskConcurrencyConflictError({
          taskId: task.id,
          expectedVersion,
          actualVersion,
          actualStatus,
          reason: "row_version_mismatch",
        });
      }

      // Refuse overwriting a terminal DB status with a non-terminal in-memory status
      // (lost-update / stale-cache protection beyond version CAS).
      if (TERMINAL_STATUSES.has(actualStatus) && !TERMINAL_STATUSES.has(task.status)) {
        throw new TaskConcurrencyConflictError({
          taskId: task.id,
          expectedVersion,
          actualVersion,
          actualStatus,
          reason: "terminal_status_overwrite_refused",
        });
      }

      const updated = await client.query(
        `update development_tasks set
           status = $2,
           retry_count = $3,
           assigned_agent_id = $4,
           executor_kind = $5,
           external_execution_id = $6,
           pr_number = $7,
           pr_url = $8,
           head_branch = $9,
           dispatch_idempotency_key = $10,
           expected_repo_url = $11,
           expected_starting_ref = $12,
           expected_branch_prefix = $13,
           expected_task_marker = $14,
           dispatch_outcome = $15,
           dispatch_uncertain = coalesce($16, false),
           dispatch_reconcile_token = $17,
           row_version = row_version + 1,
           updated_at = now(),
           completed_at = case when $2 in ('ACCEPTED', 'NEXT_TASK', 'STOPPED', 'BLOCKED')
             then coalesce(completed_at, now()) else completed_at end
         where id = $1::uuid and row_version = $18
         returning row_version`,
        [
          task.id,
          task.status,
          task.retryCount,
          task.assignedAgentId ?? null,
          task.executorKind ?? null,
          task.externalExecutionId ?? null,
          task.prNumber ?? null,
          task.prUrl ?? null,
          task.headBranch ?? null,
          task.dispatchIdempotencyKey ?? null,
          task.expectedRepoUrl ?? null,
          task.expectedStartingRef ?? null,
          task.expectedBranchPrefix ?? null,
          task.expectedTaskMarker ?? null,
          task.dispatchOutcome ?? null,
          task.dispatchUncertain ?? false,
          task.dispatchReconcileToken ?? null,
          expectedVersion,
        ],
      );

      if (!updated.rowCount) {
        throw new TaskConcurrencyConflictError({
          taskId: task.id,
          expectedVersion,
          actualVersion,
          actualStatus,
          reason: "cas_update_lost_race",
        });
      }

      const newVersion = Number(
        (updated.rows[0] as { row_version: string | number }).row_version,
      );

      // Persist remediation snapshot via existing development_events (no separate migration).
      if (task.lastRemediationOrder || task.lastRejectionSummary || task.lastReviewedHeadSha) {
        const idempotencyKey = `remediation:${task.id}:${task.lastReviewedHeadSha ?? "none"}:${task.retryCount}`;
        await client.query(
          `insert into development_events (project_id, task_id, event_type, payload, idempotency_key)
           values ($1::uuid, $2::uuid, 'task.remediation_snapshot', $3::jsonb, $4)
           on conflict (project_id, idempotency_key) do update
             set payload = excluded.payload`,
          [
            task.projectId,
            task.id,
            JSON.stringify({
              lastRejectionSummary: task.lastRejectionSummary ?? null,
              lastRequiredChanges: task.lastRequiredChanges ?? [],
              lastRemediationOrder: task.lastRemediationOrder ?? null,
              lastReviewedHeadSha: task.lastReviewedHeadSha ?? null,
              status: task.status,
              retryCount: task.retryCount,
              rowVersion: newVersion,
            }),
            idempotencyKey,
          ],
        );
      }

      let leaseSettledInTxn = false;
      const settlement = options?.leaseSettlement;
      if (settlement) {
        if (settlement.action === "finalize") {
          const leaseResult = await client.query(
            `update task_completion_claims
                set status = 'completed',
                    completed_at = now(),
                    updated_at = now(),
                    failure_reason = null
              where task_id = $1::uuid
                and project_id = $2::uuid
                and lease_owner = $3
                and status = 'leased'`,
            [task.id, task.projectId, settlement.leaseOwner],
          );
          leaseSettledInTxn = (leaseResult.rowCount ?? 0) > 0;
        } else {
          const leaseResult = await client.query(
            `delete from task_completion_claims
              where task_id = $1::uuid
                and project_id = $2::uuid
                and lease_owner = $3
                and status = 'leased'`,
            [task.id, task.projectId, settlement.leaseOwner],
          );
          leaseSettledInTxn = (leaseResult.rowCount ?? 0) > 0;
        }
      }

      await client.query("commit");
      started = false;
      return { rowVersion: newVersion, leaseSettledInTxn };
    } catch (error) {
      if (started) {
        try {
          await client.query("rollback");
        } catch {
          // connection may already be aborted
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * If a lease was marked completed but the task never reached a terminal status
   * (legacy crash window), mark the lease failed so another worker can reclaim it.
   */
  async reclaimOrphanCompletedLease(input: {
    projectId: string;
    taskId: string;
  }): Promise<boolean> {
    const task = await this.loadTask(input.taskId);
    if (!task || isTerminalTaskStatus(task.status)) return false;
    const result = await this.pool.query(
      `update task_completion_claims
          set status = 'failed',
              failure_reason = 'orphan_completed_lease_non_terminal_task',
              updated_at = now()
        where project_id = $1::uuid
          and task_id = $2::uuid
          and status = 'completed'`,
      [input.projectId, input.taskId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async loadLatestRemediation(
    projectId: string,
    taskId: string,
  ): Promise<{
    lastRejectionSummary?: string;
    lastRequiredChanges?: string[];
    lastRemediationOrder?: string;
    lastReviewedHeadSha?: string;
  } | null> {
    const result = await this.pool.query(
      `select payload from development_events
        where project_id = $1::uuid and task_id = $2::uuid
          and event_type = 'task.remediation_snapshot'
        order by created_at desc
        limit 1`,
      [projectId, taskId],
    );
    const row = result.rows[0] as { payload?: Record<string, unknown> } | undefined;
    if (!row?.payload) return null;
    const payload = row.payload;
    return {
      lastRejectionSummary:
        typeof payload.lastRejectionSummary === "string"
          ? payload.lastRejectionSummary
          : undefined,
      lastRequiredChanges: Array.isArray(payload.lastRequiredChanges)
        ? payload.lastRequiredChanges.map(String)
        : undefined,
      lastRemediationOrder:
        typeof payload.lastRemediationOrder === "string" ? payload.lastRemediationOrder : undefined,
      lastReviewedHeadSha:
        typeof payload.lastReviewedHeadSha === "string" ? payload.lastReviewedHeadSha : undefined,
    };
  }
}

/**
 * MemoryStore that always reloads tasks from Postgres (no sticky stale cache)
 * and writes status snapshots back with row_version CAS.
 */
export class HydratingMemoryStore extends MemoryStore {
  constructor(
    projectId: string,
    private readonly repository: PostgresTaskRepository,
    receipts?: WebhookReceiptStore,
  ) {
    super(projectId, receipts);
  }

  /**
   * Reload authoritative concurrency fields from Postgres.
   * Always refreshes status/rowVersion/retry — sticky status cache is unsafe.
   * Preserves in-memory-only fields (prompt, local bindings not yet flushed) when DB is null.
   */
  async ensureTask(taskId: string): Promise<DevelopmentTask | null> {
    const loaded = await this.repository.loadTask(taskId);
    if (!loaded) {
      this.tasks = this.tasks.filter((row) => row.id !== taskId);
      return null;
    }
    if (loaded.projectId !== this.projectId) {
      return null;
    }
    const remediation = await this.repository.loadLatestRemediation(this.projectId, taskId);
    if (remediation) {
      loaded.lastRejectionSummary = remediation.lastRejectionSummary;
      loaded.lastRequiredChanges = remediation.lastRequiredChanges;
      loaded.lastRemediationOrder = remediation.lastRemediationOrder;
      loaded.lastReviewedHeadSha = remediation.lastReviewedHeadSha;
    }
    const index = this.tasks.findIndex((row) => row.id === taskId);
    if (index < 0) {
      this.tasks.push(loaded);
      return loaded;
    }
    const existing = this.tasks[index]!;
    // Mutate in place so callers holding the task reference see refreshed status/version.
    existing.status = loaded.status;
    existing.rowVersion = loaded.rowVersion ?? 0;
    existing.retryCount = loaded.retryCount;
    existing.maxRetries = loaded.maxRetries;
    existing.title = loaded.title;
    existing.description = loaded.description;
    existing.priority = loaded.priority;
    existing.category = loaded.category;
    existing.acceptanceCriteria = loaded.acceptanceCriteria;
    existing.assignedAgentId = loaded.assignedAgentId;
    existing.executorKind = loaded.executorKind;
    existing.externalExecutionId = loaded.externalExecutionId;
    existing.prNumber = loaded.prNumber;
    existing.prUrl = loaded.prUrl;
    existing.headBranch = loaded.headBranch;
    existing.dispatchIdempotencyKey = loaded.dispatchIdempotencyKey;
    existing.dispatchOutcome = loaded.dispatchOutcome;
    existing.dispatchUncertain = loaded.dispatchUncertain;
    existing.dispatchReconcileToken = loaded.dispatchReconcileToken;
    // Keep local-only / not-yet-flushed fields when Postgres still has null.
    existing.expectedRepoUrl = loaded.expectedRepoUrl ?? existing.expectedRepoUrl;
    existing.expectedStartingRef = loaded.expectedStartingRef ?? existing.expectedStartingRef;
    existing.expectedBranchPrefix = loaded.expectedBranchPrefix ?? existing.expectedBranchPrefix;
    existing.expectedTaskMarker = loaded.expectedTaskMarker ?? existing.expectedTaskMarker;
    existing.lastRejectionSummary =
      loaded.lastRejectionSummary ?? existing.lastRejectionSummary;
    existing.lastRequiredChanges = loaded.lastRequiredChanges ?? existing.lastRequiredChanges;
    existing.lastRemediationOrder = loaded.lastRemediationOrder ?? existing.lastRemediationOrder;
    existing.lastReviewedHeadSha = loaded.lastReviewedHeadSha ?? existing.lastReviewedHeadSha;
    return existing;
  }

  /**
   * Persist task with CAS. When leaseSettlement is provided it is applied in the
   * same Postgres transaction as the task write.
   */
  async persistTask(
    taskId: string,
    options?: { leaseSettlement?: LeaseSettlement },
  ): Promise<{ rowVersion: number; leaseSettledInTxn: boolean } | undefined> {
    const task = this.tasks.find((row) => row.id === taskId);
    if (!task) return undefined;
    const result = await this.repository.persistTaskSnapshot(task, options);
    task.rowVersion = result.rowVersion;
    return result;
  }

  /**
   * Refresh only rowVersion from Postgres onto the working in-memory task.
   * Dangerous if used after a writer that bumped version without refreshing status —
   * prefer a full ensureTask() or avoid dual-writers on development_tasks.
   */
  async syncRowVersion(taskId: string): Promise<number | null> {
    const task = this.tasks.find((row) => row.id === taskId);
    if (!task) return null;
    const loaded = await this.repository.loadTask(taskId);
    if (!loaded) return null;
    task.rowVersion = loaded.rowVersion ?? 0;
    return task.rowVersion;
  }

  /** Crash recovery: completed lease but non-terminal task → mark lease failed. */
  async reclaimOrphanCompletedLease(taskId: string): Promise<boolean> {
    return this.repository.reclaimOrphanCompletedLease({
      projectId: this.projectId,
      taskId,
    });
  }
}

export async function createIngressTaskStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  receipts?: WebhookReceiptStore,
): Promise<{ store: HydratingMemoryStore; repository: PostgresTaskRepository }> {
  const url = resolveDatabaseUrlFromEnv(env)?.trim();
  if (!url) {
    throw new Error(
      "ingress-serve requires DATABASE_URL or POSTGRES_PASSWORD to build a percent-encoded URL",
    );
  }
  const repository = PostgresTaskRepository.fromConnectionString(url);
  const projectId = await repository.resolveProjectId(env);
  if (!projectId) {
    throw new Error(
      "No development_projects row found — seed a project (NADS_PROJECT_ID or NADS_REPO_URL) before ingress-serve",
    );
  }
  const store = new HydratingMemoryStore(projectId, repository, receipts);
  return { store, repository };
}
