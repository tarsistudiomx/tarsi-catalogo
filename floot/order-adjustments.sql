CREATE TABLE IF NOT EXISTS tarsi_order_adjustments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES tarsi_web_orders(id),
  reference_key text NOT NULL,
  reference text NOT NULL,
  cents integer NOT NULL CHECK (cents <> 0),
  reason text NOT NULL,
  recorded_by integer NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, reference_key)
);
