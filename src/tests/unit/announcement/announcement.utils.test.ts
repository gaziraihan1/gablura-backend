import { describe, it, expect } from "vitest";

import {
  canManageAnnouncements,
  canManageProjectAnnouncements,
  canViewAnnouncement,
} from "../../../modules/announcement/announcement.utils.js";

describe("announcement.utils", () => {
  describe("canManageAnnouncements", () => {
    it("returns true for OWNER role", () => {
      expect(canManageAnnouncements("OWNER")).toBe(true);
    });

    it("returns true for ADMIN role", () => {
      expect(canManageAnnouncements("ADMIN")).toBe(true);
    });

    it("returns true for lowercase owner", () => {
      expect(canManageAnnouncements("owner")).toBe(true);
    });

    it("returns true for lowercase admin", () => {
      expect(canManageAnnouncements("admin")).toBe(true);
    });

    it("returns false for MEMBER role", () => {
      expect(canManageAnnouncements("MEMBER")).toBe(false);
    });

    it("returns false for undefined role", () => {
      expect(canManageAnnouncements(undefined)).toBe(false);
    });

    it("returns false for null role", () => {
      expect(canManageAnnouncements(null as any)).toBe(false);
    });
  });

  describe("canManageProjectAnnouncements", () => {
    it("returns true for workspace OWNER", () => {
      expect(canManageProjectAnnouncements("OWNER")).toBe(true);
    });

    it("returns true for workspace ADMIN", () => {
      expect(canManageProjectAnnouncements("ADMIN")).toBe(true);
    });

    it("returns true for project MANAGER", () => {
      expect(canManageProjectAnnouncements("MEMBER", "MANAGER")).toBe(true);
    });

    it("returns true for project LEAD", () => {
      expect(canManageProjectAnnouncements("MEMBER", "LEAD")).toBe(true);
    });

    it("returns false for MEMBER without project role", () => {
      expect(canManageProjectAnnouncements("MEMBER")).toBe(false);
    });

    it("returns false for MEMBER with non-manager project role", () => {
      expect(canManageProjectAnnouncements("MEMBER", "MEMBER")).toBe(false);
    });

    it("returns false when project role is null", () => {
      expect(canManageProjectAnnouncements("MEMBER", null)).toBe(false);
    });
  });

  describe("canViewAnnouncement", () => {
    it("returns true for PUBLIC announcements", () => {
      const announcement = {
        visibility: "PUBLIC",
        createdById: "user-1",
        targets: [],
      } as any;
      expect(canViewAnnouncement(announcement, "user-2")).toBe(true);
    });

    it("returns true for announcement creator", () => {
      const announcement = {
        visibility: "PRIVATE",
        createdById: "user-1",
        targets: [],
      } as any;
      expect(canViewAnnouncement(announcement, "user-1")).toBe(true);
    });

    it("returns true for targeted user", () => {
      const announcement = {
        visibility: "PRIVATE",
        createdById: "user-1",
        targets: [{ userId: "user-2" }],
      } as any;
      expect(canViewAnnouncement(announcement, "user-2")).toBe(true);
    });

    it("returns false for non-targeted user on PRIVATE announcement", () => {
      const announcement = {
        visibility: "PRIVATE",
        createdById: "user-1",
        targets: [{ userId: "user-3" }],
      } as any;
      expect(canViewAnnouncement(announcement, "user-2")).toBe(false);
    });

    it("returns false for non-creator on PRIVATE announcement with no targets", () => {
      const announcement = {
        visibility: "PRIVATE",
        createdById: "user-1",
        targets: [],
      } as any;
      expect(canViewAnnouncement(announcement, "user-2")).toBe(false);
    });

    it("handles multiple targets", () => {
      const announcement = {
        visibility: "PRIVATE",
        createdById: "user-1",
        targets: [
          { userId: "user-2" },
          { userId: "user-3" },
          { userId: "user-4" },
        ],
      } as any;
      expect(canViewAnnouncement(announcement, "user-3")).toBe(true);
    });
  });
});