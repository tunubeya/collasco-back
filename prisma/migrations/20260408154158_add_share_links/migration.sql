/*
  Warnings:

  - A unique constraint covering the columns `[followUpToken]` on the table `Ticket` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[shareLinkId]` on the table `Ticket` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Ticket" ADD COLUMN     "followUpToken" TEXT,
ADD COLUMN     "publicReporterEmail" TEXT,
ADD COLUMN     "shareLinkId" TEXT;

-- CreateTable
CREATE TABLE "public"."TicketShareLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "TicketShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketShareLink_token_key" ON "public"."TicketShareLink"("token");

-- CreateIndex
CREATE INDEX "TicketShareLink_projectId_idx" ON "public"."TicketShareLink"("projectId");

-- CreateIndex
CREATE INDEX "TicketShareLink_createdById_idx" ON "public"."TicketShareLink"("createdById");

-- CreateIndex
CREATE INDEX "TicketShareLink_token_idx" ON "public"."TicketShareLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_followUpToken_key" ON "public"."Ticket"("followUpToken");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_shareLinkId_key" ON "public"."Ticket"("shareLinkId");

-- CreateIndex
CREATE INDEX "Ticket_followUpToken_idx" ON "public"."Ticket"("followUpToken");

-- AddForeignKey
ALTER TABLE "public"."Ticket" ADD CONSTRAINT "Ticket_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "public"."TicketShareLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TicketShareLink" ADD CONSTRAINT "TicketShareLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TicketShareLink" ADD CONSTRAINT "TicketShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
