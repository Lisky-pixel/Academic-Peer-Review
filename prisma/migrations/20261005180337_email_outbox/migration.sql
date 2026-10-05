-- DropIndex
DROP INDEX "EmailLog_status_createdAt_idx";

-- AlterTable
ALTER TABLE "EmailLog" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "payload" JSONB;

-- CreateIndex
CREATE INDEX "EmailLog_status_nextAttemptAt_idx" ON "EmailLog"("status", "nextAttemptAt");
