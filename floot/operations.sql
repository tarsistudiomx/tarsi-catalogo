CREATE TABLE IF NOT EXISTS tarsi_expenses (
  id uuid PRIMARY KEY,
  is_test boolean NOT NULL DEFAULT false,
  incurred_on date NOT NULL,
  category text NOT NULL CHECK (category IN ('production','shipping','marketing','operations','other')),
  description text NOT NULL,
  cents integer NOT NULL CHECK (cents BETWEEN 1 AND 100000000),
  recorded_by integer NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by integer REFERENCES users(id),
  void_reason text
);
CREATE INDEX IF NOT EXISTS tarsi_expenses_date_idx ON tarsi_expenses(incurred_on);
