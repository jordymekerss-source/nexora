import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

export type OneShotGateStatus = "armed" | "consumed" | "disarmed";

export type OneShotGateRecord = {
  gateId: string;
  approvedTaskId: string;
  status: OneShotGateStatus;
  armedAt: string;
  consumedAt: string | null;
  consumedBy: string | null;
  lastOutcome: string | null;
  updatedAt: string;
};

export type ConsumeOneShotInput = {
  taskId: string;
  consumer: string;
};

export type ConsumeOneShotResult =
  | { ok: true; record: OneShotGateRecord }
  | {
      ok: false;
      reason:
        | "not_armed"
        | "wrong_task"
        | "already_consumed"
        | "disarmed"
        | "store_unavailable"
        | "missing_gate";
      record?: OneShotGateRecord;
    };

/**
 * Persistent one-time authorization for Automation POST under NADS_SINGLE_TASK_MODE.
 * Consume is atomic — concurrent workers cannot both win.
 */
export interface OneShotDispatchGate {
  arm(approvedTaskId: string): Promise<OneShotGateRecord>;
  disarm(): Promise<OneShotGateRecord | null>;
  tryConsume(input: ConsumeOneShotInput): Promise<ConsumeOneShotResult>;
  get(): Promise<OneShotGateRecord | null>;
  /** Operator re-arm after consume / uncertain — explicit only. */
  rearm(approvedTaskId: string): Promise<OneShotGateRecord>;
}

const GATE_ID = "default";

export class MemoryOneShotDispatchGate implements OneShotDispatchGate {
  private record: OneShotGateRecord | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async arm(approvedTaskId: string): Promise<OneShotGateRecord> {
    return this.enqueue(async () => {
      const now = new Date().toISOString();
      this.record = {
        gateId: GATE_ID,
        approvedTaskId,
        status: "armed",
        armedAt: now,
        consumedAt: null,
        consumedBy: null,
        lastOutcome: null,
        updatedAt: now,
      };
      return this.record;
    });
  }

  async disarm(): Promise<OneShotGateRecord | null> {
    return this.enqueue(async () => {
      if (!this.record) return null;
      this.record = {
        ...this.record,
        status: "disarmed",
        updatedAt: new Date().toISOString(),
      };
      return this.record;
    });
  }

  async tryConsume(input: ConsumeOneShotInput): Promise<ConsumeOneShotResult> {
    return this.enqueue(async () => {
      // Yield so concurrent callers actually contend on the queue.
      await Promise.resolve();
      if (!this.record) return { ok: false as const, reason: "missing_gate" as const };
      if (this.record.status === "consumed") {
        return { ok: false as const, reason: "already_consumed" as const, record: this.record };
      }
      if (this.record.status === "disarmed") {
        return { ok: false as const, reason: "disarmed" as const, record: this.record };
      }
      if (this.record.status !== "armed") {
        return { ok: false as const, reason: "not_armed" as const, record: this.record };
      }
      if (this.record.approvedTaskId !== input.taskId) {
        return { ok: false as const, reason: "wrong_task" as const, record: this.record };
      }
      const now = new Date().toISOString();
      this.record = {
        ...this.record,
        status: "consumed",
        consumedAt: now,
        consumedBy: input.consumer,
        updatedAt: now,
      };
      return { ok: true as const, record: this.record };
    });
  }

  async get(): Promise<OneShotGateRecord | null> {
    return this.enqueue(async () => this.record);
  }

  async rearm(approvedTaskId: string): Promise<OneShotGateRecord> {
    return this.arm(approvedTaskId);
  }
}

type FileSnapshot = { version: 1; record: OneShotGateRecord | null };

export class FileOneShotDispatchGate implements OneShotDispatchGate {
  private snapshot: FileSnapshot = { version: 1, record: null };
  private loaded = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  static defaultPath(cwd = process.cwd()): string {
    return path.join(cwd, ".nads", "one-shot-gate.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as FileSnapshot;
      if (parsed?.version === 1) this.snapshot = parsed;
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

  async arm(approvedTaskId: string): Promise<OneShotGateRecord> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const now = new Date().toISOString();
      this.snapshot.record = {
        gateId: GATE_ID,
        approvedTaskId,
        status: "armed",
        armedAt: now,
        consumedAt: null,
        consumedBy: null,
        lastOutcome: null,
        updatedAt: now,
      };
      await this.flush();
      return this.snapshot.record;
    });
  }

  async disarm(): Promise<OneShotGateRecord | null> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      if (!this.snapshot.record) return null;
      this.snapshot.record = {
        ...this.snapshot.record,
        status: "disarmed",
        updatedAt: new Date().toISOString(),
      };
      await this.flush();
      return this.snapshot.record;
    });
  }

  async tryConsume(input: ConsumeOneShotInput): Promise<ConsumeOneShotResult> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const record = this.snapshot.record;
      if (!record) return { ok: false as const, reason: "missing_gate" as const };
      if (record.status === "consumed") {
        return { ok: false as const, reason: "already_consumed" as const, record };
      }
      if (record.status === "disarmed") {
        return { ok: false as const, reason: "disarmed" as const, record };
      }
      if (record.status !== "armed") {
        return { ok: false as const, reason: "not_armed" as const, record };
      }
      if (record.approvedTaskId !== input.taskId) {
        return { ok: false as const, reason: "wrong_task" as const, record };
      }
      const now = new Date().toISOString();
      this.snapshot.record = {
        ...record,
        status: "consumed",
        consumedAt: now,
        consumedBy: input.consumer,
        updatedAt: now,
      };
      await this.flush();
      return { ok: true as const, record: this.snapshot.record };
    });
  }

  async get(): Promise<OneShotGateRecord | null> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      return this.snapshot.record;
    });
  }

  async rearm(approvedTaskId: string): Promise<OneShotGateRecord> {
    return this.arm(approvedTaskId);
  }
}

