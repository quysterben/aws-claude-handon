import { computeSecretHash } from "../lambda/helpers/cognito-secret-hash";

describe("computeSecretHash", () => {
  it("matches the known HMAC-SHA256(username + clientId, clientSecret) base64 value", () => {
    const result = computeSecretHash(
      "user@example.com",
      "abc123clientid",
      "supersecretvalue",
    );

    expect(result).toBe("6Wr8aWULmfiprZMVn//q4dYQgvpozKPQriA2fCOTLmI=");
  });

  it("produces different hashes for different usernames", () => {
    const hashA = computeSecretHash(
      "a@example.com",
      "abc123clientid",
      "supersecretvalue",
    );
    const hashB = computeSecretHash(
      "b@example.com",
      "abc123clientid",
      "supersecretvalue",
    );

    expect(hashA).not.toBe(hashB);
  });
});
