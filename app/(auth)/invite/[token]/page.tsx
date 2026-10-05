import type { Metadata } from "next";
import { AuthCard } from "@/app/(auth)/auth-card";
import { SetPasswordForm } from "@/app/(auth)/forms";
import { findInvitee } from "@/lib/auth/invites";

export const metadata: Metadata = { title: "Accept your invitation" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invitee = await findInvitee(token);

  if (!invitee) {
    return (
      <AuthCard
        title="This invitation is no longer valid"
        description="Invitations work once and expire after three days. Ask the administrator who invited you to send a new one."
      />
    );
  }

  return (
    <AuthCard
      title={`Welcome, ${invitee.name}`}
      description={
        <>
          Choose a password to activate your account for{" "}
          <span className="text-foreground">{invitee.email}</span>.
        </>
      }
    >
      <SetPasswordForm token={token} purpose="invite" />
    </AuthCard>
  );
}
