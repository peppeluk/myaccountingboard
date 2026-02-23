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
};

type JournalPanelProps = {
  isOpen: boolean;
  entries: JournalEntry[];
  accounts: readonly AccountOption[];
  isExtracting: boolean;
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
        placeholder="Cerca conto (codice o nome)"
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
    <section className="journal-panel" aria-label="Scheda Libro Giornale">
      <header className="journal-panel-header">
        <h3>giornale_data (campi D:E:F:G:H)</h3>
        <div className="journal-panel-actions">
          <button type="button" onClick={onExtract} disabled={isExtracting}>
            {isExtracting ? "Estrazione..." : "Estrai .xlsx"}
          </button>
          <button type="button" onClick={onAddEntry}>
            + Riga
          </button>
          <button type="button" onClick={onClearEntries}>
            Svuota
          </button>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Chiudi Libro Giornale">
            <i className="fa-solid fa-xmark" />
            <span className="sr-only">Chiudi Libro Giornale</span>
          </button>
        </div>
      </header>

      <div className="journal-table-wrap">
        <table className="journal-table">
          <thead>
            <tr>
              <th>Riga</th>
              <th>D - Data</th>
              <th>E - Conto</th>
              <th>F - Descrizione</th>
              <th>G - Dare</th>
              <th>H - Avere</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={entry.id}>
                <td className="journal-row-index">{index + 11}</td>
                <td>
                  <input
                    type="date"
                    value={entry.date}
                    onChange={(event) => {
                      onUpdateEntry(entry.id, { date: event.target.value });
                    }}
                  />
                </td>
                <td className="journal-account-cell">
                  <AccountPicker
                    inputId={`journal-account-${entry.id}`}
                    entry={entry}
                    accounts={accounts}
                    onUpdate={(patch) => onUpdateEntry(entry.id, patch)}
                  />
                </td>
                <td>
                  <input
                    value={entry.description}
                    onChange={(event) => {
                      onUpdateEntry(entry.id, { description: event.target.value });
                    }}
                    placeholder="Descrizione movimento"
                  />
                </td>
                <td>
                  <input
                    value={entry.debit}
                    inputMode="decimal"
                    onChange={(event) => {
                      onUpdateEntry(entry.id, { debit: event.target.value });
                    }}
                    placeholder="0,00"
                  />
                </td>
                <td>
                  <input
                    value={entry.credit}
                    inputMode="decimal"
                    onChange={(event) => {
                      onUpdateEntry(entry.id, { credit: event.target.value });
                    }}
                    placeholder="0,00"
                  />
                </td>
                <td className="journal-remove-cell">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Rimuovi riga ${index + 11}`}
                    onClick={() => onRemoveEntry(entry.id)}
                    disabled={entries.length <= 1}
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
        Il campo E usa il piano dei conti caricato dal modello. Il file estratto aggiorna il foglio tecnico
        LIBRO_GIORNALE.
      </footer>
    </section>
  );
}
