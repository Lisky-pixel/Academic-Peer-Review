import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";

/**
 * The one email layout. Every notification is this component with different
 * words in it, so they all look alike and there is one place to change how
 * ReviewFlow email looks.
 *
 * Colours are literal values, not theme tokens: an email client does not load
 * our stylesheet, and many strip anything but inline styles.
 */

/** What a notification email says. Stored as the outbox payload. */
export type EmailContent = {
  heading: string;
  paragraphs: string[];
  /** The one action, if there is one. `path` is relative to the site. */
  cta: { label: string; path: string } | null;
};

const INK = "#1b2a4a";
const TEXT = "#131a2a";
const MUTED = "#596376";
const PAPER = "#f5f6f9";
const RULE = "#dbe0e8";
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function NotificationEmail({
  content,
  appName,
  appUrl,
}: {
  content: EmailContent;
  appName: string;
  appUrl: string;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{content.paragraphs[0] ?? content.heading}</Preview>
      <Body style={{ backgroundColor: PAPER, margin: 0, padding: "32px 12px", fontFamily: SANS }}>
        <Container
          style={{
            backgroundColor: "#ffffff",
            border: `1px solid ${RULE}`,
            borderRadius: 12,
            maxWidth: 520,
            padding: "32px 32px 28px",
          }}
        >
          <Text
            style={{
              color: INK,
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 18,
              fontWeight: 700,
              margin: "0 0 28px",
            }}
          >
            {appName}
          </Text>

          <Heading
            as="h1"
            style={{
              color: TEXT,
              fontSize: 22,
              fontWeight: 600,
              lineHeight: 1.3,
              margin: "0 0 16px",
            }}
          >
            {content.heading}
          </Heading>

          {content.paragraphs.map((paragraph, index) => (
            <Text
              key={index}
              style={{ color: TEXT, fontSize: 15, lineHeight: 1.6, margin: "0 0 14px" }}
            >
              {paragraph}
            </Text>
          ))}

          {content.cta && (
            <Section style={{ margin: "24px 0 8px" }}>
              <Button
                href={`${appUrl}${content.cta.path}`}
                style={{
                  backgroundColor: INK,
                  borderRadius: 8,
                  color: "#ffffff",
                  fontSize: 14,
                  fontWeight: 600,
                  padding: "11px 18px",
                  textDecoration: "none",
                }}
              >
                {content.cta.label}
              </Button>
            </Section>
          )}

          <Hr style={{ borderColor: RULE, margin: "28px 0 16px" }} />
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 1.5, margin: 0 }}>
            You are receiving this because of your account at {appName}. This address does not
            accept replies.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** Renders a notification to the HTML and plain-text bodies of one email. */
export async function renderNotificationEmail(
  content: EmailContent,
  site: { appName: string; appUrl: string },
): Promise<{ html: string; text: string }> {
  const element = <NotificationEmail content={content} {...site} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}

/** Checks a stored payload is still a well-formed EmailContent before use. */
export function parseEmailContent(value: unknown): EmailContent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.heading !== "string") return null;
  if (
    !Array.isArray(candidate.paragraphs) ||
    !candidate.paragraphs.every((paragraph) => typeof paragraph === "string")
  ) {
    return null;
  }

  const cta = candidate.cta as Record<string, unknown> | null | undefined;
  const validCta =
    cta && typeof cta.label === "string" && typeof cta.path === "string" && cta.path.startsWith("/")
      ? { label: cta.label, path: cta.path }
      : null;

  return { heading: candidate.heading, paragraphs: candidate.paragraphs, cta: validCta };
}
