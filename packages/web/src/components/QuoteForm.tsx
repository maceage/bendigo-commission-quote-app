// ===== packages/web/src/components/QuoteForm.tsx =====
//
// Captures loan details as STRINGS (HTML inputs are string-typed),
// coerces to numbers at the boundary, and hands the caller a
// QuoteRequest. Field-level validation happens here for instant
// feedback; the backend remains the authority (defence in depth).

import { useState, type FormEvent } from "react";
import { RISK_BANDS, type QuoteRequest } from "@commission-quote/contract";

interface QuoteFormProps {
  onSubmit: (request: QuoteRequest) => void;
  loading: boolean;
}

interface Fields {
  loanAmount: string;
  loanTermInMonths: string;
  riskBand: string;
}

const INITIAL_FIELDS: Fields = {
  loanAmount: "",
  loanTermInMonths: "",
  riskBand: "MEDIUM",
};

export function QuoteForm({ onSubmit, loading }: QuoteFormProps) {
  const [fields, setFields] = useState<Fields>(INITIAL_FIELDS);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Fields, string>>>({});

  const update = (name: keyof Fields, value: string) => {
    setFields((f) => ({ ...f, [name]: value }));
    // Clear the field's error as soon as the user edits it.
    setFieldErrors((e) => ({ ...e, [name]: undefined }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    // Coerce ONCE at the submit boundary — components downstream
    // only ever see real numbers, never strings-that-look-like-numbers.
    const loanAmount = Number(fields.loanAmount);
    const loanTermInMonths = Number(fields.loanTermInMonths);

    const errors: typeof fieldErrors = {};
    if (!Number.isFinite(loanAmount) || loanAmount <= 0) {
      errors.loanAmount = "Enter a loan amount greater than zero.";
    }
    if (!Number.isInteger(loanTermInMonths) || loanTermInMonths <= 0) {
      errors.loanTermInMonths = "Enter a whole number of months.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    onSubmit({ loanAmount, loanTermInMonths, riskBand: fields.riskBand as QuoteRequest["riskBand"] });
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="loanAmount">Loan amount ($)</label>
        <input
          id="loanAmount"
          name="loanAmount"
          type="number"
          min="1"
          step="1"
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
          disabled={loading}
        >
          {RISK_BANDS.map((band) => (
            <option key={band} value={band}>
              {band}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" disabled={loading}>
        {loading ? "Generating quote…" : "Generate Quote"}
      </button>
    </form>
  );
}