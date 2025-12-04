-- CreateEnum
CREATE TYPE "TestRunStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "public"."TestRun"
ADD COLUMN     "status" "TestRunStatus" NOT NULL DEFAULT 'OPEN';
