-- Add mimeType and size columns to DocumentationImage
ALTER TABLE "DocumentationImage" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "DocumentationImage" ADD COLUMN "size" INTEGER;

-- Add mimeType and size columns to TicketImage
ALTER TABLE "TicketImage" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "TicketImage" ADD COLUMN "size" INTEGER;

-- Populate mimeType for existing documentation images based on file extension
UPDATE "DocumentationImage"
SET 
  "mimeType" = CASE
    WHEN LOWER("name") LIKE '%.png' THEN 'image/png'
    WHEN LOWER("name") LIKE '%.jpg' THEN 'image/jpeg'
    WHEN LOWER("name") LIKE '%.jpeg' THEN 'image/jpeg'
    WHEN LOWER("name") LIKE '%.gif' THEN 'image/gif'
    WHEN LOWER("name") LIKE '%.webp' THEN 'image/webp'
    WHEN LOWER("name") LIKE '%.svg' THEN 'image/svg+xml'
    WHEN LOWER("name") LIKE '%.pdf' THEN 'application/pdf'
    WHEN LOWER("name") LIKE '%.doc' THEN 'application/msword'
    WHEN LOWER("name") LIKE '%.docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    WHEN LOWER("name") LIKE '%.xls' THEN 'application/vnd.ms-excel'
    WHEN LOWER("name") LIKE '%.xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    WHEN LOWER("name") LIKE '%.ppt' THEN 'application/vnd.ms-powerpoint'
    WHEN LOWER("name") LIKE '%.pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    WHEN LOWER("name") LIKE '%.txt' THEN 'text/plain'
    WHEN LOWER("name") LIKE '%.json' THEN 'application/json'
    WHEN LOWER("name") LIKE '%.xml' THEN 'application/xml'
    WHEN LOWER("name") LIKE '%.zip' THEN 'application/zip'
    ELSE 'application/octet-stream'
  END
WHERE "mimeType" IS NULL;

-- Populate size as 0 for existing documentation images (unknown size)
UPDATE "DocumentationImage" SET "size" = 0 WHERE "size" IS NULL;

-- Populate mimeType for existing ticket images based on file extension
UPDATE "TicketImage"
SET 
  "mimeType" = CASE
    WHEN LOWER("name") LIKE '%.png' THEN 'image/png'
    WHEN LOWER("name") LIKE '%.jpg' THEN 'image/jpeg'
    WHEN LOWER("name") LIKE '%.jpeg' THEN 'image/jpeg'
    WHEN LOWER("name") LIKE '%.gif' THEN 'image/gif'
    WHEN LOWER("name") LIKE '%.webp' THEN 'image/webp'
    WHEN LOWER("name") LIKE '%.svg' THEN 'image/svg+xml'
    WHEN LOWER("name") LIKE '%.pdf' THEN 'application/pdf'
    WHEN LOWER("name") LIKE '%.doc' THEN 'application/msword'
    WHEN LOWER("name") LIKE '%.docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    WHEN LOWER("name") LIKE '%.xls' THEN 'application/vnd.ms-excel'
    WHEN LOWER("name") LIKE '%.xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    WHEN LOWER("name") LIKE '%.ppt' THEN 'application/vnd.ms-powerpoint'
    WHEN LOWER("name") LIKE '%.pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    WHEN LOWER("name") LIKE '%.txt' THEN 'text/plain'
    WHEN LOWER("name") LIKE '%.json' THEN 'application/json'
    WHEN LOWER("name") LIKE '%.xml' THEN 'application/xml'
    WHEN LOWER("name") LIKE '%.zip' THEN 'application/zip'
    ELSE 'application/octet-stream'
  END
WHERE "mimeType" IS NULL;

-- Populate size as 0 for existing ticket images (unknown size)
UPDATE "TicketImage" SET "size" = 0 WHERE "size" IS NULL;

-- Set NOT NULL constraints
ALTER TABLE "DocumentationImage" ALTER COLUMN "mimeType" SET NOT NULL;
ALTER TABLE "DocumentationImage" ALTER COLUMN "size" SET NOT NULL;
ALTER TABLE "TicketImage" ALTER COLUMN "mimeType" SET NOT NULL;
ALTER TABLE "TicketImage" ALTER COLUMN "size" SET NOT NULL;
