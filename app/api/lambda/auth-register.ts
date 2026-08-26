import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import { getDb, withResumeRetry } from "../db/client";
import { users } from "../db/schema";

const cognito = new CognitoIdentityProviderClient({});

type Role = "ADMIN" | "USER";
const VALID_ROLES: Role[] = ["ADMIN", "USER"];

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let payload: {
    email?: unknown;
    password?: unknown;
    name?: unknown;
    role?: unknown;
  };
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return jsonResponse(400, { message: "Invalid JSON body" });
  }

  const { email, password, name, role } = payload;

  if (typeof email !== "string" || email.length === 0) {
    return jsonResponse(400, { message: "email is required" });
  }
  if (typeof password !== "string" || password.length === 0) {
    return jsonResponse(400, { message: "password is required" });
  }
  if (typeof name !== "string" || name.length === 0) {
    return jsonResponse(400, { message: "name is required" });
  }
  const resolvedRole: Role = role === undefined ? "USER" : (role as Role);
  if (!VALID_ROLES.includes(resolvedRole)) {
    return jsonResponse(400, { message: "role must be ADMIN or USER" });
  }

  const userPoolId = requireEnv("COGNITO_USER_POOL_ID");

  let sub: string;
  try {
    const createResult = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        MessageAction: "SUPPRESS",
        UserAttributes: [
          { Name: "email", Value: email },
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

    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: email,
        Password: password,
        Permanent: true,
      }),
    );
  } catch (error) {
    if (error instanceof UsernameExistsException) {
      return jsonResponse(409, { message: "email is already registered" });
    }
    console.error("Cognito register failed", error);
    return jsonResponse(500, { message: "registration failed" });
  }

  try {
    await withResumeRetry(async () => {
      await getDb()
        .insert(users)
        .values({ id: sub, email, name, role: resolvedRole });
    });
  } catch (error) {
    console.error("Postgres profile insert failed after Cognito create", {
      sub,
      error,
    });
    return jsonResponse(500, { message: "registration failed" });
  }

  return jsonResponse(201, { id: sub, email, name, role: resolvedRole });
};
