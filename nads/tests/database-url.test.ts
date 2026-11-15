import { describe, expect, it } from "vitest";
import {
  buildPostgresConnectionString,
  ensureDatabaseUrlEnv,
  resolveDatabaseUrlFromEnv,
} from "../src/config/database-url.js";

describe("DATABASE_URL password encoding", () => {
  it("percent-encodes base64-like passwords with + / =", () => {
    const url = buildPostgresConnectionString({
      user: "nads",
      password: "abc+/=XYZ",
      host: "postgres",
      port: 5432,
      database: "nads",
    });
    expect(url).toBe("postgresql://nads:abc%2B%2F%3DXYZ@postgres:5432/nads");
  });

  it("percent-encodes user and special characters", () => {
    const url = buildPostgresConnectionString({
      user: "n@ds",
      password: "p@ss:word",
      host: "db.example",
      database: "nads",
    });
    expect(url).toContain("n%40ds");
    expect(url).toContain("p%40ss%3Aword");
  });

  it("prefers explicit DATABASE_URL over POSTGRES_*", () => {
    const resolved = resolveDatabaseUrlFromEnv({
      DATABASE_URL: "postgresql://u:p@h:5432/db",
      POSTGRES_PASSWORD: "ignored+/=",
    });
    expect(resolved).toBe("postgresql://u:p@h:5432/db");
  });

  it("builds encoded URL from POSTGRES_* when DATABASE_URL unset", () => {
    const resolved = resolveDatabaseUrlFromEnv({
      POSTGRES_USER: "nads",
      POSTGRES_PASSWORD: "x+y/z=",
      POSTGRES_HOST: "postgres",
      POSTGRES_DB: "nads",
    });
    expect(resolved).toBe("postgresql://nads:x%2By%2Fz%3D@postgres:5432/nads");
  });

  it("ensureDatabaseUrlEnv writes DATABASE_URL when missing", () => {
    const env: NodeJS.ProcessEnv = {
      POSTGRES_PASSWORD: "a+b",
      POSTGRES_USER: "nads",
      POSTGRES_DB: "nads",
    };
    const resolved = ensureDatabaseUrlEnv(env);
    expect(resolved).toContain("%2B");
    expect(env.DATABASE_URL).toBe(resolved);
  });
});
