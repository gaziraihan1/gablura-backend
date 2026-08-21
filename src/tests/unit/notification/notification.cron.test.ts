import { describe, it, expect, vi, beforeEach } from "vitest";
import { startTaskReminderCron } from "../../../modules/notification/notification.cron.js";
import cron from "node-cron";

vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn(),
  },
}));

describe("Notification Cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should schedule task reminder cron", () => {
    startTaskReminderCron();
    expect(cron.schedule).toHaveBeenCalledWith("*/15 * * * *", expect.any(Function));
  });
});
