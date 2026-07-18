import { useState } from "react";
import { Plus, X } from "lucide-react";
import styles from "./ListEditor.module.css";

interface ListEditorProps {
  label: string;
  hint?: string;
  values: string[];
  placeholder?: string;
  onChange: (values: string[]) => void;
}

export const ListEditor = ({ label, hint, values, placeholder, onChange }: ListEditorProps) => {
  const [draft, setDraft] = useState("");

  const addValue = () => {
    const trimmed = draft.trim();
    if (!trimmed || values.includes(trimmed)) return;
    onChange([...values, trimmed]);
    setDraft("");
  };

  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{label}</span>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          value={draft}
          placeholder={placeholder}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              addValue();
            }
          }}
        />
        <button type="button" className={styles.addButton} onClick={addValue}>
          <Plus size={13} /> Thêm
        </button>
      </div>
      {values.length > 0 && (
        <div className={styles.chips}>
          {values.map(value => (
            <span className={styles.chip} key={value}>
              {value}
              <button type="button" aria-label={`Xoá ${value}`} onClick={() => onChange(values.filter(v => v !== value))}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
};
