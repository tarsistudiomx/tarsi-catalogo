CREATE TABLE IF NOT EXISTS tarsi_live_checkout_config (
  slot boolean PRIMARY KEY DEFAULT true CHECK (slot),
  enabled boolean NOT NULL DEFAULT false,
  bank text NOT NULL,
  holder text NOT NULL,
  clabe text NOT NULL CHECK (clabe ~ '^[0-9]{18}$')
);
CREATE TABLE IF NOT EXISTS tarsi_live_checkout_budget (
  day date NOT NULL,
  category text NOT NULL CHECK (category IN ('quote','order','notify')),
  PRIMARY KEY(day,category),
  requests integer NOT NULL CHECK (requests BETWEEN 1 AND 500)
);
