import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

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

/**
 * Persistent (or process-local) webhook receipt / completion-claim store.
 * Claim must be atomic: concurrent identical delivery IDs yield a single winner.
 */
export interface WebhookReceiptStore {
  tryClaim(input: ClaimReceiptInput): Promise<ClaimReceiptResult>;
  has(provider: WebhookProvider, deliveryId: string, projectId: string): Promise<boolean>;
  list(projectId: string): Promise<WebhookReceipt[]>;
}

function hashPayload(raw: string | Buffer | null | undefined): string | null {
  if (raw == null) return null;
  const buf = typeof raw === "string" ? Buffer.from(raw, "utf8") : raw;
  return createHash("sha256").update(buf).digest("hex");
}

export function payloadHashOf(raw: string | Buffer | null | undefined): string | null {
  return hashPayload(raw);
}

/** In-memory atomic claims — suitable for single-process tests and dry-run. */
export class MemoryWebhookReceiptStore implements WebhookReceiptStore {
  private readonly byKey = new Map<string, WebhookReceipt>();

  private key(projectId: string, provider: WebhookProvider, deliveryId: string): string {
    return `${projectId}::${provider}::${deliveryId}`;
  }

  async tryClaim(input: ClaimReceiptInput): Promise<ClaimReceiptResult> {
    const key = this.key(input.projectId, input.provider, input.deliveryId);
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

  async has(provider: WebhookProvider, deliveryId: string, projectId: string): Promise<boolean> {
    return this.byKey.has(this.key(projectId, provider, deliveryId));
  }

  async list(projectId: string): Promise<WebhookReceipt[]> {
    return [...this.byKey.values()].filter((row) => row.projectId === projectId);
  }
}

type FileSnapshot = {
  version: 1;
  receipts: Record<string, WebhookReceipt>;
};

/**
 * Durable file-backed receipts for single-node ops without Postgres.
 * Not a substitute for multi-instance Postgres unique constraints.
 */
export class FileWebhookReceiptStore implements WebhookReceiptStore {
  private snapshot: FileSnapshot = { version: 1, receipts: {} };
  private loaded = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  static defaultPath(cwd = process.cwd()): string {
    return path.join(cwd, ".nads", "webhook-receipts.json");
  }

  private key(projectId: string, provider: WebhookProvider, deliveryId: string): string {
    return `${projectId}::${provider}::${deliveryId}`;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as FileSnapshot;
      if (parsed?.version === 1 && parsed.receipts && typeof parsed.receipts === "object") {
        this.snapshot = parsed;
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
        const key = this.key(input.projectId, input.provider, input.deliveryId);
        const existing = this.snapshot.receipts[key];
        if (existing) {
          return { claimed: false, reason: "duplicate" as const, existing };
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

  async has(provider: WebhookProvider, deliveryId: string, projectId: string): Promise<boolean> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      return Boolean(this.snapshot.receipts[this.key(projectId, provider, deliveryId)]);
    });
  }

  async list(projectId: string): Promise<WebhookReceipt[]> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      return Object.values(this.snapshot.receipts).filter((row) => row.projectId === projectId);
    });
  }
}

export function createWebhookReceiptStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): WebhookReceiptStore {
  const mode = (env.NADS_WEBHOOK_RECEIPT_STORE ?? "memory").trim().toLowerCase();
  if (mode === "file") {
    const filePath = env.NADS_WEBHOOK_RECEIPT_PATH?.trim() || FileWebhookReceiptStore.defaultPath();
    return new FileWebhookReceiptStore(filePath);
  }
  return new MemoryWebhookReceiptStore();
}
