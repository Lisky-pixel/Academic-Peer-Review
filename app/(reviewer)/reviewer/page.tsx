import type { Metadata } from "next";
import { ComingSoon, RoleArea } from "@/components/role-area";
import { requireRole } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewerHomePage() {
  const user = await requireRole("REVIEWER");

  return (
    <RoleArea
      user={user}
      title="Review queue"
      description="Documents assigned to you, with their deadlines, will be listed here."
      current="/reviewer"
    >
      <ComingSoon title="Nothing assigned yet">
        The reviewer workspace arrives once submissions and assignment are built.
      </ComingSoon>
    </RoleArea>
  );
}
