import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Durable execution journal for restart recovery without requiring Postgres yet.
 * Persists agent/run IDs + iteration so uncertain network failures do not
 * create duplicate agents when a client-supplied agentId is reused.
 */

export type JournalEntry = {
  taskId: string;
  agentId?: string;
  runId?: string;
  iteration: number;
  status: string;
  promptHash?: string;
  branchName?: string;
  prUrl?: string;
  executorKind?: "automation" | "cursor" | "mock";
  prNumber?: number;
  updatedAt: string;
};

export type JournalSnapshot = {
  version: 1;
  entries: Record<string, JournalEntry>;
};

export class ExecutionJournal {
  private snapshot: JournalSnapshot = { version: 1, entries: {} };

  constructor(private readonly filePath: string) {}

  static defaultPath(cwd = process.cwd()): string {
    return path.join(cwd, ".nads", "execution-journal.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as JournalSnapshot;
      if (parsed?.version === 1 && parsed.entries && typeof parsed.entries === "object") {
        this.snapshot = parsed;
      }
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  get(taskId: string): JournalEntry | undefined {
    return this.snapshot.entries[taskId];
  }

  async upsert(entry: JournalEntry): Promise<void> {
    this.snapshot.entries[entry.taskId] = {
      ...entry,
      updatedAt: new Date().toISOString(),
    };
    await this.flush();
  }

  async clear(taskId: string): Promise<void> {
    delete this.snapshot.entries[taskId];
    await this.flush();
  }

  private async flush(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(this.snapshot, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }
}

export function hashPrompt(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return `p${hash.toString(16)}`;
}
