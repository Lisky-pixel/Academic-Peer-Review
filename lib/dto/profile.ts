import type { Role } from "@/lib/generated/prisma/client";
import type { ProfileRecord } from "@/lib/profile";

/**
 * The address of a profile picture. The route behind it only serves a picture
 * to its owner or an administrator; the version makes it safely cacheable.
 */
export function avatarUrl(userId: string, updatedAt: Date | null | undefined): string | null {
  return updatedAt ? `/avatar/${userId}?v=${updatedAt.getTime()}` : null;
}

export type ReviewerProfileDTO = {
  academicRank: string;
  yearsExperience: number;
  expertise: string;
  disciplines: Array<{ id: string; name: string }>;
  cv: { filename: string; sizeBytes: number; uploadedAt: string } | null;
};

/** A person's own profile, as their profile page shows it. */
export type OwnProfileDTO = {
  id: string;
  name: string;
  email: string;
  role: Role;
  bio: string;
  institution: string;
  avatarUrl: string | null;
  memberSince: string;
  reviewer: ReviewerProfileDTO | null;
};

export function toOwnProfileDTO(record: ProfileRecord): OwnProfileDTO {
  const reviewer = record.reviewerProfile;
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role,
    bio: record.bio ?? "",
    institution: record.institution ?? "",
    avatarUrl: avatarUrl(record.id, record.avatarUpdatedAt),
    memberSince: record.createdAt.toISOString(),
    reviewer: reviewer
      ? {
          academicRank: reviewer.academicRank,
          yearsExperience: reviewer.yearsExperience,
          expertise: reviewer.expertise,
          disciplines: reviewer.disciplines,
          cv:
            reviewer.cvFilename && reviewer.cvSizeBytes && reviewer.cvUploadedAt
              ? {
                  filename: reviewer.cvFilename,
                  sizeBytes: reviewer.cvSizeBytes,
                  uploadedAt: reviewer.cvUploadedAt.toISOString(),
                }
              : null,
        }
      : null,
  };
}
