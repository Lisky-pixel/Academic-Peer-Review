import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  // Reset and invite URLs carry a secret in the path. Without this, clicking
  // any outbound link from those pages would hand it to the next site in the
  // Referer header.
  referrer: "no-referrer",
};

const PROMISES = [
  {
    title: "Your reviewer stays anonymous",
    body: "Feedback is written to be useful, not polite. You never learn who read your work.",
  },
  {
    title: "Feedback with structure",
    body: "Every document type has its own criteria, so a CV is not judged like an essay.",
  },
  {
    title: "Nothing gets lost",
    body: "Each submission has a reference number and a status you can check at any time.",
  },
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="bg-panel text-panel-foreground hidden flex-col justify-between gap-12 p-12 lg:flex xl:p-16">
        <Brand className="text-2xl" onPanel />

        <div className="max-w-md space-y-10">
          <h2 className="font-heading text-4xl leading-[1.1] font-medium tracking-tight text-balance xl:text-5xl">
            Considered feedback on the writing that matters.
          </h2>
          <ul className="space-y-6">
            {PROMISES.map((promise) => (
              <li key={promise.title} className="border-panel-muted/30 border-l pl-5">
                <p className="font-medium">{promise.title}</p>
                <p className="text-panel-muted mt-1 text-sm leading-relaxed">{promise.body}</p>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-panel-muted text-sm">
          Personal statements, essays, CVs, cover letters and more.
        </p>
      </aside>

      <main className="flex flex-col px-6 py-10 sm:px-10">
        <div className="flex items-center justify-between gap-4">
          {/* Empty on desktop, where the brand is on the ink panel, so the
              toggle still sits at the right edge. */}
          <span>
            <Brand className="lg:hidden" />
          </span>
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
