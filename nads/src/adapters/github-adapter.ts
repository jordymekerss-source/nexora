/**
 * GitHub integration surface.
 * Concrete REST calls use official GitHub API — no invented endpoints.
 * Docs: https://docs.github.com/en/rest
 */

export type PullRequestSummary = {
  number: number;
  title: string;
  headRef: string;
  baseRef: string;
  url: string;
  merged: boolean;
};

export type CheckConclusion = {
  name: string;
  conclusion: string | null;
};

export type PullRequestDetail = PullRequestSummary & {
  body: string;
  state: string;
  draft: boolean;
  headSha: string;
};

export type PullRequestFile = {
  filename: string;
  status: string;
  patch?: string;
  additions: number;
  deletions: number;
};

export type TaskPullRequestVerification = {
  ok: boolean;
  branchExists: boolean;
  prFound: boolean;
  markerPresent: boolean;
  repositoryMatch: boolean;
  notMerged: boolean;
  draft: boolean | null;
  prNumber: number | null;
  prUrl: string | null;
  headBranch: string | null;
  headSha: string | null;
  checks: CheckConclusion[];
  errors: string[];
};

export interface GitHubAdapter {
  createBranch(name: string, fromRef: string): Promise<void>;
  listOpenPullRequests(): Promise<PullRequestSummary[]>;
  createPullRequest(input: {
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<PullRequestSummary>;
  getCheckConclusions(ref: string): Promise<CheckConclusion[]>;
  getPullRequest?(number: number): Promise<PullRequestDetail>;
  listPullRequestFiles?(number: number): Promise<PullRequestFile[]>;
  /** True when refs/heads/<name> exists. Fail-closed without token. */
  branchExists(name: string): Promise<boolean>;
  /**
   * Independently verify a task's PR/branch evidence on this repository.
   * Requires GITHUB_TOKEN-backed adapter.
   */
  verifyTaskPullRequest(input: {
    taskId?: string;
    taskMarker: string;
    expectedOwner: string;
    expectedRepo: string;
    prNumber?: number | null;
    expectedBranchPrefix?: string | null;
  }): Promise<TaskPullRequestVerification>;
}

/** Parse owner/repo from a github.com HTTPS or SSH URL. */
export function parseGithubRepoUrl(
  repoUrl: string,
): { owner: string; repo: string } | null {
  const trimmed = repoUrl.trim();
  const https = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i);
  if (https) return { owner: https[1]!, repo: https[2]! };
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
  return null;
}

/** Safe stub until token-backed client is configured. */
export class UnconfiguredGitHubAdapter implements GitHubAdapter {
  async createBranch(): Promise<void> {
    throw new Error("GitHub adapter not configured (set GITHUB_TOKEN)");
  }
  async listOpenPullRequests(): Promise<PullRequestSummary[]> {
    throw new Error("GitHub adapter not configured (set GITHUB_TOKEN)");
  }
  async createPullRequest(): Promise<PullRequestSummary> {
    throw new Error("GitHub adapter not configured (set GITHUB_TOKEN)");
  }
  async getCheckConclusions(): Promise<CheckConclusion[]> {
    throw new Error("GitHub adapter not configured (set GITHUB_TOKEN)");
  }
  async getPullRequest(): Promise<PullRequestDetail> {
    throw new Error("GitHub adapter not configured (set GITHUB_TOKEN)");
  }
  async listPullRequestFiles(): Promise<PullRequestFile[]> {
    throw new Error("GitHub adapter not configured (set GITHUB_TOKEN)");
  }
  async branchExists(): Promise<boolean> {
    throw new Error("GitHub adapter not configured (set GITHUB_TOKEN)");
  }
  async verifyTaskPullRequest(): Promise<TaskPullRequestVerification> {
    return {
      ok: false,
      branchExists: false,
      prFound: false,
      markerPresent: false,
      repositoryMatch: false,
      notMerged: false,
      draft: null,
      prNumber: null,
      prUrl: null,
      headBranch: null,
      headSha: null,
      checks: [],
      errors: ["missing_github_token"],
    };
  }
}

export type HttpGitHubAdapterOptions = {
  token: string;
  owner: string;
  repo: string;
  apiBaseUrl?: string;
  /** Injected fetch for unit tests. */
  fetchImpl?: typeof fetch;
};

type GhRefResponse = { object: { sha: string } };
type GhPrResponse = {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  head: { ref: string };
  base: { ref: string };
};
type GhCheckRunsResponse = {
  check_runs: Array<{ name: string; conclusion: string | null }>;
};
type GhPrDetailResponse = {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  body: string | null;
  state: string;
  draft?: boolean;
  head: { ref: string; sha: string };
  base: { ref: string };
};
type GhPrFileResponse = {
  filename: string;
  status: string;
  patch?: string;
  additions: number;
  deletions: number;
};

/**
 * Minimal GitHub REST adapter (server-side control plane only).
 * Never pushes to production/main merge automation in this phase.
 */
export class HttpGitHubAdapter implements GitHubAdapter {
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpGitHubAdapterOptions) {
    if (!options.token) {
      throw new Error("GITHUB_TOKEN is required for HttpGitHubAdapter");
    }
    this.token = options.token;
    this.owner = options.owner;
    this.repo = options.repo;
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "nexora-nads",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      // Never include Authorization header or token in errors.
      throw new Error(`GitHub API ${method} ${path} → ${response.status}: ${text.slice(0, 400)}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private repoPath(suffix: string): string {
    return `/repos/${this.owner}/${this.repo}${suffix}`;
  }

  async createBranch(name: string, fromRef: string): Promise<void> {
    const ref = fromRef.startsWith("refs/") ? fromRef : `heads/${fromRef}`;
    const source = await this.request<GhRefResponse>("GET", this.repoPath(`/git/ref/${ref}`));
    await this.request("POST", this.repoPath("/git/refs"), {
      ref: `refs/heads/${name}`,
      sha: source.object.sha,
    });
  }

  async branchExists(name: string): Promise<boolean> {
    const ref = name.startsWith("refs/") ? name.replace(/^refs\//, "") : `heads/${name}`;
    try {
      await this.request<GhRefResponse>("GET", this.repoPath(`/git/ref/${ref}`));
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      if (/→ 404:/.test(message)) return false;
      throw error;
    }
  }

  async verifyTaskPullRequest(input: {
    taskId?: string;
    taskMarker: string;
    expectedOwner: string;
    expectedRepo: string;
    prNumber?: number | null;
    expectedBranchPrefix?: string | null;
  }): Promise<TaskPullRequestVerification> {
    const errors: string[] = [];
    const ownerMatch =
      this.owner.toLowerCase() === input.expectedOwner.toLowerCase() &&
      this.repo.toLowerCase() === input.expectedRepo.toLowerCase();
    if (!ownerMatch) {
      errors.push(
        `repository_mismatch: adapter ${this.owner}/${this.repo} ≠ expected ${input.expectedOwner}/${input.expectedRepo}`,
      );
    }

    let pr: PullRequestDetail | null = null;
    if (input.prNumber && this.getPullRequest) {
      try {
        pr = await this.getPullRequest(input.prNumber);
      } catch (error: unknown) {
        errors.push(error instanceof Error ? error.message.slice(0, 200) : "getPullRequest failed");
      }
    } else if (input.expectedBranchPrefix) {
      const open = await this.listOpenPullRequests();
      const match = open.find((row) => row.headRef.startsWith(input.expectedBranchPrefix!));
      if (match?.number) {
        pr = (await this.getPullRequest?.(match.number)) ?? null;
      }
    }

    // Marker must appear in the PR body — title/branch alone is not enough (anti-spoof).
    const markerInBody = Boolean(pr?.body.includes(input.taskMarker));
    const spoofedMarker =
      Boolean(pr) &&
      !markerInBody &&
      Boolean(
        pr!.title.includes(input.taskMarker) ||
          pr!.headRef.includes(input.taskMarker.replace("nads-task:", "")),
      );
    if (spoofedMarker) {
      errors.push("spoofed_marker: marker found outside PR body without body correlation");
    }
    if (pr && !markerInBody) {
      errors.push("task_marker_missing_from_pr_body");
    }

    if (input.taskId && pr?.body) {
      const foreign = pr.body.match(
        /nads-task:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/gi,
      );
      if (foreign) {
        for (const hit of foreign) {
          const id = hit.replace(/^nads-task:/i, "");
          if (id.toLowerCase() !== input.taskId.toLowerCase()) {
            errors.push("wrong_task_marker");
            break;
          }
        }
      }
    }

    if (!pr) {
      errors.push("pull_request_not_found");
    }
    if (pr?.merged) {
      errors.push("pull_request_merged");
    }
    if (pr && pr.state !== "open") {
      errors.push(`pull_request_not_open:${pr.state}`);
    }

    const branchName = pr?.headRef ?? null;
    if (input.expectedBranchPrefix) {
      if (!branchName) {
        errors.push("missing_head_branch");
      } else if (!branchName.startsWith(input.expectedBranchPrefix)) {
        errors.push(
          `wrong_branch_prefix: head ${branchName} does not start with ${input.expectedBranchPrefix}`,
        );
      }
    }

    let branchExists = false;
    if (branchName) {
      try {
        branchExists = await this.branchExists(branchName);
      } catch (error: unknown) {
        errors.push(error instanceof Error ? error.message.slice(0, 200) : "branchExists failed");
      }
    }
    if (branchName && !branchExists) {
      errors.push(`branch_missing:${branchName}`);
    }

    const checks =
      pr?.headSha != null ? await this.getCheckConclusions(pr.headSha).catch(() => []) : [];

    const notMerged = Boolean(pr && !pr.merged && pr.state === "open");
    const markerPresent = markerInBody;
    const ok =
      ownerMatch &&
      Boolean(pr) &&
      markerPresent &&
      notMerged &&
      (branchName ? branchExists : false) &&
      (input.expectedBranchPrefix
        ? Boolean(branchName?.startsWith(input.expectedBranchPrefix))
        : true) &&
      errors.length === 0;

    return {
      ok,
      branchExists,
      prFound: Boolean(pr),
      markerPresent,
      repositoryMatch: ownerMatch,
      notMerged,
      draft: pr?.draft ?? null,
      prNumber: pr?.number ?? null,
      prUrl: pr?.url ?? null,
      headBranch: pr?.headRef ?? null,
      headSha: pr?.headSha ?? null,
      checks,
      errors,
    };
  }

  async listOpenPullRequests(): Promise<PullRequestSummary[]> {
    const prs = await this.request<GhPrResponse[]>(
      "GET",
      this.repoPath("/pulls?state=open&per_page=50"),
    );
    return prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
      url: pr.html_url,
      merged: Boolean(pr.merged_at),
    }));
  }

  async createPullRequest(input: {
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<PullRequestSummary> {
    const pr = await this.request<GhPrResponse>("POST", this.repoPath("/pulls"), {
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body,
      draft: true,
    });
    return {
      number: pr.number,
      title: pr.title,
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
      url: pr.html_url,
      merged: Boolean(pr.merged_at),
    };
  }

  async getCheckConclusions(ref: string): Promise<CheckConclusion[]> {
    const data = await this.request<GhCheckRunsResponse>(
      "GET",
      this.repoPath(`/commits/${encodeURIComponent(ref)}/check-runs?per_page=50`),
    );
    return data.check_runs.map((run) => ({
      name: run.name,
      conclusion: run.conclusion,
    }));
  }

  async getPullRequest(number: number): Promise<PullRequestDetail> {
    const pr = await this.request<GhPrDetailResponse>("GET", this.repoPath(`/pulls/${number}`));
    return {
      number: pr.number,
      title: pr.title,
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
      url: pr.html_url,
      merged: Boolean(pr.merged_at),
      body: pr.body ?? "",
      state: pr.state,
      draft: Boolean(pr.draft),
      headSha: pr.head.sha,
    };
  }

  async listPullRequestFiles(number: number): Promise<PullRequestFile[]> {
    const files = await this.request<GhPrFileResponse[]>(
      "GET",
      this.repoPath(`/pulls/${number}/files?per_page=100`),
    );
    return files.map((file) => ({
      filename: file.filename,
      status: file.status,
      patch: file.patch,
      additions: file.additions,
      deletions: file.deletions,
    }));
  }
}

export function createGitHubAdapterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GitHubAdapter {
  const token = env.GITHUB_TOKEN?.trim() ?? "";
  const repoFull = env.GITHUB_REPO?.trim() || "jordymekerss-source/nexora";
  const [owner, repo] = repoFull.split("/");

  if (!token || !owner || !repo) {
    return new UnconfiguredGitHubAdapter();
  }

  return new HttpGitHubAdapter({ token, owner, repo });
}
