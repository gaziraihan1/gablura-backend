import { describe, it, expect } from 'vitest';
import { createContactMessageSchema, ContactCategory } from '../../../modules/contact/contact.validator.js';

describe('contact.validator', () => {
  const validInput = {
    name: 'John Doe',
    email: 'john@example.com',
    subject: 'Help needed with billing',
    category: 'BILLING',
    message: 'I need help with my subscription. Please assist me.',
  };

  describe('createContactMessageSchema', () => {
    it('should accept valid input', () => {
      const result = createContactMessageSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should trim and lowercase email', () => {
      const result = createContactMessageSchema.safeParse({
        ...validInput,
        email: '  JOHN@EXAMPLE.COM  ',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.email).toBe('john@example.com');
    });

    it('should trim name', () => {
      const result = createContactMessageSchema.safeParse({
        ...validInput,
        name: '  John Doe  ',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.name).toBe('John Doe');
    });

    it('should reject name under 2 chars', () => {
      const result = createContactMessageSchema.safeParse({ ...validInput, name: 'J' });
      expect(result.success).toBe(false);
    });

    it('should reject name over 100 chars', () => {
      const result = createContactMessageSchema.safeParse({ ...validInput, name: 'x'.repeat(101) });
      expect(result.success).toBe(false);
    });

    it('should reject invalid email', () => {
      const result = createContactMessageSchema.safeParse({ ...validInput, email: 'not-email' });
      expect(result.success).toBe(false);
    });

    it('should reject subject under 5 chars', () => {
      const result = createContactMessageSchema.safeParse({ ...validInput, subject: 'Hi' });
      expect(result.success).toBe(false);
    });

    it('should reject subject over 200 chars', () => {
      const result = createContactMessageSchema.safeParse({ ...validInput, subject: 'x'.repeat(201) });
      expect(result.success).toBe(false);
    });

    it('should reject message under 20 chars', () => {
      const result = createContactMessageSchema.safeParse({ ...validInput, message: 'Short' });
      expect(result.success).toBe(false);
    });

    it('should reject message over 5000 chars', () => {
      const result = createContactMessageSchema.safeParse({ ...validInput, message: 'x'.repeat(5001) });
      expect(result.success).toBe(false);
    });

    it('should accept all valid categories', () => {
      const categories = ['GENERAL', 'BILLING', 'TECHNICAL', 'FEATURE_REQUEST', 'PARTNERSHIP', 'SECURITY', 'OTHER'];
      for (const cat of categories) {
        const result = createContactMessageSchema.safeParse({ ...validInput, category: cat });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid category', () => {
      const result = createContactMessageSchema.safeParse({ ...validInput, category: 'INVALID' });
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const result = createContactMessageSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('ContactCategory enum', () => {
    it('should have 7 valid categories', () => {
      expect(ContactCategory.options).toHaveLength(7);
    });
  });
});
