import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  AvatarUploader,
  CvUploader,
  PasswordForm,
  ProfileForm,
  ReviewerProfileForm,
} from "@/app/(account)/profile/profile-forms";
import { RoleArea } from "@/components/role-area";
import { requireUser } from "@/lib/auth/guards";
import { toOwnProfileDTO } from "@/lib/dto/profile";
import { env } from "@/lib/env";
import { findProfile } from "@/lib/profile";
import { findDisciplines } from "@/lib/submissions";

export const metadata: Metadata = { title: "Your profile" };

const memberSinceFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

export default async function ProfilePage() {
  const user = await requireUser();
  const [record, disciplines] = await Promise.all([findProfile(user.id), findDisciplines()]);
  if (!record) notFound();
  const profile = toOwnProfileDTO(record);
  const canReview = profile.role === "USER" || profile.role === "REVIEWER";

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
        description="Your name appears on your papers and in emails we send you."
      >
        <ProfileForm
          name={profile.name}
          bio={profile.bio}
          email={profile.email}
          institution={profile.institution}
        />
      </Section>

      {canReview && (
        <Section
          id="reviewer"
          title={profile.role === "REVIEWER" ? "Reviewing" : "Become a reviewer"}
          description={
            profile.role === "REVIEWER"
              ? "What you can review. Organisers see this and your CV; authors never learn who you are."
              : "Review papers in your discipline as well as submitting your own. You will never be given your own paper."
          }
        >
          <div className="space-y-8">
            <ReviewerProfileForm
              disciplines={disciplines}
              isReviewer={profile.role === "REVIEWER"}
              initial={{
                academicRank: profile.reviewer?.academicRank ?? "",
                yearsExperience:
                  profile.reviewer !== null ? String(profile.reviewer.yearsExperience) : "",
                expertise: profile.reviewer?.expertise ?? "",
                disciplineIds: profile.reviewer?.disciplines.map((d) => d.id) ?? [],
              }}
            />
            {profile.reviewer && (
              <div className="space-y-3">
                <p className="text-sm font-medium">Your CV</p>
                <CvUploader current={profile.reviewer.cv} maxBytes={env.MAX_UPLOAD_BYTES} />
              </div>
            )}
          </div>
        </Section>
      )}

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
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="border-border grid scroll-mt-24 gap-x-12 gap-y-6 border-t pt-10 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
    >
      <div className="space-y-1.5">
        <h2 className="font-heading text-xl font-medium">{title}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed text-pretty">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
