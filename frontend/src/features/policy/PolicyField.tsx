import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./PolicyField.module.css";

interface PolicyFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  suffix?: ReactNode;
}

export const PolicyField = ({ label, hint, error, suffix, id, ...inputProps }: PolicyFieldProps) => {
  const inputId = id ?? `policy-field-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <label className={styles.row} htmlFor={inputId}>
      <span className={styles.label}>{label}</span>
      <span className={styles.inputWrap}>
        <input id={inputId} className={[styles.input, error && styles.invalid].filter(Boolean).join(" ")} {...inputProps} />
        {suffix}
      </span>
      {error ? <span className={styles.error}>{error}</span> : hint ? <span className={styles.hint}>{hint}</span> : null}
    </label>
  );
};
