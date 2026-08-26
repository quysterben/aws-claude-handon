import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { sql } from "drizzle-orm";
import { getDb, withResumeRetry } from "../db/client";
import { jsonResponse } from "./helpers/http";

export const handler: APIGatewayProxyHandlerV2 = async () => {
  let db: "ok" | "unreachable" = "ok";
  try {
    await withResumeRetry(() => getDb().execute(sql`SELECT 1`));
  } catch {
    db = "unreachable";
  }

  return jsonResponse(200, { status: "ok", db });
};