function mapRow(row: Record<string, unknown>): OneShotGateRecord {
  return {
    gateId: String(row.gate_id),
    approvedTaskId: String(row.approved_task_id),
    status: String(row.status) as OneShotGateStatus,
    armedAt: new Date(String(row.armed_at)).toISOString(),
    consumedAt: row.consumed_at == null ? null : new Date(String(row.consumed_at)).toISOString(),
    consumedBy: row.consumed_by == null ? null : String(row.consumed_by),
    lastOutcome: row.last_outcome == null ? null : String(row.last_outcome),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export class PostgresOneShotDispatchGate implements OneShotDispatchGate {
  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresOneShotDispatchGate {
    return new PostgresOneShotDispatchGate(
      new pg.Pool({
        connectionString,
        max: 3,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
      }),
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async arm(approvedTaskId: string): Promise<OneShotGateRecord> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `insert into one_shot_dispatch_gates
           (gate_id, approved_task_id, status, armed_at, consumed_at, consumed_by, last_outcome, updated_at)
         values ($1, $2::uuid, 'armed', now(), null, null, null, now())
         on conflict (gate_id) do update set
           approved_task_id = excluded.approved_task_id,
           status = 'armed',
           armed_at = now(),
           consumed_at = null,
           consumed_by = null,
           last_outcome = null,
           updated_at = now()
         returning gate_id, approved_task_id, status, armed_at, consumed_at, consumed_by, last_outcome, updated_at`,
        [GATE_ID, approvedTaskId],
      );
      return mapRow(result.rows[0] as Record<string, unknown>);
    } finally {
      client.release();
    }
  }

  async disarm(): Promise<OneShotGateRecord | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `update one_shot_dispatch_gates
            set status = 'disarmed', updated_at = now()
          where gate_id = $1
          returning gate_id, approved_task_id, status, armed_at, consumed_at, consumed_by, last_outcome, updated_at`,
        [GATE_ID],
      );
      if (!result.rowCount) return null;
      return mapRow(result.rows[0] as Record<string, unknown>);
    } finally {
      client.release();
    }
  }

  async tryConsume(input: ConsumeOneShotInput): Promise<ConsumeOneShotResult> {
    try {
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        const updated = await client.query(
          `update one_shot_dispatch_gates
              set status = 'consumed',
                  consumed_at = now(),
                  consumed_by = $2,
                  updated_at = now()
            where gate_id = $3
              and status = 'armed'
              and approved_task_id = $1::uuid
            returning gate_id, approved_task_id, status, armed_at, consumed_at, consumed_by, last_outcome, updated_at`,
          [input.taskId, input.consumer, GATE_ID],
        );
        if (updated.rowCount && updated.rows[0]) {
          await client.query("commit");
          return { ok: true, record: mapRow(updated.rows[0] as Record<string, unknown>) };
        }
        const existing = await client.query(
          `select gate_id, approved_task_id, status, armed_at, consumed_at, consumed_by, last_outcome, updated_at
             from one_shot_dispatch_gates
            where gate_id = $1
            for update`,
          [GATE_ID],
        );
        await client.query("commit");
        if (!existing.rowCount) return { ok: false, reason: "missing_gate" };
        const record = mapRow(existing.rows[0] as Record<string, unknown>);
        if (record.status === "consumed") return { ok: false, reason: "already_consumed", record };
        if (record.status === "disarmed") return { ok: false, reason: "disarmed", record };
        if (record.approvedTaskId !== input.taskId) return { ok: false, reason: "wrong_task", record };
        return { ok: false, reason: "not_armed", record };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    } catch {
      return { ok: false, reason: "store_unavailable" };
    }
  }

  async get(): Promise<OneShotGateRecord | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `select gate_id, approved_task_id, status, armed_at, consumed_at, consumed_by, last_outcome, updated_at
           from one_shot_dispatch_gates
          where gate_id = $1`,
        [GATE_ID],
      );
      if (!result.rowCount) return null;
      return mapRow(result.rows[0] as Record<string, unknown>);
    } finally {
      client.release();
    }
  }

  async rearm(approvedTaskId: string): Promise<OneShotGateRecord> {
    return this.arm(approvedTaskId);
  }
}

export function createOneShotDispatchGateFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OneShotDispatchGate {
  const mode = (env.NADS_ONE_SHOT_GATE_STORE ?? env.NADS_WEBHOOK_RECEIPT_STORE ?? "memory")
    .trim()
    .toLowerCase();
  if (mode === "postgres" || mode === "pg") {
    const url = env.DATABASE_URL?.trim();
    if (!url) {
      throw new Error(
        "NADS_ONE_SHOT_GATE_STORE=postgres requires DATABASE_URL — refusing silent memory fallback",
      );
    }
    return PostgresOneShotDispatchGate.fromConnectionString(url);
  }
  if (mode === "file") {
    const filePath = env.NADS_ONE_SHOT_GATE_PATH?.trim() || FileOneShotDispatchGate.defaultPath();
    return new FileOneShotDispatchGate(filePath);
  }
  return new MemoryOneShotDispatchGate();
}

/** Read single-task mode policy from env (enforced at dispatch boundary). */
export function readSingleTaskModePolicy(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  approvedTaskId: string | null;
} {
  const enabled = (env.NADS_SINGLE_TASK_MODE ?? "false").toLowerCase() === "true";
  const approvedTaskId = env.NADS_APPROVED_TASK_ID?.trim() || null;
  return { enabled, approvedTaskId };
}
