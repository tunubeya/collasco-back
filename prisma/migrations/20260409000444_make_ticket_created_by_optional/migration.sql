-- AlterTable
ALTER TABLE "public"."Ticket" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."TicketSection" ALTER COLUMN "authorId" DROP NOT NULL;
