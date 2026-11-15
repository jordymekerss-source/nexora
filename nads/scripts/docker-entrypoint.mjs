#!/usr/bin/env node
/**
 * Docker entrypoint: build percent-encoded DATABASE_URL from POSTGRES_* when unset.
 * Preserves a non-empty DATABASE_URL from the environment (operator override).
 */
import { spawn } from "node:child_process";

function buildPostgresConnectionString({ user, password, host, port, database }) {
  const u = encodeURIComponent(user);
  const p = encodeURIComponent(password);
  return `postgresql://${u}:${p}@${host}:${port}/${database}`;
}

const existing = (process.env.DATABASE_URL ?? "").trim();
if (!existing) {
  const password = process.env.POSTGRES_PASSWORD;
  if (password != null && password !== "") {
    const user = (process.env.POSTGRES_USER ?? "nads").trim() || "nads";
    const host = (process.env.POSTGRES_HOST ?? "postgres").trim() || "postgres";
    const database = (process.env.POSTGRES_DB ?? "nads").trim() || "nads";
    const port = (process.env.POSTGRES_PORT ?? "5432").trim() || "5432";
    process.env.DATABASE_URL = buildPostgresConnectionString({
      user,
      password,
      host,
      port,
      database,
    });
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("docker-entrypoint: missing command");
  process.exit(1);
}

const child = spawn(args[0], args.slice(1), {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
