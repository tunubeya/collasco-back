CREATE OR REPLACE FUNCTION public.__convert_leading_whitespace(value text)
RETURNS text AS $func$
DECLARE
 result text := '';
 idx integer := 1;
 ch text;
 len integer;
 at_line_start boolean := true;
BEGIN
 IF value IS NULL OR value = '' THEN
   RETURN value;
 END IF;

 len := char_length(value);
 WHILE idx <= len LOOP
   ch := substr(value, idx, 1);
   IF ch = E'\n' THEN
     result := result || ch;
     at_line_start := true;
     idx := idx + 1;
     CONTINUE;
   END IF;
   IF at_line_start AND (ch = ' ' OR ch = E'\t') THEN
     result := result || '&nbsp;';
     idx := idx + 1;
     CONTINUE;
   END IF;
   at_line_start := false;
   result := result || ch;
   idx := idx + 1;
 END LOOP;

 RETURN result;
END;
$func$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.__wrap_plain_text(value text)
RETURNS text AS $func$
DECLARE
 trimmed text;
BEGIN
 IF value IS NULL THEN
   RETURN NULL;
 END IF;

 trimmed := btrim(value);

 IF trimmed IS NULL OR trimmed = '' THEN
   RETURN NULL;
 END IF;

 trimmed := replace(trimmed, '&', '&amp;');
 trimmed := replace(trimmed, '<', '&lt;');
 trimmed := replace(trimmed, '>', '&gt;');
 trimmed := replace(trimmed, '"', '&quot;');
 trimmed := replace(trimmed, '''', '&#39;');
 trimmed := replace(trimmed, E'\r', '');
 trimmed := public.__convert_leading_whitespace(trimmed);
 trimmed := replace(trimmed, E'\n', '<br />');

 RETURN '<p>' || trimmed || '</p>';
END;
$func$ LANGUAGE plpgsql IMMUTABLE;

UPDATE "public"."Project"
SET "description" = public.__wrap_plain_text("description")
WHERE "description" IS NOT NULL
 AND btrim("description") <> ''
 AND NOT (btrim("description") ~ '<[^>]+>');

UPDATE "public"."Module"
SET "description" = public.__wrap_plain_text("description")
WHERE "description" IS NOT NULL
 AND btrim("description") <> ''
 AND NOT (btrim("description") ~ '<[^>]+>');

DROP FUNCTION public.__wrap_plain_text(text);
DROP FUNCTION public.__convert_leading_whitespace(text);
