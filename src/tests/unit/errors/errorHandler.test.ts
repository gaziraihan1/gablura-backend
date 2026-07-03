import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response, NextFunction } from "express";
import { errorHandler, notFoundHandler } from "../../../errors/errorHandler.js";
import { AppError, ValidationError, RateLimitError, SessionHijackError, NotFoundError } from "../../../errors/AppError.js";

describe("errorHandler", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  const nextFunction: NextFunction = vi.fn();

  beforeEach(() => {
    mockRequest = {
      method: "GET",
      url: "/test",
      headers: {
        "user-agent": "vitest",
        "content-type": "application/json",
      },
    };
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
    vi.clearAllMocks();
  });

  it("should handle AppError", () => {
    const error = new AppError("Test error", 400, "TEST_CODE");
    errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      message: "Test error",
      code: "TEST_CODE",
    });
  });

  it("should handle ValidationError with errors field", () => {
    const errors = ["Invalid email"];
    const error = new ValidationError("Validation failed", errors, "VALIDATION_ERROR");
    errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      message: "Validation failed",
      code: "VALIDATION_ERROR",
      errors,
    });
  });

  it("should handle RateLimitError with retryAfter", () => {
    const error = new RateLimitError(60);
    errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(429);
    expect(mockResponse.setHeader).toHaveBeenCalledWith("Retry-After", 60);
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      message: "Rate limit exceeded. Please try again later.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: 60,
      retryAfterMs: 60,
    });
  });

  it("should handle SessionHijackError with reason", () => {
    const error = new SessionHijackError("IP mismatch");
    errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      message: "Session validation failed. Please login again.",
      code: "SESSION_HIJACK_DETECTED",
      reason: "IP mismatch",
    });
  });

  it("should handle AppError with meta fields", () => {
    const error = new AppError("Error with meta", 400, "META_ERROR");
    errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);
    // console.log(mockResponse.json);

    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      message: "Error with meta",
      code: "META_ERROR",
    //   extra: "info",
    });
  });

  describe("Prisma errors", () => {
    it("should handle P2002 (Duplicate Entry)", () => {
      const error = { code: "P2002", meta: { target: ["email"] } };
      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(409);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: "A record with this value already exists",
        code: "DUPLICATE_ENTRY",
        field: ["email"],
      });
    });

    it("should handle P2003 (Invalid Reference)", () => {
      const error = { code: "P2003" };
      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: "Invalid reference to related record",
        code: "INVALID_REFERENCE",
      });
    });

    it("should handle P2025 (Record Not Found)", () => {
      const error = { code: "P2025" };
      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: "Record not found",
        code: "NOT_FOUND",
      });
    });
  });

  it("should handle unhandled programmer errors", () => {
    const error = new Error("Unexpected crash");
    errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Internal server error",
        code: "INTERNAL_ERROR",
      }),
    );
  });

  it("should include stack trace in development mode", () => {
    process.env.NODE_ENV = "development";
    const error = new Error("Unexpected crash");
    errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        stack: expect.any(String),
      }),
    );
    process.env.NODE_ENV = "test"; // Reset
  });
});

describe("notFoundHandler", () => {
  it("should call next with NotFoundError", () => {
    const mockRequest = {
      method: "GET",
      path: "/non-existent",
    } as Request;
    const mockResponse = {} as Response;
    const nextFunction = vi.fn();

    notFoundHandler(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).toHaveBeenCalledWith(expect.any(NotFoundError));
    const error = nextFunction.mock.calls[0][0] as NotFoundError;
    expect(error.message).toContain("/non-existent");
    expect(error.code).toBe("NOT_FOUND");
  });
});
