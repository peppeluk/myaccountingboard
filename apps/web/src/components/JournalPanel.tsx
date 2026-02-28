import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountOption } from "../data/pianoDeiConti";

export type JournalEntry = {
  id: string;
  date: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: string;
  credit: string;
  closeLine: boolean;
};

type JournalPanelProps = {
  isOpen: boolean;
  entries: JournalEntry[];
  accounts: readonly AccountOption[];
  isExtracting: boolean;
  minRows: number;
  onClose: () => void;
  onExtract: () => void;
  onAddEntry: () => void;
  onClearEntries: () => void;
  onRemoveEntry: (entryId: string) => void;
  onUpdateEntry: (entryId: string, patch: Partial<JournalEntry>) => void;
};

type AccountPickerProps = {
  inputId: string;
  entry: JournalEntry;
  accounts: readonly AccountOption[];
  onUpdate: (patch: Pick<JournalEntry, "accountCode" | "accountName">) => void;
};

function normalizeForSearch(value: string): string {
  return value
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

const amountFormatter = new Intl.NumberFormat("it-IT", {
  style: 'decimal',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

function sanitizeAmountTyping(value: string): string {
  const stripped = value.replace(/[^\d.,-]/g, "");
  if (!stripped) {
    return "";
  }
  const withoutExtraMinus = stripped.replace(/(?!^)-/g, "");
  return withoutExtraMinus;
}

function parseAmountInput(rawValue: string): number | null {
  const cleaned = rawValue.replace(/\s/g, "").replace(/[^0-9,.-]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "," || cleaned === ".") {
    return null;
  }

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;

  if (hasComma) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const parts = cleaned.split(".");
    if (parts.length > 2) {
      normalized = parts.join("");
    } else {
      const [integerPart, fractionPart = ""] = parts;
      const looksLikeThousands =
        fractionPart.length === 3 && integerPart.replace("-", "").length <= 3;
      const looksLikeDecimal =
        fractionPart.length <= 2 && integerPart.replace("-", "").length >= 1;

      if (looksLikeThousands) {
        // Es: 1.234 -> 1234
        normalized = `${integerPart}${fractionPart}`;
      } else if (looksLikeDecimal) {
        // Es: 12.34 -> 12.34
        normalized = `${integerPart}.${fractionPart}`;
      } else if (fractionPart.length > 2) {
        // Es: 12.345 -> 12345 (treat as thousands)
        normalized = `${integerPart}${fractionPart}`;
      } else {
        // Default: treat as decimal
        normalized = `${integerPart}.${fractionPart}`;
      }
    }
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function formatAmountForDisplay(rawValue: string): string {
  const parsed = parseAmountInput(rawValue);
  if (parsed === null) {
    return "";
  }
  return amountFormatter.format(parsed);
}

function AccountPicker({ inputId, entry, accounts, onUpdate }: AccountPickerProps) {
  const [query, setQuery] = useState(entry.accountName);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setQuery(entry.accountName);
  }, [entry.accountName]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onGlobalPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!rootRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", onGlobalPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onGlobalPointerDown);
    };
  }, [isOpen]);

  const filteredAccounts = useMemo(() => {
    const search = normalizeForSearch(query);
    if (!search) {
      return accounts.slice(0, 40);
    }
    return accounts
      .filter((account) => {
        const code = normalizeForSearch(account.code);
        const name = normalizeForSearch(account.name);
        return (
          code.includes(search) ||
          name.includes(search) ||
          normalizeForSearch(`${account.code} ${account.name}`).includes(search)
        );
      })
      .slice(0, 40);
  }, [accounts, query]);

  const applyAccount = (account: AccountOption) => {
    setQuery(account.name);
    onUpdate({
      accountCode: account.code,
      accountName: account.name
    });
    setIsOpen(false);
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    setIsOpen(true);
    const normalizedValue = normalizeForSearch(value);
    const exactMatch = accounts.find(
      (account) =>
        normalizeForSearch(account.name) === normalizedValue ||
        normalizeForSearch(`${account.code} ${account.name}`) === normalizedValue
    );

    if (exactMatch) {
      onUpdate({
        accountCode: exactMatch.code,
        accountName: exactMatch.name
      });
      return;
    }

    onUpdate({
      accountCode: "",
      accountName: value
    });
  };

  return (
    <div className="account-picker" ref={rootRef}>
      <input
        id={inputId}
        value={query}
        onFocus={() => setIsOpen(true)}
        onChange={(event) => handleInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsOpen(false);
            return;
          }
          if (event.key === "Enter" && filteredAccounts.length > 0) {
            event.preventDefault();
            applyAccount(filteredAccounts[0]);
          }
        }}
        placeholder="Cerca conto..."
      />
      {isOpen && (
        <div className="account-dropdown" role="listbox" aria-label="Piano dei conti">
          {filteredAccounts.length === 0 && (
            <div className="account-empty">Nessun conto trovato</div>
          )}
          {filteredAccounts.map((account) => (
            <button
              key={account.code}
              type="button"
              className={`account-option ${entry.accountCode === account.code ? "selected" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                applyAccount(account);
              }}
            >
              <span className="account-option-code">{account.code}</span>
              <span className="account-option-name">{account.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function JournalPanel({
  isOpen,
  entries,
  accounts,
  isExtracting,
  minRows,
  onClose,
  onExtract,
  onAddEntry,
  onClearEntries,
  onRemoveEntry,
  onUpdateEntry
}: JournalPanelProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <section className="journal-panel" aria-label="Scheda Prima Nota">
      <header className="journal-panel-header">
        <h3>Prima Nota</h3>
        <button type="button" onClick={onClose} className="icon-button" aria-label="Chiudi Prima Nota">
          <i className="fa-solid fa-xmark" />
          <span className="sr-only">Chiudi Prima Nota</span>
        </button>
      </header>

      <div className="journal-table-wrap">
        <table className="journal-table">
          <thead>
            <tr>
              <th className="journal-date-column">Data</th>
              <th className="journal-account-code-column">Codice</th>
              <th>Conto</th>
              <th>Descrizione</th>
              <th className="journal-amount-column">DARE</th>
              <th className="journal-amount-column">AVERE</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="journal-date-cell" style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={entry.date ? new Date(entry.date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) : ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value.length === 5 && value.includes('/')) {
                        const [day, month] = value.split('/');
                        const year = new Date().getFullYear();
                        const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                        onUpdateEntry(entry.id, { date: isoDate });
                      } else if (value === '') {
                        onUpdateEntry(entry.id, { date: '' });
                      }
                    }}
                    placeholder="gg/mm"
                    maxLength={5}
                    style={{ paddingRight: '30px' }}
                  />
                  <input
                    id={`journal-date-${entry.id}`}
                    type="date"
                    value={entry.date}
                    onChange={(event) => {
                      onUpdateEntry(entry.id, { date: event.target.value });
                    }}
                    style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const dateInput = document.querySelector(`#journal-date-${entry.id}`) as HTMLInputElement;
                      if (dateInput) {
                        dateInput.style.opacity = '1';
                        dateInput.style.pointerEvents = 'auto';
                        dateInput.showPicker();
                        dateInput.addEventListener('change', () => {
                          dateInput.style.opacity = '0';
                          dateInput.style.pointerEvents = 'none';
                        }, { once: true });
                      }
                    }}
                    style={{ 
                      position: 'absolute', 
                      right: '8px', 
                      top: '50%', 
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '2px',
                      fontSize: '14px'
                    }}
                  >
                    📅
                  </button>
                </td>
                <td className="journal-account-code-cell">
                  {entry.accountCode || <span className="journal-account-code-placeholder">-</span>}
                </td>
                <td className={entry.closeLine ? "journal-account-cell journal-close-line-cell" : "journal-account-cell"}>
                  <AccountPicker
                    inputId={`journal-account-${entry.id}`}
                    entry={entry}
                    accounts={accounts}
                    onUpdate={(patch) => onUpdateEntry(entry.id, patch)}
                  />
                </td>
                <td className={entry.closeLine ? "journal-close-line-cell" : undefined}>
                  <input
                    value={entry.description}
                    onChange={(event) => {
                      onUpdateEntry(entry.id, { description: event.target.value });
                    }}
                    placeholder="Descrizione"
                  />
                </td>
                <td className="journal-amount-cell">
                  <input
                    value={entry.debit}
                    inputMode="decimal"
                    onChange={(event) => {
                      onUpdateEntry(entry.id, { debit: sanitizeAmountTyping(event.target.value) });
                    }}
                    onBlur={() => {
                      onUpdateEntry(entry.id, { debit: formatAmountForDisplay(entry.debit) });
                    }}
                    placeholder="0,00"
                  />
                </td>
                <td className="journal-amount-cell">
                  <input
                    value={entry.credit}
                    inputMode="decimal"
                    onChange={(event) => {
                      onUpdateEntry(entry.id, { credit: sanitizeAmountTyping(event.target.value) });
                    }}
                    onBlur={() => {
                      onUpdateEntry(entry.id, { credit: formatAmountForDisplay(entry.credit) });
                    }}
                    placeholder="0,00"
                  />
                </td>
                <td className="journal-remove-cell">
                  <button
                    type="button"
                    className={`icon-button ${entry.closeLine ? "active" : ""}`}
                    aria-label={entry.closeLine ? "Rimuovi linea di chiusura" : "Aggiungi linea di chiusura"}
                    onClick={() => onUpdateEntry(entry.id, { closeLine: !entry.closeLine })}
                    title="Chiudi registrazione"
                  >
                    <i className="fa-solid fa-minus" />
                    <span className="sr-only">Chiudi registrazione</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Rimuovi riga"
                    onClick={() => onRemoveEntry(entry.id)}
                    disabled={entries.length <= minRows}
                  >
                    <i className="fa-solid fa-trash" />
                    <span className="sr-only">Rimuovi riga</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="journal-panel-footer">
        <div className="journal-panel-actions journal-panel-actions-bottom">
          <button type="button" onClick={onAddEntry}>
            + Riga
          </button>
          <button type="button" onClick={onClearEntries}>
            Svuota
          </button>
          <button type="button" onClick={onExtract} disabled={isExtracting}>
            {isExtracting ? "Estrazione..." : "Estrai .xlsx"}
          </button>
        </div>
        <p>
          Il campo E usa il piano dei conti caricato dal modello. Il file estratto aggiorna il foglio tecnico
          LIBRO_GIORNALE.
        </p>
      </footer>
    </section>
  );
}
