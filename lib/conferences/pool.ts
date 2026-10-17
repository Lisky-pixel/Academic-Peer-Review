import { db } from "@/lib/db";

/**
 * The reviewer pool, for organisers and administrators: who can be matched to
 * papers, in which disciplines, and who has been invited but not joined.
 * Returned as plain values, ready for a page.
 */
export async function findReviewerPool() {
  const [reviewers, invited] = await Promise.all([
    db.user.findMany({
      where: { role: "REVIEWER", status: "ACTIVE" },
      orderBy: { name: "asc" },
      take: 500,
      select: {
        id: true,
        name: true,
        institution: true,
        reviewerProfile: {
          select: {
            academicRank: true,
            yearsExperience: true,
            cvFilename: true,
            disciplines: { select: { name: true }, orderBy: { name: "asc" } },
          },
        },
      },
    }),
    db.user.findMany({
      where: { role: "REVIEWER", status: "INVITED" },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, createdAt: true },
    }),
  ]);

  return {
    reviewers: reviewers.map((reviewer) => ({
      id: reviewer.id,
      name: reviewer.name,
      institution: reviewer.institution,
      profile: reviewer.reviewerProfile
        ? {
            rank: reviewer.reviewerProfile.academicRank,
            years: reviewer.reviewerProfile.yearsExperience,
            disciplines: reviewer.reviewerProfile.disciplines.map((d) => d.name),
            hasCv: Boolean(reviewer.reviewerProfile.cvFilename),
          }
        : null,
    })),
    invited: invited.map((person) => ({
      id: person.id,
      name: person.name,
      email: person.email,
      invitedAt: person.createdAt.toISOString(),
    })),
  };
}

/** The signed-in person's institution, to prefill a new paper. */
export async function findOwnInstitution(userId: string): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { institution: true } });
  return user?.institution ?? "";
}

/** Whether a reviewer has told us their disciplines yet. */
export async function hasReviewerProfile(userId: string): Promise<boolean> {
  return (await db.reviewerProfile.count({ where: { userId } })) > 0;
}
