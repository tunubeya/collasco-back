-- AlterTable
ALTER TABLE "public"."Ticket" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "public"."TicketReadReceipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "lastSeenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketReadReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketReadReceipt_ticketId_idx" ON "public"."TicketReadReceipt"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketReadReceipt_userId_ticketId_key" ON "public"."TicketReadReceipt"("userId", "ticketId");

-- AddForeignKey
ALTER TABLE "public"."TicketReadReceipt" ADD CONSTRAINT "TicketReadReceipt_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TicketReadReceipt" ADD CONSTRAINT "TicketReadReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
