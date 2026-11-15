import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyNadsMigrations,
  resetNadsTables,
  seedProjectAndTask,
} from "../src/db/pg-migrate.js";
import {
  HydratingMemoryStore,
  PostgresTaskRepository,
} from "../src/db/postgres-task-store.js";
import { MemoryWebhookReceiptStore } from "../src/db/webhook-receipts.js";

const DATABASE_URL =
  process.env.NADS_PG_INTEGRATION_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "postgresql://nads:nads@127.0.0.1:55432/nads_test";

const runPg = (process.env.NADS_PG_INTEGRATION ?? "0").toLowerCase() !== "0";

describe.skipIf(!runPg)("phase1 PostgreSQL task store restart persistence", () => {
  let repository: PostgresTaskRepository;
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    await applyNadsMigrations(DATABASE_URL);
    repository = PostgresTaskRepository.fromConnectionString(DATABASE_URL);
  }, 60_000);

  afterAll(async () => {
    await repository.close();
  });

  beforeEach(async () => {
    await resetNadsTables(DATABASE_URL);
    projectId = randomUUID();
    taskId = randomUUID();
    await seedProjectAndTask(DATABASE_URL, {
      projectId,
      taskId,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
    });
  });

  it("persists status + remediation and rehydrates after new store instance", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const store1 = new HydratingMemoryStore(projectId, repository, receipts);
    const task = await store1.ensureTask(taskId);
    expect(task).not.toBeNull();
    task!.status = "REVISION_REQUIRED";
    task!.retryCount = 1;
    task!.lastRejectionSummary = "needs fix";
    task!.lastRequiredChanges = ["Fix src/a.ts"];
    task!.lastRemediationOrder = "# NADS remediation order\nFix src/a.ts";
    task!.lastReviewedHeadSha = "d".repeat(40);
    task!.prNumber = 42;
    task!.headBranch = "cursor/nads-test";
    await store1.persistTask(taskId);

    // Simulate process restart: new HydratingMemoryStore, same Postgres.
    const store2 = new HydratingMemoryStore(projectId, repository, receipts);
    const loaded = await store2.ensureTask(taskId);
    expect(loaded?.status).toBe("REVISION_REQUIRED");
    expect(loaded?.retryCount).toBe(1);
    expect(loaded?.prNumber).toBe(42);
    expect(loaded?.lastRemediationOrder).toContain("Fix src/a.ts");
    expect(loaded?.lastReviewedHeadSha).toBe("d".repeat(40));
  });

  it("resolveProjectId finds seeded project by repo URL", async () => {
    const id = await repository.resolveProjectId({
      NADS_REPO_URL: "https://github.com/jordymekerss-source/nexora",
    });
    expect(id).toBe(projectId);
  });
});
