import { EyeOff, ListChecks, Route } from "lucide-react";
import type { Metadata } from "next";
import { Backdrop } from "@/components/backdrop";
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
    icon: EyeOff,
    title: "Blind review",
    body: "Authors and reviewers never learn who the other is, so reviews can be honest.",
  },
  {
    icon: ListChecks,
    title: "Matched by discipline",
    body: "Papers go to reviewers who know the field, never to their own institution.",
  },
  {
    icon: Route,
    title: "Nothing gets lost",
    body: "Every paper has a reference number and a status you can check at any time.",
  },
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="relative isolate grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <Backdrop />

      {/* The ink panel floats on the backdrop instead of filling the edge. */}
      <aside className="hidden p-4 lg:block">
        <div className="bg-panel text-panel-foreground relative isolate flex h-full flex-col justify-between gap-12 overflow-hidden rounded-3xl p-10 xl:p-14">
          <span
            aria-hidden
            className="bg-panel-mark/25 absolute -top-28 -left-20 -z-10 size-96 rounded-full blur-3xl"
          />
          <span
            aria-hidden
            className="bg-panel-mark/15 absolute -right-24 -bottom-32 -z-10 size-96 rounded-full blur-3xl"
          />

          <Brand className="text-2xl" onPanel />

          <div className="max-w-md space-y-9">
            <h2 className="font-heading text-4xl leading-[1.1] font-medium tracking-tight text-balance xl:text-5xl">
              Peer review for academic conferences.
            </h2>
            <ul className="space-y-3">
              {PROMISES.map((promise) => (
                <li
                  key={promise.title}
                  className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-md"
                >
                  <span className="bg-panel-mark/20 text-panel-mark flex size-9 shrink-0 items-center justify-center rounded-xl">
                    <promise.icon aria-hidden className="size-[18px]" strokeWidth={1.75} />
                  </span>
                  <span>
                    <span className="block font-medium">{promise.title}</span>
                    <span className="text-panel-muted mt-1 block text-sm leading-relaxed">
                      {promise.body}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-panel-muted text-sm">
            For organisers, authors and reviewers, in every discipline.
          </p>
        </div>
      </aside>

      <main className="flex flex-col px-4 py-6 sm:px-10 sm:py-8">
        <div className="flex items-center justify-between gap-4">
          {/* Empty on desktop, where the brand is on the ink panel, so the
              toggle still sits at the right edge. */}
          <span>
            <Brand className="lg:hidden" />
          </span>
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
          <div data-glow className="glass page-enter rounded-3xl p-6 sm:p-9">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
