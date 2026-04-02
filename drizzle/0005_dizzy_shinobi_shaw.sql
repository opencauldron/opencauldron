ALTER TABLE "brews" ALTER COLUMN "image_input" SET DATA TYPE jsonb
  USING CASE WHEN image_input IS NOT NULL THEN to_jsonb(ARRAY[image_input::text]) ELSE NULL END;