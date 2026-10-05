// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Resend path cannot be exercised in development — it needs a real API
 * key and a verified domain. This pins the request it makes to the shape
 * Resend documents for POST /emails, so the first production send is not also
 * the first time the code runs.
 */

const MESSAGE = {
  to: "author@example.com",
  subject: "Reset your password",
  text: "Plain text body",
};

async function loadWithResend() {
  vi.resetModules();
  vi.stubEnv("EMAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("EMAIL_FROM", "ReviewFlow <noreply@example.com>");
  vi.stubEnv("EMAIL_REPLY_TO", "");
  return import("@/lib/email");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendEmail via Resend", () => {
  it("posts the message to the Resend API with the key as a bearer token", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "abc" }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendEmail } = await loadWithResend();

    await sendEmail(MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_test_key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: "ReviewFlow <noreply@example.com>",
      to: ["author@example.com"],
      subject: "Reset your password",
      text: "Plain text body",
    });
  });

  it("throws, with the provider's reason, when Resend rejects the message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"message":"domain is not verified"}', { status: 403 })),
    );
    const { sendEmail } = await loadWithResend();

    await expect(sendEmail(MESSAGE)).rejects.toThrow(/403.*domain is not verified/);
  });

  it("never puts the API key in the error it throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    const { sendEmail } = await loadWithResend();

    const error = await sendEmail(MESSAGE).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("re_test_key");
  });
});
