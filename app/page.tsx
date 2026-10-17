import {
  ArrowRight,
  BarChart3,
  EyeOff,
  FileUp,
  Gavel,
  Mic,
  PenLine,
  Shuffle,
  UserSearch,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Backdrop } from "@/components/backdrop";
import { Brand } from "@/components/brand";
import { AnnotatedPageVisual, ReviewSummaryVisual } from "@/components/home-visuals";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    icon: FileUp,
    title: "Authors submit",
    detail: "Title, abstract, discipline and the full paper, without the authors’ names.",
  },
  {
    icon: Shuffle,
    title: "Reviewers are matched",
    detail: "By discipline, never from the author’s institution, with workloads kept even.",
  },
  {
    icon: PenLine,
    title: "They review it",
    detail: "A score from 1 to 5, a recommendation, comments and a marked-up copy.",
  },
  {
    icon: Gavel,
    title: "Organisers decide",
    detail: "Scores side by side. If reviewers disagree, another is added first.",
  },
  {
    icon: Mic,
    title: "Authors hear back",
    detail: "The decision and every review, by email, with reviewers kept anonymous.",
  },
];

const PROMISES = [
  {
    icon: EyeOff,
    title: "Blind review",
    detail: "Double-blind by default: authors and reviewers never learn who the other is.",
  },
  {
    icon: UserSearch,
    title: "Matched by discipline",
    detail: "Papers go to reviewers who know the field, with conflicts of interest kept out.",
  },
  {
    icon: BarChart3,
    title: "Everything in one place",
    detail: "Progress, reminders, reports and an Excel export for every conference.",
  },
];

const AUDIENCES = [
  {
    icon: Users,
    title: "Conference organisers",
    detail:
      "Open a call for papers, follow every review, and decide with the scores in front of you.",
    cta: { label: "Talk to us", href: "/help#contact" },
  },
  {
    icon: FileUp,
    title: "Authors",
    detail: "Submit to open calls, edit until review starts, and read every review afterwards.",
    cta: { label: "Submit a paper", href: "/register?as=submitter" },
  },
  {
    icon: PenLine,
    title: "Reviewers",
    detail: "Review papers in your discipline, on your phone or laptop, anonymously.",
    cta: { label: "Become a reviewer", href: "/register?as=reviewer" },
  },
];

const DISCIPLINES = [
  "Public Health",
  "Economics",
  "Education",
  "Engineering",
  "Agriculture and Food Science",
  "Computer Science",
  "Law",
  "Environmental Science",
  "Business and Management",
  "Nursing and Midwifery",
  "Tourism, Hospitality and Events",
  "and more",
];

const DEV_SERVICES = [
  { name: "Mailpit", detail: "captured outbound email", href: "http://localhost:8025" },
  { name: "MinIO", detail: "document storage console", href: "http://localhost:9001" },
];

const CONTAINER = "mx-auto w-full max-w-6xl px-5 sm:px-8";

