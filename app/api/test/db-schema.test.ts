import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { drizzle } from "drizzle-orm/aws-data-api/pg";
import { sql } from "drizzle-orm";
import { users, userRoleEnum } from "../db/schema";

describe("users insert against the aws-data-api pg driver", () => {
  const db = drizzle(new RDSDataClient({}), {
    database: "test",
    resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:test",
    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
  });

  it("casts the role value to the user_role enum instead of leaving it as bare text", () => {
    // The aws-data-api driver binds string values without a Postgres type OID
    // (unlike node-postgres/postgres-js, which lets the wire protocol infer the
    // enum type from the target column). Without an explicit cast here, Postgres
    // rejects the insert with: column "role" is of type user_role but expression
    // is of type text.
    const { sql: generatedSql } = db
      .insert(users)
      .values({
        id: "sub-1",
        email: "a@example.com",
        name: "A",
        role: sql`${"USER"}::${sql.raw(userRoleEnum.enumName)}`,
      })
      .toSQL();

    expect(generatedSql).toContain(`::${userRoleEnum.enumName}`);
  });
});
