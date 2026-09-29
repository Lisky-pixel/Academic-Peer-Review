import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

// Toolchain smoke test: proves jsdom, React 19 rendering, TSX compilation and
// the "@/" path alias all work before any real feature depends on them.
describe("HomePage", () => {
  it("renders the product name and the pipeline steps", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "ReviewFlow" })).toBeInTheDocument();
    expect(screen.getByText("assigns a reviewer")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).not.toHaveLength(0);
  });
});
