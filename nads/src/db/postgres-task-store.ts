/**
 * Postgres-backed task/project hydration for ingress-serve.
 * Aligns MemoryStore.projectId with development_projects so receipt FKs succeed.
 */
import pg from "pg";
import type { Pool } from "pg";
import { TASK_STATUSES, type TaskStatus } from "../state-machine.js";
import { MemoryStore, type DevelopmentTask } from "./memory-store.js";
import type { WebhookReceiptStore } from "./webhook-receipts.js";
import { resolveDatabaseUrlFromEnv } from "../config/database-url.js";

function asTaskStatus(value: string): TaskStatus {
  if ((TASK_STATUSES as readonly string[]).includes(value)) {
    return value as TaskStatus;
  }
  return "READY";
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
  };
}

const TASK_SELECT = `select id, project_id, title, description, priority, category, status,
            acceptance_criteria, assigned_agent_id, retry_count, max_retries,
            executor_kind, external_execution_id, pr_number, pr_url, head_branch,
            dispatch_idempotency_key, expected_repo_url, expected_starting_ref,
            expected_branch_prefix, expected_task_marker, dispatch_outcome,
            dispatch_uncertain, dispatch_reconcile_token
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

  async persistTaskSnapshot(task: DevelopmentTask): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
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
           updated_at = now(),
           completed_at = case when $2 in ('ACCEPTED', 'NEXT_TASK', 'STOPPED', 'BLOCKED')
             then coalesce(completed_at, now()) else completed_at end
         where id = $1::uuid`,
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
        ],
      );

      // Persist remediation snapshot via existing development_events (no new migration).
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
            }),
            idempotencyKey,
          ],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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
 * MemoryStore that lazy-loads tasks from Postgres and writes status snapshots back.
 * projectId must match development_projects.id used by webhook_receipts FK.
 */
export class HydratingMemoryStore extends MemoryStore {
  constructor(
    projectId: string,
    private readonly repository: PostgresTaskRepository,
    receipts?: WebhookReceiptStore,
  ) {
    super(projectId, receipts);
  }

  /** Load task from Postgres into memory if missing; refresh status from DB when absent. */
  async ensureTask(taskId: string): Promise<DevelopmentTask | null> {
    const cached = this.tasks.find((row) => row.id === taskId);
    if (cached) return cached;

    const loaded = await this.repository.loadTask(taskId);
    if (!loaded) return null;
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
    this.tasks.push(loaded);
    return loaded;
  }

  async persistTask(taskId: string): Promise<void> {
    const task = this.tasks.find((row) => row.id === taskId);
    if (!task) return;
    await this.repository.persistTaskSnapshot(task);
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
