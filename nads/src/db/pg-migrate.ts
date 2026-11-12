import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS = [
  "001_init.sql",
  "002_automation_executor.sql",
  "003_webhook_receipts_hardening.sql",
  "004_completion_claim_leases.sql",
] as const;

export function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../db/migrations");
}

/** Apply NADS SQL migrations in order (idempotent via IF NOT EXISTS). */
export async function applyNadsMigrations(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const dir = migrationsDir();
    for (const name of MIGRATIONS) {
      const sql = await readFile(path.join(dir, name), "utf8");
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

/** Seed a project + task for FK-backed receipt/lease integration tests. */
export async function seedProjectAndTask(
  connectionString: string,
  input: { projectId: string; taskId: string; repoUrl?: string },
): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `insert into development_projects (id, name, repository_url)
       values ($1::uuid, $2, $3)
       on conflict (id) do nothing`,
      [input.projectId, "nads-test", input.repoUrl ?? "https://github.com/jordymekerss-source/nexora"],
    );
    await client.query(
      `insert into development_tasks (id, project_id, title, description, status)
       values ($1::uuid, $2::uuid, $3, $4, 'AGENT_RUNNING')
       on conflict (id) do nothing`,
      [input.taskId, input.projectId, "integration task", "seed"],
    );
  } finally {
    await client.end();
  }
}

export async function resetNadsTables(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      truncate table task_completion_claims,
                     webhook_receipts,
                     agent_sessions,
                     development_tasks,
                     development_projects
      cascade
    `);
  } catch {
    // Tables may not exist yet — migrations handle create.
  } finally {
    await client.end();
  }
}
