// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { authenticate } from "@/lib/auth/login";
import { hashPassword } from "@/lib/auth/password";
import { createSession, validateSessionToken } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { toOwnProfileDTO } from "@/lib/dto/profile";
import {
  changePassword,
  findAvatar,
  findProfile,
  removeAvatar,
  setAvatar,
  updateProfile,
} from "@/lib/profile";
import { cleanUpTestUsers, dbAvailable, testEmail, testIp } from "@/lib/test/db";

const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "a different long password";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const passwordHash = dbAvailable ? await hashPassword(PASSWORD) : "";

async function createUser() {
  return db.user.create({
    data: { email: testEmail("profile"), name: "Test Person", passwordHash },
    select: { id: true, email: true },
  });
}

async function sessionIdFor(token: string): Promise<string> {
  const context = await validateSessionToken(token);
  if (!context) throw new Error("session not found");
  return context.sessionId;
}

afterAll(async () => {
  if (dbAvailable) await cleanUpTestUsers();
});

describe.skipIf(!dbAvailable)("profile", () => {
  it("updates the name and bio, trimming both", async () => {
    const user = await createUser();

    await updateProfile(user.id, {
      name: "  Ada Lovelace ",
      bio: "  Writes about engines. ",
      institution: "",
    });

    const dto = toOwnProfileDTO((await findProfile(user.id))!);
    expect(dto).toMatchObject({ name: "Ada Lovelace", bio: "Writes about engines." });
  });

  it("stores an emptied bio as nothing, not as an empty string", async () => {
    const user = await createUser();
    await updateProfile(user.id, { name: "Ada", bio: "Something", institution: "" });

    await updateProfile(user.id, { name: "Ada", bio: "   ", institution: "" });

    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).bio).toBeNull();
    expect(toOwnProfileDTO((await findProfile(user.id))!).bio).toBe("");
  });

  it("exposes only what the profile page needs — no hash, no image bytes", async () => {
    const user = await createUser();
    await setAvatar(user.id, PNG);

    const dto = toOwnProfileDTO((await findProfile(user.id))!);

    expect(Object.keys(dto).sort()).toEqual(
      [
        "avatarUrl",
        "bio",
        "email",
        "id",
        "institution",
        "memberSince",
        "name",
        "reviewer",
        "role",
      ].sort(),
    );
    expect(JSON.stringify(dto)).not.toContain("argon2");
  });
});

describe.skipIf(!dbAvailable)("profile picture", () => {
  it("stores an image with the type read from its bytes, and gives it a versioned URL", async () => {
    const user = await createUser();
    expect(toOwnProfileDTO((await findProfile(user.id))!).avatarUrl).toBeNull();

    expect(await setAvatar(user.id, PNG)).toEqual({ ok: true });

    const stored = await findAvatar(user.id);
    expect(stored?.mime).toBe("image/png");
    expect(Array.from(stored!.bytes)).toEqual(Array.from(PNG));
    expect(toOwnProfileDTO((await findProfile(user.id))!).avatarUrl).toMatch(
      new RegExp(`^/avatar/${user.id}\\?v=\\d+$`),
    );
  });

  it("changes the URL when the picture is replaced, so caches cannot serve the old one", async () => {
    const user = await createUser();
    await setAvatar(user.id, PNG);
    const first = toOwnProfileDTO((await findProfile(user.id))!).avatarUrl;
    await new Promise((resolve) => setTimeout(resolve, 5));

    await setAvatar(user.id, PNG);

    expect(toOwnProfileDTO((await findProfile(user.id))!).avatarUrl).not.toBe(first);
  });

  it("refuses a file that is not an image and leaves the old picture alone", async () => {
    const user = await createUser();
    await setAvatar(user.id, PNG);
    const html = new TextEncoder().encode("<script>alert(1)</script>");

    expect(await setAvatar(user.id, html)).toEqual({ ok: false, reason: "not_an_image" });

    expect((await findAvatar(user.id))?.mime).toBe("image/png");
  });

  it("removes the picture completely", async () => {
    const user = await createUser();
    await setAvatar(user.id, PNG);

    await removeAvatar(user.id);

    expect(await findAvatar(user.id)).toBeNull();
    expect(toOwnProfileDTO((await findProfile(user.id))!).avatarUrl).toBeNull();
  });
});

describe.skipIf(!dbAvailable)("changePassword", () => {
  it("changes the password, keeps this session and revokes every other one", async () => {
    const user = await createUser();
    const here = await createSession(user.id);
    const elsewhere = await createSession(user.id);

    const result = await changePassword(
      user.id,
      PASSWORD,
      NEW_PASSWORD,
      await sessionIdFor(here.token),
    );

    expect(result).toEqual({ ok: true });
    expect(await validateSessionToken(here.token)).not.toBeNull();
    expect(await validateSessionToken(elsewhere.token)).toBeNull();
    expect(await authenticate(user.email, NEW_PASSWORD, testIp())).toMatchObject({ ok: true });
    expect(await authenticate(user.email, PASSWORD, testIp())).toMatchObject({ ok: false });
  });

  it("refuses without the current password, changing nothing", async () => {
    const user = await createUser();
    const here = await createSession(user.id);
    const elsewhere = await createSession(user.id);

    const result = await changePassword(
      user.id,
      "not my password",
      NEW_PASSWORD,
      await sessionIdFor(here.token),
    );

    expect(result).toEqual({ ok: false, reason: "wrong_password" });
    expect(await validateSessionToken(elsewhere.token)).not.toBeNull();
    expect(await authenticate(user.email, PASSWORD, testIp())).toMatchObject({ ok: true });
  });

  it("records the change in the activity log", async () => {
    const user = await createUser();
    const here = await createSession(user.id);

    await changePassword(user.id, PASSWORD, NEW_PASSWORD, await sessionIdFor(here.token));

    const log = await db.activityLog.findFirst({
      where: { action: "auth.password_changed", entityId: user.id },
    });
    expect(log?.actorId).toBe(user.id);
  });

  it("stops guessing after five wrong attempts, even when the sixth is right", async () => {
    const user = await createUser();
    const sessionId = await sessionIdFor((await createSession(user.id)).token);

    for (let i = 0; i < 5; i++) await changePassword(user.id, "guess", NEW_PASSWORD, sessionId);
    const result = await changePassword(user.id, PASSWORD, NEW_PASSWORD, sessionId);

    expect(result).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(await authenticate(user.email, PASSWORD, testIp())).toMatchObject({ ok: true });
  });
});
