import { describe, it, expect, vi } from "vitest";
import { Request, Response, NextFunction } from "express";

import { asyncHandler } from "../../../errors/asyncHandler.js";

describe("asyncHandler", () => {
  it("calls the wrapped function with req, res, next", async () => {
    const mockFn = vi.fn().mockResolvedValue("success");
    const wrapped = asyncHandler(mockFn);

    const req = {} as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    await wrapped(req, res, next);

    expect(mockFn).toHaveBeenCalledWith(req, res, next);
  });

  it("forwards errors to next() when function throws", async () => {
    const error = new Error("Test error");
    const mockFn = vi.fn().mockRejectedValue(error);
    const wrapped = asyncHandler(mockFn);

    const req = {} as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    await wrapped(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it("does not call next() when function succeeds", async () => {
    const mockFn = vi.fn().mockResolvedValue("success");
    const wrapped = asyncHandler(mockFn);

    const req = {} as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    await wrapped(req, res, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("handles synchronous throws", async () => {
    const error = new Error("Sync error");
    const mockFn = vi.fn().mockImplementation(() => {
      throw error;
    });
    const wrapped = asyncHandler(mockFn);

    const req = {} as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    await wrapped(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it("preserves the return value of the function", async () => {
    const returnValue = { data: "test" };
    const mockFn = vi.fn().mockResolvedValue(returnValue);
    const wrapped = asyncHandler(mockFn);

    const req = {} as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    const result = await wrapped(req, res, next);

    expect(result).toBe(returnValue);
  });

  it("works with async functions that modify res", async () => {
    const mockFn = vi.fn(async (req, res) => {
      res.json({ success: true });
    });
    const wrapped = asyncHandler(mockFn);

    const req = {} as Request;
    const res = { json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await wrapped(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(next).not.toHaveBeenCalled();
  });
});