import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/app/(auth)/auth-card";
import { LoginForm } from "@/app/(auth)/forms";
import { getCurrentSession } from "@/lib/auth/guards";
import { HOME_PATH, safeRedirectPath } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await getCurrentSession();
  if (session) redirect(HOME_PATH[session.user.role]);

  const { next, reset } = await searchParams;
  const safeNext = safeRedirectPath(next, "");

  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          New here?{" "}
          <Link
            href="/register"
            className="text-mark font-medium underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      {reset === "1" && (
        <p
          role="status"
          className="border-success/30 bg-success/10 text-success rounded-lg border px-3 py-2.5 text-sm"
        >
          Your password has been changed. Sign in with the new one.
        </p>
      )}
      <LoginForm next={safeNext || undefined} />
    </AuthCard>
  );
}
