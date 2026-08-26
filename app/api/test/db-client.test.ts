import { isDatabaseResumingError, withResumeRetry } from "../db/client";

describe("isDatabaseResumingError", () => {
  it("returns true for an error named DatabaseResumingException", () => {
    const error = new Error("resuming");
    error.name = "DatabaseResumingException";
    expect(isDatabaseResumingError(error)).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isDatabaseResumingError(new Error("boom"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isDatabaseResumingError("boom")).toBe(false);
  });
});

describe("withResumeRetry", () => {
  it("returns the result when the function succeeds on the first try", async () => {
    const fn = jest.fn().mockResolvedValue("ok");

    await expect(withResumeRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once after a DatabaseResumingException and returns the retry's result", async () => {
    jest.useFakeTimers();
    const resumingError = new Error("resuming");
    resumingError.name = "DatabaseResumingException";
    const fn = jest
      .fn()
      .mockRejectedValueOnce(resumingError)
      .mockResolvedValueOnce("ok");

    const promise = withResumeRetry(fn);
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it("rethrows a non-resuming error without retrying", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("boom"));

    await expect(withResumeRetry(fn)).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
