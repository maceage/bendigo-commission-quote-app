import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert } from "./Alert";

describe("Alert", () => {
  it("shows the request ID as a reference the user can quote to support", () => {
    render(<Alert error={{ code: "VENDOR_TIMEOUT", message: "Vendor timed out.", requestId: "req-42" }} />);
    expect(screen.getByText("Reference: req-42")).toBeInTheDocument();
  });

  it("shows no reference when the error has none (e.g. the network failed)", () => {
    render(<Alert error={{ code: "SERVICE_UNAVAILABLE", message: "Could not reach the quote service." }} />);
    expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument();
  });
});
