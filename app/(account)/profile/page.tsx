import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AvatarUploader, PasswordForm, ProfileForm } from "@/app/(account)/profile/profile-forms";
import { RoleArea } from "@/components/role-area";
import { requireUser } from "@/lib/auth/guards";
import { toOwnProfileDTO } from "@/lib/dto/profile";
import { findProfile } from "@/lib/profile";

export const metadata: Metadata = { title: "Your profile" };

const memberSinceFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

export default async function ProfilePage() {
  const user = await requireUser();
  const record = await findProfile(user.id);
  if (!record) notFound();
  const profile = toOwnProfileDTO(record);

  return (
    <RoleArea
      user={user}
      title="Your profile"
      description={`Member since ${memberSinceFormat.format(new Date(profile.memberSince))}.`}
    >
      <Section
        title="Picture"
        description="Shown in the menu at the top of the page. Only you and the administrators can see it."
      >
        <AvatarUploader name={profile.name} avatarUrl={profile.avatarUrl} />
      </Section>

      <Section
        title="About you"
        description="Your name appears on your submissions and in emails we send you."
      >
        <ProfileForm name={profile.name} bio={profile.bio} email={profile.email} />
      </Section>

      <Section
        title="Password"
        description="Changing it signs you out everywhere else, but keeps you signed in here."
      >
        <PasswordForm />
      </Section>
    </RoleArea>
  );
}

/** A settings row: what it is on the left, the controls on the right. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border grid gap-x-12 gap-y-6 border-t pt-10 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-1.5">
        <h2 className="font-heading text-xl font-medium">{title}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed text-pretty">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
