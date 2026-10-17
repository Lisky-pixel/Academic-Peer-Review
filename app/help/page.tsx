import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/app/help/contact-form";
import { Backdrop } from "@/components/backdrop";
import { Brand } from "@/components/brand";
import { RoleArea } from "@/components/role-area";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getCurrentSession } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Help" };

const QUESTIONS: Array<{ group: string; items: Array<[string, string]> }> = [
  {
    group: "Submitting a paper",
    items: [
      [
        "How do I submit a paper?",
        "Sign up as a submitter, then choose a conference under “Open calls for papers” on your papers page. Fill in the details, attach the full paper as a PDF or Word file, confirm the declaration and submit.",
      ],
      [
        "Can I change my paper after submitting it?",
        "Yes, until it is sent to reviewers. That usually happens when the call for papers closes. After that it is locked so every reviewer reads the same version.",
      ],
      [
        "Should my name be in the file?",
        "No. Most conferences use double-blind review, so remove the authors’ names from the text before you upload. We also remove names from the file’s hidden properties automatically.",
      ],
      [
        "When will I hear back?",
        "We email you when the organisers decide. You can then read every reviewer’s score and comments, and download any marked-up copies. Reviewers stay anonymous.",
      ],
    ],
  },
  {
    group: "Reviewing",
    items: [
      [
        "How are papers given to me?",
        "Automatically, by the disciplines on your profile. You are never given your own paper, a paper from your own institution, or more papers than the conference allows.",
      ],
      [
        "What if I cannot review a paper?",
        "Open it and choose “I cannot review this paper”. If you know the authors, tick the conflict of interest box. The paper goes to another reviewer straight away.",
      ],
      [
        "Can I change my review after sending it?",
        "No. Save it as a draft while you work, and send it only when it is finished.",
      ],
      ["Will I be reminded?", "Yes: seven days, three days and one day before your review is due."],
    ],
  },
  {
    group: "Running a conference",
    items: [
      [
        "How do I put my conference on the platform?",
        "Contact us with your dates and the topics you want to accept. We set the conference up and invite you as its organiser.",
      ],
      [
        "Who decides which papers are accepted?",
        "You do. When the reviews are in, each paper shows its scores and recommendations, and you accept or reject it. If reviewers disagree, another reviewer is added first.",
      ],
    ],
  },
];

export default async function HelpPage() {
  const session = await getCurrentSession();
  const body = (
    <>
      <div className="space-y-8">
        {QUESTIONS.map((group) => (
          <section key={group.group} className="space-y-3">
            <h2 className="font-heading text-2xl font-medium">{group.group}</h2>
            <div className="glass divide-border divide-y overflow-hidden rounded-2xl">
              {group.items.map(([question, answer]) => (
                <details key={question} className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                    {question}
                    <span
                      aria-hidden
                      className="text-muted-foreground text-xl leading-none transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="text-muted-foreground mt-3 leading-relaxed">{answer}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section
        id="contact"
        aria-labelledby="contact-heading"
        className="glass scroll-mt-24 space-y-5 rounded-3xl p-6 sm:p-8"
      >
        <div className="space-y-1">
          <h2 id="contact-heading" className="font-heading text-2xl font-medium">
            Contact us
          </h2>
          <p className="text-muted-foreground">
            Did not find your answer? Send us a message and we will reply by email.
          </p>
        </div>
        <ContactForm name={session?.user.name ?? ""} email={session?.user.email ?? ""} />
      </section>
    </>
  );

  if (session) {
    return (
      <RoleArea
        user={session.user}
        title="Help"
        description="Answers to common questions, and a way to reach us."
        current="/help"
      >
        {body}
      </RoleArea>
    );
  }

  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <Backdrop />
      <header className="sticky top-3 z-40 px-3 sm:top-4 sm:px-6">
        <div className="glass glass-strong mx-auto flex h-14 w-full max-w-4xl items-center justify-between gap-3 rounded-2xl px-4 sm:px-5">
          <Brand />
          <nav className="flex items-center gap-2">
            <ThemeToggle className="mr-1" />
            <Button asChild variant="ghost" size="lg">
              <Link href="/login">Sign in</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main className="page-enter mx-auto w-full max-w-4xl flex-1 space-y-10 px-4 py-12 sm:px-6 sm:py-16">
        <div className="space-y-2">
          <h1 className="font-heading text-4xl font-medium tracking-tight">Help</h1>
          <p className="text-muted-foreground text-lg">
            Answers to common questions, and a way to reach us.
          </p>
        </div>
        {body}
      </main>
    </div>
  );
}
