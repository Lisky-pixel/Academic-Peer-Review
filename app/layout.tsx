import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: {
    default: "ReviewFlow",
    template: "%s · ReviewFlow",
  },
  description: "Submit documents for structured, anonymous review.",
  // Submissions and reviews are private; keep them out of search indexes.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-dvh antialiased">{children}</body>
    </html>
  );
}
