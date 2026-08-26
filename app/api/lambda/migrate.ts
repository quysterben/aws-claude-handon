import type { Handler } from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

interface DbSecret {
  username: string;
  password: string;
}

const CONNECT_TIMEOUT_SECONDS = 30;
const RETRY_DELAY_MS = 5_000;

export const handler: Handler = async () => {
  const secret = await fetchSecret(requireEnv("DB_SECRET_ARN"));

  const sql = postgres({
    host: requireEnv("DB_HOST"),
    port: Number(requireEnv("DB_PORT")),
    database: requireEnv("DB_NAME"),
    username: secret.username,
    password: secret.password,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    max: 1,
  });

  try {
    await runMigrationsWithRetry(sql);
    return { applied: true };
  } finally {
    await sql.end({ timeout: 5 });
  }
};

async function runMigrationsWithRetry(sql: postgres.Sql): Promise<void> {
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: "./db/migrations" });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    await migrate(db, { migrationsFolder: "./db/migrations" });
  }
}

async function fetchSecret(secretArn: string): Promise<DbSecret> {
  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  if (!response.SecretString) {
    throw new Error(`Secret ${secretArn} has no SecretString`);
  }
  return JSON.parse(response.SecretString) as DbSecret;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}
