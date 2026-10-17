"use client";

/**
 * The last resort: shown when the root layout itself fails, so none of the
 * application's styles or components can be relied on. Deliberately plain,
 * self-contained HTML with inline styles.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#f5f6f9",
          color: "#131a2a",
        }}
      >
        <main style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 26, fontWeight: 600, margin: "0 0 12px" }}>
            Academic Peer Review is having trouble
          </h1>
          <p style={{ lineHeight: 1.6, margin: "0 0 24px", color: "#596376" }}>
            The page could not be shown. Your saved work is not affected. Please try again in a
            moment.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              font: "inherit",
              fontWeight: 600,
              fontSize: 14,
              padding: "10px 16px",
              borderRadius: 8,
              border: 0,
              background: "#1b2a4a",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
