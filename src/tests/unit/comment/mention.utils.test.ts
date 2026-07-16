import { describe, it, expect } from 'vitest';
import { extractMentionedUserIds, stripMentionSyntax } from '../../../modules/comment/mention/mention.utils.js';

describe('mention.utils', () => {
  describe('extractMentionedUserIds', () => {
    it('should extract a single mentioned user ID', () => {
      const content = 'Hello @[Jane](u123), how are you?';
      expect(extractMentionedUserIds(content)).toEqual(['u123']);
    });

    it('should extract multiple mentioned user IDs', () => {
      const content = '@[Alice](u1) and @[Bob](u2) should review';
      expect(extractMentionedUserIds(content)).toEqual(['u1', 'u2']);
    });

    it('should return empty array when no mentions', () => {
      const content = 'Just a regular comment with no mentions';
      expect(extractMentionedUserIds(content)).toEqual([]);
    });

    it('should deduplicate user IDs', () => {
      const content = '@[Alice](u1) and @[Alice](u1) again';
      expect(extractMentionedUserIds(content)).toEqual(['u1']);
    });

    it('should handle empty string', () => {
      expect(extractMentionedUserIds('')).toEqual([]);
    });

    it('should handle mentions with special characters in name', () => {
      const content = '@[John Doe](u1) mentioned';
      expect(extractMentionedUserIds(content)).toEqual(['u1']);
    });

    it('should extract only the userId part (second capture group)', () => {
      const content = '@[Display Name](actual-user-id)';
      const ids = extractMentionedUserIds(content);
      expect(ids[0]).toBe('actual-user-id');
    });
  });

  describe('stripMentionSyntax', () => {
    it('should convert mention syntax to plain @name', () => {
      const content = 'Hello @[Jane](u123), how are you?';
      expect(stripMentionSyntax(content)).toBe('Hello @Jane, how are you?');
    });

    it('should convert multiple mentions', () => {
      const content = '@[Alice](u1) and @[Bob](u2)';
      expect(stripMentionSyntax(content)).toBe('@Alice and @Bob');
    });

    it('should return unchanged text when no mentions', () => {
      const content = 'No mentions here';
      expect(stripMentionSyntax(content)).toBe('No mentions here');
    });

    it('should handle empty string', () => {
      expect(stripMentionSyntax('')).toBe('');
    });

    it('should handle mixed content with mentions and plain text', () => {
      const content = 'Task assigned to @[User](uid1). Check @[Admin](uid2) for approval.';
      expect(stripMentionSyntax(content)).toBe('Task assigned to @User. Check @Admin for approval.');
    });
  });
});
