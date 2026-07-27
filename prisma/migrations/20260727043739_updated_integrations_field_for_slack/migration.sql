-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "slackChannelId" TEXT,
ADD COLUMN     "slackMessageTs" TEXT,
ADD COLUMN     "slackMessageUrl" TEXT,
ADD COLUMN     "slackThreadTs" TEXT,
ADD COLUMN     "slackUserDisplayName" TEXT,
ADD COLUMN     "slackUserId" TEXT;
