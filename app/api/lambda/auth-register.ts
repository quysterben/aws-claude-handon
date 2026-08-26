import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InvalidPasswordException,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import { sql } from "drizzle-orm";
import { getDb, withResumeRetry } from "../db/client";
import { users, userRoleEnum } from "../db/schema";
import { jsonResponse, requireEnv } from "./helpers/http";

const cognito = new CognitoIdentityProviderClient({});

type Role = "ADMIN" | "USER";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let payload: {
    email?: unknown;
    password?: unknown;
    name?: unknown;
  };
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return jsonResponse(400, { message: "Invalid JSON body" });
  }

  const { email, password, name } = payload;

  if (typeof email !== "string" || email.length === 0) {
    return jsonResponse(400, { message: "email is required" });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (typeof password !== "string" || password.length === 0) {
    return jsonResponse(400, { message: "password is required" });
  }
  if (typeof name !== "string" || name.length === 0) {
    return jsonResponse(400, { message: "name is required" });
  }
  const resolvedRole: Role = "USER";

  const userPoolId = requireEnv("COGNITO_USER_POOL_ID");

  let sub: string;
  try {
    const createResult = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: normalizedEmail,
        MessageAction: "SUPPRESS",
        UserAttributes: [
          { Name: "email", Value: normalizedEmail },
          { Name: "email_verified", Value: "true" },
          { Name: "name", Value: name },
          { Name: "custom:role", Value: resolvedRole },
        ],
      }),
    );

    const subAttribute = createResult.User?.Attributes?.find(
      (attr) => attr.Name === "sub",
    );
    if (!subAttribute?.Value) {
      throw new Error("Cognito did not return a sub attribute");
    }
    sub = subAttribute.Value;
  } catch (error) {
    if (error instanceof UsernameExistsException) {
      return jsonResponse(409, { message: "email is already registered" });
    }
    console.error("Cognito register failed", error);
    return jsonResponse(500, { message: "registration failed" });
  }

  try {
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: normalizedEmail,
        Password: password,
        Permanent: true,
      }),
    );
  } catch (error) {
    try {
      await cognito.send(
        new AdminDeleteUserCommand({
          UserPoolId: userPoolId,
          Username: normalizedEmail,
        }),
      );
    } catch (cleanupError) {
      console.error(
        "Failed to roll back Cognito user after AdminSetUserPassword failure — manual cleanup required",
        { sub, cleanupError },
      );
    }

    if (error instanceof InvalidPasswordException) {
      return jsonResponse(400, {
        message:
          "password does not meet the required policy (min 8 characters, with uppercase, lowercase, a digit, and a symbol)",
      });
    }
    console.error("Cognito set password failed", error);
    return jsonResponse(500, { message: "registration failed" });
  }

  try {
    await withResumeRetry(async () => {
      await getDb()
        .insert(users)
        .values({
          id: sub,
          email: normalizedEmail,
          name,
          role: sql`${resolvedRole}::${sql.raw(userRoleEnum.enumName)}`,
        });
    });
  } catch (error) {
    console.error("Postgres profile insert failed after Cognito create", {
      sub,
      error,
    });
    return jsonResponse(500, { message: "registration failed" });
  }

  return jsonResponse(201, {
    id: sub,
    email: normalizedEmail,
    name,
    role: resolvedRole,
  });
};
