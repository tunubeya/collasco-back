  -- Paso 1: crear columna opcional
  ALTER TABLE "public"."FeatureLink"
  ADD COLUMN "initiatorFeatureId" TEXT;

  -- Paso 2: rellenar con los valores existentes
  UPDATE "public"."FeatureLink"
  SET "initiatorFeatureId" = "featureId"
  WHERE "initiatorFeatureId" IS NULL;

  -- Paso 3: marcarla como NOT NULL
  ALTER TABLE "public"."FeatureLink"
  ALTER COLUMN "initiatorFeatureId" SET NOT NULL;

  -- Paso 4: índice + FK
  CREATE INDEX "FeatureLink_initiatorFeatureId_idx"
  ON "public"."FeatureLink"("initiatorFeatureId");

  ALTER TABLE "public"."FeatureLink"
  ADD CONSTRAINT "FeatureLink_initiatorFeatureId_fkey"
  FOREIGN KEY ("initiatorFeatureId") REFERENCES "public"."Feature"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;