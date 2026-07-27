import { Prisma } from "@prisma/client";

interface TaskScopeParams {
  userId: string;
  type?: "personal" | "assigned" | "created" | "all";
  workspaceId?: string;
}

export function buildTaskScopeWhere({
  userId,
  type = "all",
  workspaceId,
}: TaskScopeParams): Prisma.TaskWhereInput {
  let where: Prisma.TaskWhereInput;

  switch (type) {
    case "personal":
      where = {
        projectId: null,
        createdById: userId,
      };
      break;

    case "assigned":
      where = {
        assignees: {
          some: { userId },
        },
      };
      break;

    case "created":
      where = {
        createdById: userId,
      };
      break;

    default:
      where = {
        OR: [
          { createdById: userId },
          { assignees: { some: { userId } } },
        ],
      };
  }

  if (workspaceId) {
    where.project = { workspaceId };
  }

  return where;
}
