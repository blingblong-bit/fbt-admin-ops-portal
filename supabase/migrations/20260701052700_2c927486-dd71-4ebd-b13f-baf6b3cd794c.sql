
DO $$
DECLARE
  pair RECORD;
  kept RECORD;
  arch RECORD;
  patch_fields text[];
  new_notes text;
  header text;
  merged_count int := 0;
  skipped_count int := 0;
BEGIN
  CREATE TEMP TABLE _hc_pairs ON COMMIT DROP AS
  WITH active_clients AS (
    SELECT * FROM clients WHERE deleted_at IS NULL
  ),
  normed AS (
    SELECT
      id, square_customer_id,
      package_price, amount_paid, package_total_visits,
      lower(regexp_replace(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '\s+', ' ', 'g')) AS nname,
      right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10) AS nphone
    FROM active_clients
  ),
  pairs AS (
    SELECT a.id AS a_id, b.id AS b_id,
           a.square_customer_id AS a_sq, b.square_customer_id AS b_sq,
           a.package_price a_price, a.amount_paid a_paid, a.package_total_visits a_tv,
           b.package_price b_price, b.amount_paid b_paid, b.package_total_visits b_tv
    FROM normed a JOIN normed b
      ON a.id < b.id
     AND a.nname = b.nname AND a.nname <> ''
     AND a.nphone = b.nphone AND length(a.nphone) = 10
  ),
  classified AS (
    SELECT *,
      (a_sq IS NOT NULL AND b_sq IS NOT NULL AND a_sq <> b_sq) AS square_conflict,
      ((coalesce(a_price,0) > 0 OR coalesce(a_tv,0) > 0)
        AND (coalesce(b_price,0) > 0 OR coalesce(b_tv,0) > 0)
        AND (coalesce(a_price,0) <> coalesce(b_price,0)
          OR coalesce(a_paid,0) <> coalesce(b_paid,0)
          OR coalesce(a_tv,0) <> coalesce(b_tv,0))) AS balance_conflict
    FROM pairs
  )
  SELECT
    LEAST(a_id, b_id) AS pair_a, GREATEST(a_id, b_id) AS pair_b,
    CASE WHEN b_sq IS NOT NULL AND a_sq IS NULL THEN b_id ELSE a_id END AS keep_id,
    CASE WHEN b_sq IS NOT NULL AND a_sq IS NULL THEN a_id ELSE b_id END AS archive_id
  FROM classified c
  WHERE NOT square_conflict
    AND NOT balance_conflict
    AND ((a_sq IS NOT NULL AND b_sq IS NULL) OR (b_sq IS NOT NULL AND a_sq IS NULL))
    AND NOT EXISTS (
      SELECT 1 FROM duplicate_client_reviews r
      WHERE r.client_a_id = LEAST(a_id, b_id)
        AND r.client_b_id = GREATEST(a_id, b_id)
        AND r.status IN ('merged','ignored','blocked')
    );

  FOR pair IN SELECT * FROM _hc_pairs LOOP
    SELECT * INTO kept FROM clients WHERE id = pair.keep_id;
    SELECT * INTO arch FROM clients WHERE id = pair.archive_id;

    IF kept.id IS NULL OR arch.id IS NULL OR arch.deleted_at IS NOT NULL THEN
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;

    patch_fields := ARRAY[]::text[];

    IF (kept.phone IS NULL OR kept.phone = '') AND arch.phone IS NOT NULL AND arch.phone <> '' THEN
      UPDATE clients SET phone = arch.phone WHERE id = kept.id;
      patch_fields := array_append(patch_fields, 'phone');
    END IF;
    IF (kept.email IS NULL OR kept.email = '') AND arch.email IS NOT NULL AND arch.email <> '' THEN
      UPDATE clients SET email = arch.email WHERE id = kept.id;
      patch_fields := array_append(patch_fields, 'email');
    END IF;
    IF (kept.package_name IS NULL OR kept.package_name = '') AND arch.package_name IS NOT NULL AND arch.package_name <> '' THEN
      UPDATE clients SET package_name = arch.package_name WHERE id = kept.id;
      patch_fields := array_append(patch_fields, 'package_name');
    END IF;
    IF kept.package_start_date IS NULL AND arch.package_start_date IS NOT NULL THEN
      UPDATE clients SET package_start_date = arch.package_start_date WHERE id = kept.id;
      patch_fields := array_append(patch_fields, 'package_start_date');
    END IF;
    IF (kept.square_visit_note IS NULL OR kept.square_visit_note = '') AND arch.square_visit_note IS NOT NULL AND arch.square_visit_note <> '' THEN
      UPDATE clients SET square_visit_note = arch.square_visit_note WHERE id = kept.id;
      patch_fields := array_append(patch_fields, 'square_visit_note');
    END IF;

    IF NOT (coalesce(kept.package_price,0) > 0 OR coalesce(kept.package_total_visits,0) > 0)
       AND (coalesce(arch.package_price,0) > 0 OR coalesce(arch.package_total_visits,0) > 0) THEN
      UPDATE clients SET
        package_price = arch.package_price,
        package_total_visits = arch.package_total_visits,
        amount_paid = arch.amount_paid,
        visits_used = COALESCE(arch.visits_used, visits_used)
      WHERE id = kept.id;
      patch_fields := array_append(patch_fields, 'package_price');
      patch_fields := array_append(patch_fields, 'package_total_visits');
      patch_fields := array_append(patch_fields, 'amount_paid');
      patch_fields := array_append(patch_fields, 'visits_used');
    END IF;

    IF arch.internal_notes IS NOT NULL AND btrim(arch.internal_notes) <> '' THEN
      header := E'\n\n--- Merged from legacy client ' || arch.first_name || ' ' || arch.last_name
             || ' (' || substr(arch.id::text, 1, 8) || ') on ' || to_char(now(), 'YYYY-MM-DD') || E' ---\n';
      new_notes := btrim(coalesce(rtrim(kept.internal_notes), '') || header || btrim(arch.internal_notes));
      UPDATE clients SET internal_notes = new_notes WHERE id = kept.id;
      patch_fields := array_append(patch_fields, 'internal_notes');
    END IF;

    UPDATE clients
      SET status = 'active', manual_active = true, deleted_at = NULL
      WHERE id = kept.id;

    UPDATE clients
      SET status = 'archived', manual_active = false
      WHERE id = arch.id;

    INSERT INTO client_activities (client_id, activity_type, description, metadata)
    VALUES
      (kept.id, 'merge',
        'Merged legacy Notes client "' || btrim(arch.first_name || ' ' || arch.last_name) || '" into this Square-linked client',
        jsonb_build_object('archived_client_id', arch.id, 'fields_copied', to_jsonb(patch_fields), 'forced', false, 'bulk', true)),
      (arch.id, 'archived',
        'Archived after merge into ' || btrim(kept.first_name || ' ' || kept.last_name) || ' (' || substr(kept.id::text,1,8) || ')',
        jsonb_build_object('kept_client_id', kept.id, 'bulk', true));

    INSERT INTO duplicate_client_reviews
      (client_a_id, client_b_id, status, kept_client_id, archived_client_id, reason, resolved_at)
    VALUES
      (pair.pair_a, pair.pair_b, 'merged', kept.id, arch.id,
       CASE WHEN array_length(patch_fields,1) > 0
            THEN 'Copied: ' || array_to_string(patch_fields, ', ')
            ELSE 'No new fields copied' END,
       now())
    ON CONFLICT (client_a_id, client_b_id) DO UPDATE
      SET status = 'merged',
          kept_client_id = EXCLUDED.kept_client_id,
          archived_client_id = EXCLUDED.archived_client_id,
          reason = EXCLUDED.reason,
          resolved_at = EXCLUDED.resolved_at;

    merged_count := merged_count + 1;
  END LOOP;

  RAISE NOTICE 'Bulk merge complete: merged=%, skipped=%', merged_count, skipped_count;
END $$;
