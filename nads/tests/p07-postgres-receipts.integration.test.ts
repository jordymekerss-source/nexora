import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PostgresWebhookReceiptStore,
  createWebhookReceiptStoreFromEnv,
} from "../src/db/webhook-receipts.js";
import {
  applyNadsMigrations,
  resetNadsTables,
  seedProjectAndTask,
} from "../src/db/pg-migrate.js";

const DATABASE_URL =
  process.env.NADS_PG_INTEGRATION_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "postgresql://nads:nads@127.0.0.1:5432/nads_test";

const runPg = (process.env.NADS_PG_INTEGRATION ?? "1").toLowerCase() !== "0";

describe.skipIf(!runPg)("P0.7.2 PostgreSQL WebhookReceiptStore integration", () => {
  let store: PostgresWebhookReceiptStore;
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    await applyNadsMigrations(DATABASE_URL);
    store = PostgresWebhookReceiptStore.fromConnectionString(DATABASE_URL);
    await store.ping();
  }, 60_000);

  afterAll(async () => {
    await store.close();
  });

  beforeEach(async () => {
    await resetNadsTables(DATABASE_URL);
    projectId = randomUUID();
    taskId = randomUUID();
    await seedProjectAndTask(DATABASE_URL, { projectId, taskId });
  });

  it("atomic unique delivery race — only one winner", async () => {
    const input = {
      projectId,
      provider: "github" as const,
      deliveryId: "race-delivery-1",
      eventType: "pull_request:opened",
      taskId,
    };
    const [a, b] = await Promise.all([store.tryClaim(input), store.tryClaim(input)]);
    const claimed = [a, b].filter((row) => row.claimed);
    const dupes = [a, b].filter((row) => !row.claimed && row.reason === "duplicate");
    expect(claimed).toHaveLength(1);
    expect(dupes).toHaveLength(1);
    expect(await store.has("github", "race-delivery-1", projectId)).toBe(true);
  });

  it("duplicate event race across providers stays independent; same provider duplicates", async () => {
    const first = await store.tryClaim({
      projectId,
      provider: "github",
      deliveryId: "evt-1",
      eventType: "pull_request:opened",
      taskId,
    });
    const dup = await store.tryClaim({
      projectId,
      provider: "github",
      deliveryId: "evt-1",
      eventType: "pull_request:synchronize",
      taskId,
    });
    const other = await store.tryClaim({
      projectId,
      provider: "automation_callback",
      deliveryId: "evt-1",
      eventType: "callback:succeeded",
      taskId,
    });
    expect(first.claimed).toBe(true);
    expect(dup.claimed).toBe(false);
    expect(other.claimed).toBe(true);
  });

  it("concurrent completion leases — exclusive winner", async () => {
    const [a, b] = await Promise.all([
      store.tryAcquireCompletionLease({
        projectId,
        taskId,
        provider: "github",
        deliveryId: "d-a",
        leaseOwner: "worker-a",
      }),
      store.tryAcquireCompletionLease({
        projectId,
        taskId,
        provider: "github",
        deliveryId: "d-b",
        leaseOwner: "worker-b",
      }),
    ]);
    const acquired = [a, b].filter((row) => row.acquired);
    const held = [a, b].filter((row) => !row.acquired && row.reason === "held");
    expect(acquired).toHaveLength(1);
    expect(held).toHaveLength(1);
  });

  it("transaction rollback path: release after acquire restores availability", async () => {
    const lease = await store.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "tx-1",
      leaseOwner: "worker-tx",
    });
    expect(lease.acquired).toBe(true);
    const released = await store.releaseCompletionLease({
      projectId,
      taskId,
      leaseOwner: "worker-tx",
      reason: "simulated_downstream_failure",
      status: "failed",
    });
    expect(released).toBe(true);
    const again = await store.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "tx-2",
      leaseOwner: "worker-tx-2",
    });
    expect(again.acquired).toBe(true);
  });

  it("expired lease recovery", async () => {
    const past = new Date(Date.now() - 120_000);
    const first = await store.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "expired",
      leaseOwner: "dead",
      leaseTtlMs: 1,
      now: past,
    });
    expect(first.acquired).toBe(true);
    const recovered = await store.recoverExpiredLeases({ now: new Date(), projectId });
    expect(recovered).toBeGreaterThanOrEqual(1);
    const next = await store.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "fresh",
      leaseOwner: "alive",
    });
    expect(next.acquired).toBe(true);
  });

  it("process restart persistence — receipts survive new store instance", async () => {
    const claimed = await store.tryClaim({
      projectId,
      provider: "github",
      deliveryId: "persist-1",
      eventType: "pull_request:opened",
      taskId,
    });
    expect(claimed.claimed).toBe(true);

    const lease = await store.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "persist-1",
      leaseOwner: "w1",
    });
    expect(lease.acquired).toBe(true);
    await store.finalizeCompletionLease({
      projectId,
      taskId,
      leaseOwner: "w1",
    });

    const restarted = PostgresWebhookReceiptStore.fromConnectionString(DATABASE_URL);
    try {
      const again = await restarted.tryClaim({
        projectId,
        provider: "github",
        deliveryId: "persist-1",
        eventType: "pull_request:opened",
        taskId,
      });
      expect(again.claimed).toBe(false);
      expect(again.reason).toBe("duplicate");

      const leaseAgain = await restarted.tryAcquireCompletionLease({
        projectId,
        taskId,
        provider: "github",
        deliveryId: "persist-2",
        leaseOwner: "w2",
      });
      expect(leaseAgain.acquired).toBe(false);
      if (!leaseAgain.acquired) expect(leaseAgain.reason).toBe("completed");
    } finally {
      await restarted.close();
    }
  });

  it("connection failure fails closed (no silent memory fallback)", async () => {
    const bad = PostgresWebhookReceiptStore.fromConnectionString(
      "postgresql://nads:nads@127.0.0.1:1/does_not_exist",
    );
    try {
      const result = await bad.tryClaim({
        projectId,
        provider: "github",
        deliveryId: "x",
        eventType: "x",
      });
      expect(result.claimed).toBe(false);
      expect(result.reason).toBe("store_unavailable");
    } finally {
      await bad.close().catch(() => undefined);
    }
  });

  it("factory refuses postgres mode without DATABASE_URL", () => {
    expect(() =>
      createWebhookReceiptStoreFromEnv({
        NADS_WEBHOOK_RECEIPT_STORE: "postgres",
        DATABASE_URL: "",
      }),
    ).toThrow(/refusing silent memory fallback/i);
  });

  it("NADS_REQUIRE_PG_RECEIPTS forbids memory", () => {
    expect(() =>
      createWebhookReceiptStoreFromEnv({
        NADS_WEBHOOK_RECEIPT_STORE: "memory",
        NADS_REQUIRE_PG_RECEIPTS: "true",
      }),
    ).toThrow(/forbids memory/i);
  });
});
