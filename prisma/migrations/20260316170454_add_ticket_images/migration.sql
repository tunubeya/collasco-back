-- CreateTable
CREATE TABLE "public"."TicketImage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketImage_ticketId_idx" ON "public"."TicketImage"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketImage_ticketId_name_key" ON "public"."TicketImage"("ticketId", "name");

-- AddForeignKey
ALTER TABLE "public"."TicketImage" ADD CONSTRAINT "TicketImage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TicketImage" ADD CONSTRAINT "TicketImage_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
