// The paths the route tests can't reach through HTTP: an error raised
// after the response has started can only be handed back to Express.

import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { errorHandler } from "../../src/middleware/error-handler";

describe("errorHandler", () => {
  it("hands the error to Express when the response has already started", () => {
    const err = new Error("stream broke");
    const res = { headersSent: true, status: vi.fn(), json: vi.fn() };
    const log = { error: vi.fn() };
    const next = vi.fn();

    errorHandler(err, { log } as unknown as Request, res as unknown as Response, next);

    // Express's default handler closes the connection; a second response would throw.
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("treats a thrown null as an unexpected failure", () => {
    const res = { headersSent: false, status: vi.fn().mockReturnThis(), json: vi.fn() };
    const log = { error: vi.fn() };
    const next = vi.fn();

    errorHandler(null, { id: "req-1", log } as unknown as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith({ err: null }, "unexpected failure");
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "INTERNAL_ERROR", requestId: "req-1" }));
  });
});
