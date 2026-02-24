-- AlterTable
ALTER TABLE "public"."ManualShareLink" ADD COLUMN     "rootId" TEXT,
ADD COLUMN     "rootType" "public"."DocumentationEntityType";
