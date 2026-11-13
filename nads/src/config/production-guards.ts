/**
 * Fail-closed configuration guards for multi-instance / production NADS.
 * Never silently accept memory/file persistence when production is requested.
 */

export type PersistenceSafetyTier = {
  receipts: "memory" | "file" | "postgres";
  dispatchState: "memory" | "file" | "postgres";
  multiInstanceSafe: boolean;
  notes: string[];
};

export function resolvePersistenceTier(
  env: NodeJS.ProcessEnv = process.env,
): PersistenceSafetyTier {
  const receipts = (env.NADS_WEBHOOK_RECEIPT_STORE ?? "memory").trim().toLowerCase();
  const dispatchRaw = (
    env.NADS_DISPATCH_STATE_STORE ??
    env.NADS_WEBHOOK_RECEIPT_STORE ??
    "memory"
  )
    .trim()
    .toLowerCase();
  const receiptTier =
    receipts === "postgres" || receipts === "pg"
      ? "postgres"
      : receipts === "file"
        ? "file"
        : "memory";
  const dispatchTier =
    dispatchRaw === "postgres" || dispatchRaw === "pg"
      ? "postgres"
      : dispatchRaw === "file"
        ? "file"
        : "memory";
  const notes: string[] = [];
  if (receiptTier === "memory") {
    notes.push("Receipt store=memory — single-process tests/dry-run only");
  }
  if (receiptTier === "file") {
    notes.push("Receipt store=file — single-node only; not multi-instance safe");
  }
  if (dispatchTier !== "postgres") {
    notes.push(
      `Dispatch state store=${dispatchTier} — uncertain dispatches will not survive multi-instance failover unless postgres`,
    );
  }
  return {
    receipts: receiptTier,
    dispatchState: dispatchTier,
    multiInstanceSafe: receiptTier === "postgres" && dispatchTier === "postgres",
    notes,
  };
}

export function isProductionLike(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    (env.NADS_PRODUCTION ?? "").toLowerCase() === "true" ||
    (env.NADS_REQUIRE_PG_RECEIPTS ?? "").toLowerCase() === "true" ||
    ((env.NODE_ENV ?? "").toLowerCase() === "production" &&
      (env.NADS_EXECUTOR ?? "").toLowerCase() === "automation")
  );
}

/**
 * Throws when production-like mode would run with unsafe persistence.
 * Call before starting ingress or enabling Automation send.
 */
export function assertProductionPersistenceConfig(
  env: NodeJS.ProcessEnv = process.env,
): PersistenceSafetyTier {
  const tiers = resolvePersistenceTier(env);
  if (!isProductionLike(env)) return tiers;

  if (tiers.receipts !== "postgres") {
    throw new Error(
      "Production/multi-instance NADS requires NADS_WEBHOOK_RECEIPT_STORE=postgres and DATABASE_URL — refusing memory/file",
    );
  }
  if (tiers.dispatchState !== "postgres") {
    throw new Error(
      "Production/multi-instance NADS requires NADS_DISPATCH_STATE_STORE=postgres (or inherit via receipt store) and DATABASE_URL",
    );
  }
  if (!env.DATABASE_URL?.trim()) {
    throw new Error("Production NADS requires DATABASE_URL — refusing silent memory fallback");
  }
  if ((env.NADS_EXECUTOR ?? "mock").toLowerCase() === "cursor") {
    throw new Error(
      "Production activation path refuses NADS_EXECUTOR=cursor — Automation webhook only (no /v1/agents)",
    );
  }
  return tiers;
}
