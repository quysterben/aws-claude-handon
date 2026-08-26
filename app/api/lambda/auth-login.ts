import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  NotAuthorizedException,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import { computeSecretHash } from "./cognito-secret-hash";

const cognito = new CognitoIdentityProviderClient({});

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
  let payload: { email?: unknown; password?: unknown };
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return jsonResponse(400, { message: "Invalid JSON body" });
  }

  const { email, password } = payload;
  if (typeof email !== "string" || email.length === 0) {
    return jsonResponse(400, { message: "email is required" });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (typeof password !== "string" || password.length === 0) {
    return jsonResponse(400, { message: "password is required" });
  }

  const clientId = requireEnv("COGNITO_CLIENT_ID");
  const clientSecret = requireEnv("COGNITO_CLIENT_SECRET");
  const secretHash = computeSecretHash(normalizedEmail, clientId, clientSecret);

  try {
    const result = await cognito.send(
      new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: clientId,
        AuthParameters: {
          USERNAME: normalizedEmail,
          PASSWORD: password,
          SECRET_HASH: secretHash,
        },
      }),
    );

    const tokens = result.AuthenticationResult;
    if (!tokens?.AccessToken || !tokens.IdToken || !tokens.RefreshToken) {
      throw new Error("Cognito did not return authentication tokens");
    }

    return jsonResponse(200, {
      idToken: tokens.IdToken,
      accessToken: tokens.AccessToken,
      refreshToken: tokens.RefreshToken,
      expiresIn: tokens.ExpiresIn,
    });
  } catch (error) {
    if (
      error instanceof NotAuthorizedException ||
      error instanceof UserNotFoundException
    ) {
      return jsonResponse(401, { message: "invalid email or password" });
    }
    console.error("Cognito login failed", error);
    return jsonResponse(500, { message: "login failed" });
  }
};
