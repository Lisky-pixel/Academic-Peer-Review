import type { Metadata } from "next";
import { Geist, Newsreader } from "next/font/google";
import { cookies } from "next/headers";
import { PointerGlow } from "@/components/pointer-glow";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
// Headings only. A serif beside a plain sans is what makes the product read as
// something to do with writing rather than as another dashboard.
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: {
    default: "ReviewFlow",
    template: "%s · ReviewFlow",
  },
  description: "Submit documents for structured, anonymous review.",
  // Submissions and reviews are private; keep them out of search indexes.
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // "light", "dark", or nothing — in which case CSS follows the operating
  // system. Rendering the class here is what prevents a flash on load.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      className={cn("font-sans", geist.variable, newsreader.variable, theme)}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground min-h-dvh antialiased">
        {children}
        <PointerGlow />
      </body>
    </html>
  );
}
