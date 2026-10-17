import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/app/(auth)/auth-card";
import { RegisterForm } from "@/app/(auth)/forms";
import { getCurrentSession } from "@/lib/auth/guards";
import { HOME_PATH } from "@/lib/auth/routes";
import { findDisciplines } from "@/lib/submissions";

export const metadata: Metadata = { title: "Create an account" };

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const session = await getCurrentSession();
  if (session) redirect(HOME_PATH[session.user.role]);
  const [{ as }, disciplines] = await Promise.all([searchParams, findDisciplines()]);

  return (
    <AuthCard
      title="Create an account"
      description="Submit papers to conferences, or review papers in your discipline."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-mark font-medium underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm
        disciplines={disciplines}
        initialType={as === "reviewer" || as === "submitter" ? as : ""}
      />
    </AuthCard>
  );
}
