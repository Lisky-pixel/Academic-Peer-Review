/** The heading, body and footer link shared by every auth page. */
export function AuthCard({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl leading-tight font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description && (
          <p className="text-muted-foreground leading-relaxed text-pretty">{description}</p>
        )}
      </header>
      {children}
      {footer && (
        <p className="text-muted-foreground border-border border-t pt-6 text-sm">{footer}</p>
      )}
    </div>
  );
}
