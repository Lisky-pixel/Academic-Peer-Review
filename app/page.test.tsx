import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

// Toolchain smoke test: proves jsdom, React 19 rendering, TSX compilation and
// the "@/" path alias all work before any real feature depends on them.
describe("HomePage", () => {
  it("renders the headline, the five steps and the ways in", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Peer review for academic conferences.",
    );
    expect(screen.getByText("Reviewers are matched")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: /Get started/ })[0]).toHaveAttribute(
      "href",
      "/register",
    );
    expect(
      screen.getByRole("button", { name: "Switch between light and dark theme" }),
    ).toBeInTheDocument();
  });
});
