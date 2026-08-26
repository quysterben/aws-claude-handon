import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { sql } from "drizzle-orm";
import { getDb, withResumeRetry } from "../db/client";

export const handler: APIGatewayProxyHandlerV2 = async () => {
  let db: "ok" | "unreachable" = "ok";
  try {
    await withResumeRetry(() => getDb().execute(sql`SELECT 1`));
  } catch {
    db = "unreachable";
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "ok", db }),
  };
};
