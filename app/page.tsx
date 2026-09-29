/**
 * Temporary landing page.
 *
 * Stands in until the real entry point lands, and doubles as a local dev index
 * for the docker-compose services. Replaced in a later phase.
 */

const PIPELINE = [
  { actor: "User", action: "submits a document" },
  { actor: "Admin", action: "assigns a reviewer" },
  { actor: "Reviewer", action: "returns feedback" },
  { actor: "Admin", action: "approves the review" },
  { actor: "User", action: "downloads the result" },
];

const DEV_SERVICES = [
  { name: "Mailpit", detail: "captured outbound email", href: "http://localhost:8025" },
  { name: "MinIO", detail: "document storage console", href: "http://localhost:9001" },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-10 px-6 py-16">
      <header className="space-y-3">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase">
          Scaffold ready
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">ReviewFlow</h1>
        <p className="text-muted-foreground text-balance">
          Submit written work for structured review. Reviewers stay anonymous to the people whose
          documents they read.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">The pipeline</h2>
        <ol className="border-border divide-border divide-y rounded-lg border">
          {PIPELINE.map((step, i) => (
            <li key={step.actor + step.action} className="flex items-baseline gap-3 px-4 py-3">
              <span className="text-muted-foreground w-4 shrink-0 text-xs tabular-nums">
                {i + 1}
              </span>
              <span className="w-20 shrink-0 text-sm font-medium">{step.actor}</span>
              <span className="text-muted-foreground text-sm">{step.action}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Local services</h2>
        <ul className="flex flex-wrap gap-2">
          {DEV_SERVICES.map((service) => (
            <li key={service.name}>
              <a
                href={service.href}
                target="_blank"
                rel="noreferrer"
                className="border-border hover:bg-accent hover:text-accent-foreground inline-flex items-baseline gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors"
              >
                <span className="font-medium">{service.name}</span>
                <span className="text-muted-foreground text-xs">{service.detail}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
