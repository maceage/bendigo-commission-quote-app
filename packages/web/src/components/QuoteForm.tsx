// Captures loan details as STRINGS (HTML inputs are string-typed),
// converts them to numbers at the submit boundary, and validates with
// the SAME shared schema the backend uses — so the form and the API
// can never disagree about what's valid. The backend stays the
// authority (defence in depth).

import { useState, type FormEvent } from "react";
import {
  MAX_LOAN_AMOUNT,
  MAX_LOAN_TERM_MONTHS,
  QuoteRequestSchema,
  RISK_BANDS,
  type QuoteRequest,
} from "@commission-quote/contract";

interface QuoteFormProps {
  onSubmit: (request: QuoteRequest) => void;
  loading: boolean;
}

interface Fields {
  loanAmount: string;
  loanTermInMonths: string;
  riskBand: string;
}

type FieldErrors = Partial<Record<keyof Fields, string>>;

const INITIAL_FIELDS: Fields = {
  loanAmount: "",
  loanTermInMonths: "",
  riskBand: "MEDIUM",
};

/** Blank -> undefined (so the schema says "Enter a …"), else a number (possibly NaN). */
function toNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

function validate(fields: Fields): { request: QuoteRequest } | { errors: FieldErrors } {
  const parsed = QuoteRequestSchema.safeParse({
    loanAmount: toNumber(fields.loanAmount),
    loanTermInMonths: toNumber(fields.loanTermInMonths),
    riskBand: fields.riskBand,
  });
  if (parsed.success) return { request: parsed.data };

  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof Fields | undefined;
    if (field !== undefined && errors[field] === undefined) errors[field] = issue.message;
  }
  return { errors };
}

export function QuoteForm({ onSubmit, loading }: QuoteFormProps) {
  const [fields, setFields] = useState<Fields>(INITIAL_FIELDS);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const update = (name: keyof Fields, value: string) => {
    setFields((f) => ({ ...f, [name]: value }));
    // Clear the field's error as soon as the user edits it.
    setFieldErrors((e) => ({ ...e, [name]: undefined }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(fields);
    if ("errors" in result) {
      setFieldErrors(result.errors);
      return;
    }
    onSubmit(result.request);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="loanAmount">Loan amount ($)</label>
        <input
          id="loanAmount"
          name="loanAmount"
          type="number"
          min="0.01"
          max={MAX_LOAN_AMOUNT}
          step="0.01"
          inputMode="decimal"
          value={fields.loanAmount}
          onChange={(e) => update("loanAmount", e.target.value)}
          aria-invalid={fieldErrors.loanAmount !== undefined}
          aria-describedby={fieldErrors.loanAmount !== undefined ? "loanAmount-error" : undefined}
          disabled={loading}
          required
        />
        {fieldErrors.loanAmount !== undefined && (
          <p className="field-error" id="loanAmount-error" role="alert">
            {fieldErrors.loanAmount}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="loanTermInMonths">Loan term (months)</label>
        <input
          id="loanTermInMonths"
          name="loanTermInMonths"
          type="number"
          min="1"
          max={MAX_LOAN_TERM_MONTHS}
          step="1"
          inputMode="numeric"
          value={fields.loanTermInMonths}
          onChange={(e) => update("loanTermInMonths", e.target.value)}
          aria-invalid={fieldErrors.loanTermInMonths !== undefined}
          aria-describedby={fieldErrors.loanTermInMonths !== undefined ? "loanTermInMonths-error" : undefined}
          disabled={loading}
          required
        />
        {fieldErrors.loanTermInMonths !== undefined && (
          <p className="field-error" id="loanTermInMonths-error" role="alert">
            {fieldErrors.loanTermInMonths}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="riskBand">Risk band</label>
        <select
          id="riskBand"
          name="riskBand"
          value={fields.riskBand}
          onChange={(e) => update("riskBand", e.target.value)}
          aria-invalid={fieldErrors.riskBand !== undefined}
          aria-describedby={fieldErrors.riskBand !== undefined ? "riskBand-error" : undefined}
          disabled={loading}
        >
          {RISK_BANDS.map((band) => (
            <option key={band} value={band}>
              {band}
            </option>
          ))}
        </select>
        {fieldErrors.riskBand !== undefined && (
          <p className="field-error" id="riskBand-error" role="alert">
            {fieldErrors.riskBand}
          </p>
        )}
      </div>

      <button type="submit" disabled={loading}>
        {loading ? "Generating quote…" : "Generate Quote"}
      </button>
    </form>
  );
}
