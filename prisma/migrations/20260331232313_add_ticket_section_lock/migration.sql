-- AlterTable
ALTER TABLE "public"."TicketSection" ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedById" TEXT;

-- CreateIndex
CREATE INDEX "TicketSection_lockedById_idx" ON "public"."TicketSection"("lockedById");

-- AddForeignKey
ALTER TABLE "public"."TicketSection" ADD CONSTRAINT "TicketSection_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
