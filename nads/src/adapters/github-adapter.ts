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
