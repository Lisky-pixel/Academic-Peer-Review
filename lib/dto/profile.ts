import type { Role } from "@/lib/generated/prisma/client";
import type { ProfileRecord } from "@/lib/profile";

/**
 * The address of a profile picture. The route behind it only serves a picture
 * to its owner or an administrator; the version makes it safely cacheable.
 */
export function avatarUrl(userId: string, updatedAt: Date | null | undefined): string | null {
  return updatedAt ? `/avatar/${userId}?v=${updatedAt.getTime()}` : null;
}

/** A person's own profile, as their profile page shows it. */
export type OwnProfileDTO = {
  id: string;
  name: string;
  email: string;
  role: Role;
  bio: string;
  avatarUrl: string | null;
  memberSince: string;
};

export function toOwnProfileDTO(record: ProfileRecord): OwnProfileDTO {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role,
    bio: record.bio ?? "",
    avatarUrl: avatarUrl(record.id, record.avatarUpdatedAt),
    memberSince: record.createdAt.toISOString(),
  };
}
