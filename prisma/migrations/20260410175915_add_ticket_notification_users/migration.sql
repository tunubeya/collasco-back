-- CreateTable
CREATE TABLE "public"."TicketNotifyUser" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketNotifyUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TicketEmailUser" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEmailUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketNotifyUser_ticketId_userId_key" ON "public"."TicketNotifyUser"("ticketId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketEmailUser_ticketId_userId_key" ON "public"."TicketEmailUser"("ticketId", "userId");

-- AddForeignKey
ALTER TABLE "public"."TicketNotifyUser" ADD CONSTRAINT "TicketNotifyUser_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TicketNotifyUser" ADD CONSTRAINT "TicketNotifyUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TicketEmailUser" ADD CONSTRAINT "TicketEmailUser_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TicketEmailUser" ADD CONSTRAINT "TicketEmailUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;