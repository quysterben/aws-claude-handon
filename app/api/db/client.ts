import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { drizzle } from "drizzle-orm/aws-data-api/pg";
import * as schema from "./schema";

const RESUME_RETRY_DELAY_MS = 15_000;

export function isDatabaseResumingError(error: unknown): boolean {
  return error instanceof Error && error.name === "DatabaseResumingException";
}

export async function withResumeRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isDatabaseResumingError(error)) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, RESUME_RETRY_DELAY_MS));
    return fn();
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!db) {
    const client = new RDSDataClient({});
    db = drizzle(client, {
      database: requireEnv("DB_NAME"),
      resourceArn: requireEnv("DB_RESOURCE_ARN"),
      secretArn: requireEnv("DB_SECRET_ARN"),
      schema,
    });
  }
  return db;
}
