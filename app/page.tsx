import { ArrowRight, Download, FileUp, PenLine, ShieldCheck, UserSearch } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { AnnotatedPageVisual, ReviewSummaryVisual } from "@/components/home-visuals";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    icon: FileUp,
    title: "Submit a document",
    detail: "Upload it, say what it is for, and tell the reviewer where to focus.",
  },
  {
    icon: UserSearch,
    title: "We match a reviewer",
    detail: "Someone suited to that kind of document is assigned to read it.",
  },
  {
    icon: PenLine,
    title: "They review it in full",
    detail: "Scored against criteria for that document type, with an annotated copy.",
  },
  {
    icon: ShieldCheck,
    title: "We check the review",
    detail: "Every review is read and approved before it reaches you.",
  },
  {
    icon: Download,
    title: "Read it and download",
    detail: "The feedback and the marked-up file, with the reviewer kept anonymous.",
  },
];

// Mirrors the document types seeded in prisma/seed.ts.
const DOCUMENT_TYPES = [
  "Personal statements",
  "Statements of purpose",
  "Essays",
  "Journals",
  "Articles",
  "Academic papers",
  "Cover letters",
  "CVs and résumés",
  "Scholarship applications",
  "Research proposals",
  "General writing",
];

const DEV_SERVICES = [
  { name: "Mailpit", detail: "captured outbound email", href: "http://localhost:8025" },
  { name: "MinIO", detail: "document storage console", href: "http://localhost:9001" },
];

const CONTAINER = "mx-auto w-full max-w-6xl px-5 sm:px-8";

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <header className={`${CONTAINER} flex h-20 items-center justify-between gap-3`}>
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
      </header>

      <main className="flex-1">
        <section
          className={`${CONTAINER} grid items-center gap-x-12 gap-y-20 pt-10 pb-24 sm:pt-16 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:pb-32`}
        >
          <div>
            <h1 className="font-heading text-[2.6rem] leading-[1.05] font-medium tracking-tight text-balance sm:text-6xl">
              Have your writing read properly before it counts.
            </h1>
            <p className="text-muted-foreground mt-6 max-w-xl text-lg leading-relaxed text-pretty">
              Send in a personal statement, an essay or a CV. A reviewer reads it against clear
              criteria and returns honest feedback with a marked-up copy.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-11 px-5 text-sm">
                <Link href="/register">
                  Submit your first document
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 px-5 text-sm">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>

          <AnnotatedPageVisual className="lg:mr-6" />
        </section>

        <section className={`${CONTAINER} py-20 sm:py-24`}>
          <h2 className="font-heading text-3xl font-medium tracking-tight sm:text-4xl">
            How it works
          </h2>
          <ol className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step) => (
              <li key={step.title}>
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

        <section className="bg-muted/60">
          <div
            className={`${CONTAINER} grid items-center gap-x-16 gap-y-12 py-20 sm:py-28 lg:grid-cols-2`}
          >
            <ReviewSummaryVisual className="order-last lg:order-first" />
            <div>
              <h2 className="font-heading text-3xl font-medium tracking-tight text-balance sm:text-4xl">
                Feedback you can act on
              </h2>
              <p className="text-muted-foreground mt-5 max-w-lg text-lg leading-relaxed text-pretty">
                Not a grade and a shrug. You get a score for each thing that matters in your kind of
                document, a written summary, and your own file back with the changes marked.
              </p>
              <p className="text-muted-foreground mt-4 max-w-lg leading-relaxed text-pretty">
                You never learn who your reviewer is, so they can say what they think.
              </p>
            </div>
          </div>
        </section>

        <section className={`${CONTAINER} py-20 sm:py-28`}>
          <div className="max-w-2xl">
            <h2 className="font-heading text-3xl font-medium tracking-tight text-balance sm:text-4xl">
              Judged for what it is
            </h2>
            <p className="text-muted-foreground mt-5 text-lg leading-relaxed text-pretty">
              A CV is not marked on storytelling and a personal statement is not marked on
              citations. Each kind of document has its own review criteria.
            </p>
          </div>
          <ul className="mt-10 flex flex-wrap gap-2.5">
            {DOCUMENT_TYPES.map((type) => (
              <li key={type} className="border-border rounded-full border px-4 py-2 text-sm">
                {type}
              </li>
            ))}
          </ul>
        </section>

        <section className={`${CONTAINER} pb-20 sm:pb-28`}>
          <div className="bg-panel text-panel-foreground flex flex-col items-start justify-between gap-8 rounded-3xl p-8 sm:p-12 lg:flex-row lg:items-center">
            <div>
              <h2 className="font-heading text-3xl font-medium tracking-tight text-balance sm:text-4xl">
                Ready when your draft is.
              </h2>
              <p className="text-panel-muted mt-3 max-w-md leading-relaxed">
                Create an account, upload your document, and follow it through review.
              </p>
            </div>
            <Button
              asChild
              size="lg"
              className="bg-panel-foreground text-panel hover:bg-panel-foreground/90 dark:bg-primary dark:text-primary-foreground h-11 shrink-0 px-5 text-sm"
            >
              <Link href="/register">
                Get started
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-border border-t">
        <div
          className={`${CONTAINER} text-muted-foreground flex flex-wrap items-center justify-between gap-4 py-6 text-sm`}
        >
          <span>ReviewFlow</span>
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
