CREATE TABLE IF NOT EXISTS tarsi_verified_payments (
  order_id uuid PRIMARY KEY REFERENCES tarsi_web_orders(id),
  is_test boolean NOT NULL,
  reference text NOT NULL,
  reference_key text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  verified_at timestamptz NOT NULL,
  verified_by integer NOT NULL REFERENCES users(id),
  note text,
  UNIQUE (is_test, reference_key)
);
CREATE TABLE IF NOT EXISTS tarsi_production_work (
  order_id uuid PRIMARY KEY REFERENCES tarsi_web_orders(id),
  queued_at timestamptz NOT NULL,
  estimated_from date NOT NULL,
  estimated_until date NOT NULL,
  started_at timestamptz,
  prepared_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  dispatch_carrier text,
  delivery_note text,
  CHECK (estimated_until >= estimated_from)
);
CREATE INDEX IF NOT EXISTS tarsi_production_queue_idx ON tarsi_production_work(queued_at, order_id);
CREATE TABLE IF NOT EXISTS tarsi_order_notifications (
  order_id uuid PRIMARY KEY REFERENCES tarsi_web_orders(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  provider_id text
);
