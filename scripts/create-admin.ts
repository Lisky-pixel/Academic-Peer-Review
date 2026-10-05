/**
 * Creates the first administrator of a fresh deployment.
 *
 *   pnpm admin:create --email you@example.com --name "Your Name"
 *
 * Every other administrator and reviewer is invited from inside the
 * application, by an administrator. This script exists only to break that
 * circle once: it creates an invitation and prints its link. Nothing is typed
 * or stored here that could be a password — you choose yours by opening the
 * link, exactly as an invited person would.
 *
 * It refuses to run once an active administrator exists, unless --force is
 * given, so it cannot be used to quietly add a second door.
 */

import { issueToken } from "@/lib/auth/account-tokens";
import { INVITE_TTL_HOURS } from "@/lib/auth/invites";
import { normaliseEmail } from "@/lib/auth/schemas";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

async function main() {
  const rawEmail = argument("email");
  const name = argument("name")?.trim();
  const force = process.argv.includes("--force");

  if (!rawEmail || !name) {
    throw new Error('Usage: pnpm admin:create --email you@example.com --name "Your Name"');
  }
  const email = normaliseEmail(rawEmail);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`"${rawEmail}" does not look like an email address.`);
  }

  const admins = await db.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
  if (admins > 0 && !force) {
    throw new Error(
      `There ${admins === 1 ? "is already an active administrator" : `are already ${admins} active administrators`}. ` +
        "Ask one of them to invite you from Invitations, or pass --force if you are certain.",
    );
  }

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, status: true, role: true },
  });
  if (existing && existing.status !== "INVITED") {
    throw new Error(
      `${email} already has an account (${existing.role.toLowerCase()}, ${existing.status.toLowerCase()}).`,
    );
  }

  const user =
    existing ??
    (await db.user.create({
      data: { email, name, role: "ADMIN", status: "INVITED" },
      select: { id: true },
    }));
  if (existing) {
    await db.user.update({ where: { id: existing.id }, data: { role: "ADMIN", name } });
  }

  const token = await issueToken(user.id, "INVITE", INVITE_TTL_HOURS);
  await db.activityLog.create({
    data: {
      action: "auth.invite_sent",
      entityType: "User",
      entityId: user.id,
      // No actor: this came from the command line, not from a signed-in person.
      metadata: { via: "create-admin script" },
    },
  });

  console.log(`\nAn administrator invitation has been created for ${name} <${email}>.\n`);
  console.log("Open this link to choose a password and activate the account:\n");
  console.log(`  ${env.APP_URL}/invite/${token}\n`);
  console.log(`It works once and expires in ${INVITE_TTL_HOURS} hours. Treat it like a password.`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(`\n${error instanceof Error ? error.message : error}\n`);
    await db.$disconnect();
    process.exit(1);
  });
