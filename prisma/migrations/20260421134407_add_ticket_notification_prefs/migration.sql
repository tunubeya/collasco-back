-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "emailAssignedTickets" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailUnassignedTickets" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyAssignedTickets" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyUnassignedTickets" BOOLEAN NOT NULL DEFAULT false;
