CREATE TABLE IF NOT EXISTS tarsi_web_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE DEFAULT ('TARSI-' || upper(replace(gen_random_uuid()::text, '-', ''))),
  idempotency_key uuid NOT NULL,
  request_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'Pendiente de pago' CHECK (status IN (
    'Pendiente de pago','Pago por verificar','Pagado','En preparación','Enviado','Entregado','Cancelado')),
  paid_at timestamptz,
  tracking text,
  is_test boolean NOT NULL,
  UNIQUE (is_test, idempotency_key)
);
CREATE TABLE IF NOT EXISTS tarsi_web_order_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES tarsi_web_orders(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  actor_id integer REFERENCES users(id)
);
