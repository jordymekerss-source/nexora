/**
 * Safe DATABASE_URL construction with percent-encoded credentials.
 * Compose must not interpolate raw passwords into URI userinfo.
 */

export type PostgresUrlParts = {
  user: string;
  password: string;
  host: string;
  port?: number | string;
  database: string;
  sslmode?: string;
};

/** Build a postgresql:// URL with encodeURIComponent on user and password. */
export function buildPostgresConnectionString(parts: PostgresUrlParts): string {
  const user = encodeURIComponent(parts.user);
  const password = encodeURIComponent(parts.password);
  const host = parts.host.trim();
  const port = String(parts.port ?? 5432).trim() || "5432";
  const database = parts.database.trim();
  if (!host || !database) {
    throw new Error("buildPostgresConnectionString requires host and database");
  }
  const base = `postgresql://${user}:${password}@${host}:${port}/${database}`;
  if (parts.sslmode?.trim()) {
    return `${base}?sslmode=${encodeURIComponent(parts.sslmode.trim())}`;
  }
  return base;
}

/**
 * Resolve DATABASE_URL for runtime:
 * - Prefer explicit DATABASE_URL when non-empty (operator override; must already be encoded).
 * - Else build from POSTGRES_* with percent-encoded password.
 */
export function resolveDatabaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.DATABASE_URL?.trim();
  if (explicit) return explicit;

  const password = env.POSTGRES_PASSWORD;
  if (password == null || password === "") return undefined;

  const user = (env.POSTGRES_USER ?? "nads").trim() || "nads";
  const host = (env.POSTGRES_HOST ?? "postgres").trim() || "postgres";
  const database = (env.POSTGRES_DB ?? "nads").trim() || "nads";
  const port = env.POSTGRES_PORT ?? "5432";

  return buildPostgresConnectionString({
    user,
    password,
    host,
    port,
    database,
    sslmode: env.POSTGRES_SSLMODE,
  });
}

/** Ensure process.env.DATABASE_URL is set when POSTGRES_* can build it. */
export function ensureDatabaseUrlEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const resolved = resolveDatabaseUrlFromEnv(env);
  if (resolved && !env.DATABASE_URL?.trim()) {
    env.DATABASE_URL = resolved;
  }
  return resolved;
}
