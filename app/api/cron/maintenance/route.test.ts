// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const runMaintenance = vi.hoisted(() => vi.fn());
vi.mock("@/lib/maintenance", () => ({ runMaintenance }));

import { GET } from "@/app/api/cron/maintenance/route";
import { env } from "@/lib/env";

const URL = "http://localhost:3000/api/cron/maintenance";
const call = (headers: Record<string, string> = {}) => GET(new Request(URL, { headers }));

beforeEach(() => {
  runMaintenance.mockReset();
  runMaintenance.mockResolvedValue({ remindersSent: 2, emailsSent: 3 });
});

describe("the maintenance endpoint", () => {
  it.each([
    ["no Authorization header", {}],
    ["an empty bearer token", { authorization: "Bearer " }],
    ["the wrong secret", { authorization: "Bearer not-the-secret" }],
    ["the right secret without the Bearer scheme", { authorization: env.CRON_SECRET }],
    ["the right secret under Basic", { authorization: `Basic ${env.CRON_SECRET}` }],
    ["a secret that only starts correctly", { authorization: `Bearer ${env.CRON_SECRET}x` }],
  ])("refuses %s, and runs nothing", async (_label, headers) => {
    const response = await call(headers as Record<string, string>);

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(runMaintenance).not.toHaveBeenCalled();
  });

  it("runs once and reports what it did when the scheduler presents the secret", async () => {
    const response = await call({ authorization: `Bearer ${env.CRON_SECRET}` });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ remindersSent: 2, emailsSent: 3 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(runMaintenance).toHaveBeenCalledTimes(1);
  });
});
