import { getCurrentSession } from "@/lib/auth/guards";
import { findAvatar } from "@/lib/profile";

/**
 * Serves a profile picture — to its owner, or to an administrator, and to
 * nobody else.
 *
 * This check is an anonymity control, not a nicety. A reviewer's face is as
 * identifying as their name, so there must be no URL an author could request
 * to see it. Everyone who is not entitled gets the same 404 as a picture that
 * does not exist, so the route cannot be used to learn who has an account.
 */
export async function GET(_request: Request, { params }: RouteContext<"/avatar/[userId]">) {
  const { userId } = await params;

  const session = await getCurrentSession();
  const allowed = session && (session.user.id === userId || session.user.role === "ADMIN");
  if (!allowed) return new Response(null, { status: 404 });

  const avatar = await findAvatar(userId);
  if (!avatar) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(avatar.bytes), {
    headers: {
      "Content-Type": avatar.mime,
      // The URL carries a version that changes on every upload, so a given
      // URL never changes content. `private` keeps it out of shared caches.
      "Cache-Control": "private, max-age=31536000, immutable",
      // The stored type came from the file's own bytes; stop the browser
      // from second-guessing it into something executable.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
