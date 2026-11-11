/**
 * GitHub integration surface (Octokit-compatible intentions).
 * Concrete REST calls use official GitHub API — no invented endpoints.
 * Phase 3 will wire @octokit/rest when GITHUB_TOKEN is present.
 */

export type PullRequestSummary = {
  number: number;
  title: string;
  headRef: string;
  baseRef: string;
  url: string;
  merged: boolean;
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
  getCheckConclusions(ref: string): Promise<Array<{ name: string; conclusion: string | null }>>;
}

/** Safe stub until token-backed Octokit client is configured. */
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
  async getCheckConclusions(): Promise<Array<{ name: string; conclusion: string | null }>> {
    throw new Error("GitHub adapter not configured (set GITHUB_TOKEN)");
  }
}
