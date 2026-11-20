BEGIN;
CREATE SEQUENCE IF NOT EXISTS tarsi_short_order_seq AS bigint START 1 NO CYCLE;
CREATE TABLE IF NOT EXISTS tarsi_preview_integration (
  slot boolean PRIMARY KEY DEFAULT true CHECK (slot),
  storefront_auth_sha256 text NOT NULL CHECK (storefront_auth_sha256 ~ '^[a-f0-9]{64}$'),
  mail_auth_sha256 text NOT NULL CHECK (mail_auth_sha256 ~ '^[a-f0-9]{64}$'),
  storefront_url text NOT NULL
);
CREATE TABLE IF NOT EXISTS tarsi_live_integration (
  slot boolean PRIMARY KEY DEFAULT true CHECK (slot),
  storefront_auth_sha256 text NOT NULL CHECK (storefront_auth_sha256 ~ '^[a-f0-9]{64}$'),
  mail_auth_sha256 text NOT NULL CHECK (mail_auth_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE TABLE IF NOT EXISTS tarsi_order_flow (
  order_id uuid PRIMARY KEY REFERENCES tarsi_web_orders(id),
  recovery_key uuid NOT NULL UNIQUE,
  recover_until timestamptz NOT NULL DEFAULT (now()+interval '30 days'),
  revoked_at timestamptz,
  hold_until timestamptz,
  renewals integer NOT NULL DEFAULT 0 CHECK (renewals BETWEEN 0 AND 2),
  last_issue text
);
CREATE TABLE IF NOT EXISTS tarsi_blank_policy (
  is_test boolean PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS tarsi_blank_stock (
  is_test boolean NOT NULL,
  size text NOT NULL CHECK (size IN ('S','M','L','XL','XXL')),
  on_hand integer NOT NULL CHECK (on_hand>=0),
  low_at integer NOT NULL CHECK (low_at>=0),
  restock_on date,
  PRIMARY KEY(is_test,size)
);
CREATE TABLE IF NOT EXISTS tarsi_blank_holds (
  order_id uuid NOT NULL REFERENCES tarsi_order_flow(order_id),
  is_test boolean NOT NULL,
  size text NOT NULL,
  qty integer NOT NULL CHECK(qty>0),
  assigned_at timestamptz,
  PRIMARY KEY(order_id,size),
  FOREIGN KEY(is_test,size) REFERENCES tarsi_blank_stock(is_test,size)
);
CREATE INDEX IF NOT EXISTS tarsi_blank_holds_active_idx ON tarsi_blank_holds(is_test,size) WHERE assigned_at IS NULL;
CREATE TABLE IF NOT EXISTS tarsi_blank_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  is_test boolean NOT NULL,
  size text NOT NULL,
  qty integer NOT NULL CHECK(qty<>0),
  order_id uuid REFERENCES tarsi_web_orders(id),
  actor_id integer REFERENCES users(id),
  reason text NOT NULL,
  moved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tarsi_transfer_reports (
  order_id uuid PRIMARY KEY REFERENCES tarsi_web_orders(id),
  is_test boolean NOT NULL,
  bank text NOT NULL,
  reference text,
  reference_key text,
  transferred_on date NOT NULL,
  cents integer NOT NULL CHECK(cents>0),
  details text,
  reported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(is_test,reference_key)
);
CREATE TABLE IF NOT EXISTS tarsi_mail_outbox (
  order_id uuid NOT NULL REFERENCES tarsi_web_orders(id),
  kind text NOT NULL CHECK(kind IN ('registered','reminder','reported','confirmed','recovery')),
  due_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','suppressed','review','failed')),
  claimed_at timestamptz,
  claim_id uuid,
  accepted_at timestamptz,
  provider_id text,
  last_error text,
  PRIMARY KEY(order_id,kind)
);
ALTER TABLE tarsi_mail_outbox ADD COLUMN IF NOT EXISTS claim_id uuid;
CREATE INDEX IF NOT EXISTS tarsi_mail_due_idx ON tarsi_mail_outbox(due_at) WHERE state='pending';

-- Caller locks the order row before allocating or renewing.
-- All sizes are locked in the same order, independent of the design.
CREATE OR REPLACE FUNCTION tarsi_allocate_blanks(p_order uuid,p_assign boolean,p_actor integer DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_test boolean;
  v_policy boolean;
  v_payload jsonb;
  v_size text;
  v_qty integer;
  v_available integer;
BEGIN
  SELECT is_test,payload INTO v_test,v_payload FROM tarsi_web_orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT enabled INTO v_policy FROM tarsi_blank_policy WHERE is_test=v_test FOR SHARE;
  IF NOT coalesce(v_policy,false) THEN RETURN true; END IF;
  IF NOT EXISTS (SELECT 1 FROM tarsi_order_flow WHERE order_id=p_order) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM tarsi_blank_holds WHERE order_id=p_order AND assigned_at IS NOT NULL) THEN RETURN p_assign; END IF;
  PERFORM 1 FROM tarsi_blank_stock b WHERE b.is_test=v_test ORDER BY b.size FOR UPDATE;
  FOR v_size,v_qty IN
    SELECT item->>'size',sum((item->>'qty')::int)::int FROM jsonb_array_elements(v_payload->'items') item
    GROUP BY item->>'size' ORDER BY item->>'size'
  LOOP
    SELECT b.on_hand - COALESCE((
      SELECT sum(h.qty)::int FROM tarsi_blank_holds h JOIN tarsi_order_flow f ON f.order_id=h.order_id
      WHERE h.is_test=v_test AND h.size=v_size AND h.order_id<>p_order AND h.assigned_at IS NULL
        AND f.hold_until>clock_timestamp()
    ),0) INTO v_available FROM tarsi_blank_stock b WHERE b.is_test=v_test AND b.size=v_size;
    IF v_available IS NULL OR v_available<v_qty THEN RETURN false; END IF;
  END LOOP;
  FOR v_size,v_qty IN
    SELECT item->>'size',sum((item->>'qty')::int)::int FROM jsonb_array_elements(v_payload->'items') item
    GROUP BY item->>'size' ORDER BY item->>'size'
  LOOP
    INSERT INTO tarsi_blank_holds(order_id,is_test,size,qty,assigned_at)
      VALUES (p_order,v_test,v_size,v_qty,CASE WHEN p_assign THEN now() ELSE NULL END)
      ON CONFLICT(order_id,size) DO UPDATE SET qty=excluded.qty,assigned_at=excluded.assigned_at;
    IF p_assign THEN
      UPDATE tarsi_blank_stock SET on_hand=on_hand-v_qty WHERE is_test=v_test AND size=v_size;
      INSERT INTO tarsi_blank_movements(is_test,size,qty,order_id,actor_id,reason)
        VALUES(v_test,v_size,-v_qty,p_order,p_actor,'Pago verificado');
    END IF;
  END LOOP;
  UPDATE tarsi_order_flow SET hold_until=CASE WHEN p_assign THEN NULL ELSE clock_timestamp()+interval '30 minutes' END WHERE order_id=p_order;
  RETURN true;
END $$;
COMMIT;