export default function HomePage() {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip">
      <Backdrop />

      {/* A floating glass bar: the page scrolls beneath it. */}
      <header className="sticky top-3 z-40 px-3 sm:top-4 sm:px-6">
        <div className="glass glass-strong mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 rounded-2xl px-4 sm:px-5">
          <Brand />
          <nav className="flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle className="mr-1" />
            <Button asChild variant="ghost" size="lg" className="hidden sm:inline-flex">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="lg">
              <Link href="/register">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section
          className={`${CONTAINER} page-enter grid items-center gap-x-12 gap-y-20 pt-14 pb-24 sm:pt-20 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:pb-32`}
        >
          <div>
            <h1 className="font-heading text-[2.6rem] leading-[1.05] font-medium tracking-tight text-balance sm:text-6xl">
              Peer review for academic conferences.
            </h1>
            <p className="text-muted-foreground mt-6 max-w-xl text-lg leading-relaxed text-pretty">
              Take in papers, match them to the right reviewers, and decide with confidence, all in
              one place built for conferences across Africa and beyond.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="group h-11 px-5 text-sm">
                <Link href="/register?as=submitter">
                  Submit a paper
                  <ArrowRight
                    aria-hidden
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 px-5 text-sm">
                <Link href="/register?as=reviewer">Become a reviewer</Link>
              </Button>
            </div>
            <p className="text-muted-foreground mt-5 text-sm">
              Already have an account?{" "}
              <Link
                href="/login"
                className="text-mark font-medium underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </div>

          <AnnotatedPageVisual className="float-slow lg:mr-6" />
        </section>

        <section className={`${CONTAINER} reveal pb-20 sm:pb-24`}>
          <ul className="grid gap-4 sm:grid-cols-3">
            {PROMISES.map((promise) => (
              <li key={promise.title} data-glow className="glass rounded-2xl p-6">
                <span className="bg-mark/10 text-mark flex size-10 items-center justify-center rounded-xl">
                  <promise.icon aria-hidden className="size-5" strokeWidth={1.75} />
                </span>
                <p className="mt-5 font-medium">{promise.title}</p>
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                  {promise.detail}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className={`${CONTAINER} reveal py-16 sm:py-20`}>
          <h2 className="font-heading text-3xl font-medium tracking-tight sm:text-4xl">
            How it works
          </h2>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step) => (
              <li
                key={step.title}
                data-glow
                className="glass rounded-2xl p-5 transition-transform duration-300 hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span className="bg-mark/10 text-mark flex size-11 items-center justify-center rounded-xl">
                  <step.icon aria-hidden className="size-5" strokeWidth={1.75} />
                </span>
                <p className="mt-5 font-medium">{step.title}</p>
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                  {step.detail}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section
          className={`${CONTAINER} reveal grid items-center gap-x-16 gap-y-12 py-16 sm:py-24 lg:grid-cols-2`}
        >
          <ReviewSummaryVisual className="order-last lg:order-first" />
          <div>
            <h2 className="font-heading text-3xl font-medium tracking-tight text-balance sm:text-4xl">
              Reviews authors can act on
            </h2>
            <p className="text-muted-foreground mt-5 max-w-lg text-lg leading-relaxed text-pretty">
              Every author hears back with the decision, each reviewer’s score and comments, and
              their own paper marked up, whether it was accepted or not.
            </p>
            <p className="text-muted-foreground mt-4 max-w-lg leading-relaxed text-pretty">
              Reviewers stay anonymous, so they can say what they think.
            </p>
          </div>
        </section>

        <section className={`${CONTAINER} reveal py-16 sm:py-20`}>
          <h2 className="font-heading text-3xl font-medium tracking-tight sm:text-4xl">
            Built for everyone involved
          </h2>
          <ul className="mt-10 grid gap-4 md:grid-cols-3">
            {AUDIENCES.map((audience) => (
              <li
                key={audience.title}
                data-glow
                className="glass flex flex-col justify-between gap-6 rounded-2xl p-6"
              >
                <div>
                  <span className="bg-mark/10 text-mark flex size-10 items-center justify-center rounded-xl">
                    <audience.icon aria-hidden className="size-5" strokeWidth={1.75} />
                  </span>
                  <p className="mt-5 font-medium">{audience.title}</p>
                  <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                    {audience.detail}
                  </p>
                </div>
                <Link
                  href={audience.cta.href}
                  className="text-mark group inline-flex items-center gap-1.5 text-sm font-medium"
                >
                  {audience.cta.label}
                  <ArrowRight
                    aria-hidden
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className={`${CONTAINER} reveal py-16 sm:py-24`}>
          <div className="max-w-2xl">
            <h2 className="font-heading text-3xl font-medium tracking-tight text-balance sm:text-4xl">
              Every discipline, one platform
            </h2>
            <p className="text-muted-foreground mt-5 text-lg leading-relaxed text-pretty">
              Reviewers choose the fields they know, and papers are matched to them by discipline,
              from public health to tourism and events.
            </p>
          </div>
          <ul className="mt-10 flex flex-wrap gap-2.5">
            {DISCIPLINES.map((name) => (
              <li
                key={name}
                className="glass rounded-full px-4 py-2 text-sm transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                {name}
              </li>
            ))}
          </ul>
        </section>

        <section className={`${CONTAINER} reveal pb-20 sm:pb-28`}>
          <div className="bg-panel text-panel-foreground relative isolate flex flex-col items-start justify-between gap-8 overflow-hidden rounded-3xl p-8 sm:p-12 lg:flex-row lg:items-center">
            {/* A glow inside the ink panel, so it belongs with the glass around it. */}
            <span
              aria-hidden
              className="bg-panel-mark/30 absolute -top-24 -right-16 -z-10 size-72 rounded-full blur-3xl"
            />
            <div>
              <h2 className="font-heading text-3xl font-medium tracking-tight text-balance sm:text-4xl">
                Running a conference?
              </h2>
              <p className="text-panel-muted mt-3 max-w-md leading-relaxed">
                Tell us your dates and topics, and we will set up your call for papers.
              </p>
            </div>
            <Button
              asChild
              size="lg"
              className="group bg-panel-foreground text-panel hover:bg-panel-foreground/90 dark:bg-primary dark:text-primary-foreground h-11 shrink-0 px-5 text-sm"
            >
              <Link href="/help#contact">
                Get in touch
                <ArrowRight
                  aria-hidden
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer>
        <div
          className={`${CONTAINER} text-muted-foreground flex flex-wrap items-center justify-between gap-4 py-6 text-sm`}
        >
          <span className="flex gap-4">
            <span>Academic Peer Review</span>
            <Link href="/help" className="hover:text-foreground underline-offset-4 hover:underline">
              Help
            </Link>
          </span>
          {process.env.NODE_ENV === "development" && (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>Local services:</span>
              {DEV_SERVICES.map((service) => (
                <a
                  key={service.name}
                  href={service.href}
                  target="_blank"
                  rel="noreferrer"
                  title={service.detail}
                  className="hover:text-foreground underline underline-offset-4"
                >
                  {service.name}
                </a>
              ))}
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
