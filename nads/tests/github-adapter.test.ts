import { describe, expect, it, vi } from "vitest";
import {
  HttpGitHubAdapter,
  UnconfiguredGitHubAdapter,
  createGitHubAdapterFromEnv,
} from "../src/adapters/github-adapter.js";

describe("createGitHubAdapterFromEnv", () => {
  it("returns unconfigured without token", () => {
    const adapter = createGitHubAdapterFromEnv({ GITHUB_TOKEN: "", GITHUB_REPO: "a/b" });
    expect(adapter).toBeInstanceOf(UnconfiguredGitHubAdapter);
  });

  it("returns http adapter when token and repo are set", () => {
    const adapter = createGitHubAdapterFromEnv({
      GITHUB_TOKEN: "ghs_test_not_real",
      GITHUB_REPO: "jordymekerss-source/nexora",
    });
    expect(adapter).toBeInstanceOf(HttpGitHubAdapter);
  });
});

describe("HttpGitHubAdapter", () => {
  it("lists open pull requests via official REST path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          number: 12,
          title: "nads",
          html_url: "https://github.com/o/r/pull/12",
          merged_at: null,
          head: { ref: "feat" },
          base: { ref: "main" },
        },
      ],
      text: async () => "",
    });

    const adapter = new HttpGitHubAdapter({
      token: "ghs_test_not_real",
      owner: "o",
      repo: "r",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const prs = await adapter.listOpenPullRequests();
    expect(prs).toEqual([
      {
        number: 12,
        title: "nads",
        headRef: "feat",
        baseRef: "main",
        url: "https://github.com/o/r/pull/12",
        merged: false,
      },
    ]);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/o/r/pulls?state=open&per_page=50");
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);
  });

  it("creates draft PRs only", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        number: 99,
        title: "draft",
        html_url: "https://github.com/o/r/pull/99",
        merged_at: null,
        head: { ref: "head" },
        base: { ref: "cursor/integration" },
      }),
      text: async () => "",
    });

    const adapter = new HttpGitHubAdapter({
      token: "ghs_test_not_real",
      owner: "o",
      repo: "r",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await adapter.createPullRequest({
      title: "draft",
      head: "head",
      base: "cursor/integration",
      body: "nads",
    });

    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.draft).toBe(true);
  });
});
