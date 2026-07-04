import { describe, it, expect } from 'vitest';
import { AppError, ValidationError, UnauthorizedError, ForbiddenError, NotFoundError } from '../../../utils/error.util.js';

describe('Error Utilities', () => {
  describe('AppError', () => {
    it('should create an AppError with correct properties', () => {
      const error = new AppError('Test Error', 500, 'TEST_CODE');
      expect(error.message).toBe('Test Error');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('AppError');
    });

    it('should have default statusCode of 500', () => {
      const error = new AppError('Test Error');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('ValidationError', () => {
    it('should create a ValidationError with correct properties', () => {
      const errors = { field: 'invalid' };
      const error = new ValidationError('Validation failed', errors);
      expect(error.message).toBe('Validation failed');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.errors).toEqual(errors);
    });
  });

  describe('UnauthorizedError', () => {
    it('should create an UnauthorizedError with default properties', () => {
      const error = new UnauthorizedError();
      expect(error.message).toBe('Unauthorized');
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('UNAUTHORIZED');
    });

    it('should allow custom message', () => {
      const error = new UnauthorizedError('Custom Unauthorized');
      expect(error.message).toBe('Custom Unauthorized');
    });
  });

  describe('ForbiddenError', () => {
    it('should create a ForbiddenError with default properties', () => {
      const error = new ForbiddenError();
      expect(error.message).toBe('Forbidden');
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('FORBIDDEN');
    });

    it('should allow custom message', () => {
      const error = new ForbiddenError('Custom Forbidden');
      expect(error.message).toBe('Custom Forbidden');
    });
  });

  describe('NotFoundError', () => {
    it('should create a NotFoundError with default properties', () => {
      const error = new NotFoundError();
      expect(error.message).toBe('Not found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should allow custom message', () => {
      const error = new NotFoundError('Custom Not found');
      expect(error.message).toBe('Custom Not found');
    });
  });
});
