import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateUniqueSlug } from "../../../modules/workspace/workspace.utils.js";
import { prisma } from "../../../lib/prisma.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("slugify", () => ({
  default: vi.fn((name: string) =>
    name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
  ),
}));

describe("generateUniqueSlug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates a slug from the workspace name", async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);

    const slug = await generateUniqueSlug("My Workspace");

    expect(slug).toBe("my-workspace");
  });

  it("appends a counter when slug already exists", async () => {
    vi.mocked(prisma.workspace.findUnique)
      .mockResolvedValueOnce({ slug: "my-workspace" } as any) // first attempt
      .mockResolvedValueOnce(null); // second attempt with -1

    const slug = await generateUniqueSlug("My Workspace");

    expect(slug).toBe("my-workspace-1");
  });

  it("increments counter until a unique slug is found", async () => {
    vi.mocked(prisma.workspace.findUnique)
      .mockResolvedValueOnce({ slug: "my-workspace" } as any)
      .mockResolvedValueOnce({ slug: "my-workspace-1" } as any)
      .mockResolvedValueOnce({ slug: "my-workspace-2" } as any)
      .mockResolvedValueOnce(null); // found available

    const slug = await generateUniqueSlug("My Workspace");

    expect(slug).toBe("my-workspace-3");
    expect(prisma.workspace.findUnique).toHaveBeenCalledTimes(4);
  });

  it("handles special characters in name", async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);

    const slug = await generateUniqueSlug("Hello! @World #2024");

    expect(slug).toBe("hello-world-2024");
  });

  it("strict mode slugification removes special characters", async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);

    const slug = await generateUniqueSlug("Test - Project [v2]");

    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
});
