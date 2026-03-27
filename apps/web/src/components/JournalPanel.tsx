import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountOption } from "../data/pianoDeiConti";
import type { JournalProfileId, JournalProfileOption } from "../data/journalProfiles";

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

type JournalFieldKey = "date" | "account" | "description" | "debit" | "credit";

type JournalPanelProps = {
  isOpen: boolean;
  entries: JournalEntry[];
  accounts: readonly AccountOption[];
  selectedProfileId: JournalProfileId;
  profileOptions: readonly JournalProfileOption[];
  isExtracting: boolean;
  minRows: number;
  onClose: () => void;
  onChangeProfile: (profileId: JournalProfileId) => void;
  onExtract: () => void;
  onAddEntry: () => void;
  onClearEntries: () => void;
  onRemoveEntry: (entryId: string) => void;
  onUpdateEntry: (entryId: string, patch: Partial<JournalEntry>) => void;
  onOpenVirtualKeyboard?: (element: HTMLInputElement, field: string) => void;
  onSelectField?: (entryId: string, field: JournalFieldKey) => void;
  selectedField?: { entryId: string; field: JournalFieldKey } | null;
  onCalculatorTargetChange?: (target: { entryId: string; field: "debit" | "credit" } | null) => void;
  calculatorTarget?: { entryId: string; field: "debit" | "credit" } | null;
  onScroll?: (top: number, left: number) => void;
  scrollPosition?: { top: number; left: number } | null;
  disableSystemKeyboard?: boolean;
};

type AccountPickerProps = {
  inputId: string;
  entryId: string;
  entry: JournalEntry;
  accounts: readonly AccountOption[];
  onUpdate: (patch: Pick<JournalEntry, "accountCode" | "accountName">) => void;
  onOpenVirtualKeyboard?: (element: HTMLInputElement, field: string) => void;
  onSelectField?: (entryId: string, field: JournalFieldKey) => void;
  isSelected?: boolean;
  disableSystemKeyboard?: boolean;
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

function formatCalculatorResult(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return "";
  }
  const normalized = trimmed.replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return formatAmountForDisplay(rawValue);
  }
  return amountFormatter.format(parsed);
}

function isCoarsePointerDevice(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(pointer: coarse)").matches;
}

function AccountPicker({
  inputId,
  entryId,
  entry,
  accounts,
  onUpdate,
  onOpenVirtualKeyboard,
  onSelectField,
  isSelected,
  disableSystemKeyboard
}: AccountPickerProps) {
  const [query, setQuery] = useState(entry.accountName);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const useTapForVirtualKeyboard = Boolean(disableSystemKeyboard && onOpenVirtualKeyboard && isCoarsePointerDevice());
  const lastCloseLineRef = useRef(entry.closeLine);
  
  // Ref per memorizzare la funzione handleInputChange in modo che possa essere chiamata esternamente
  const handleInputChangeRef = useRef<(value: string) => void>();
  
  // Espone la funzione handleInputChange globalmente per poter essere chiamata dalla tastiera virtuale
  useEffect(() => {
    const element = document.getElementById(inputId);
    if (element) {
      (element as any)._handleInputChange = (value: string) => {
        handleInputChangeRef.current?.(value);
      };
    }
    
    return () => {
      const element = document.getElementById(inputId);
      if (element) {
        delete (element as any)._handleInputChange;
      }
    };
  }, [inputId]);

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

  useEffect(() => {
    if (!isSelected && isOpen) {
      setIsOpen(false);
    }
  }, [isOpen, isSelected]);

  useEffect(() => {
    if (isOpen && entry.accountCode && entry.accountName) {
      setIsOpen(false);
    }
  }, [entry.accountCode, entry.accountName, isOpen]);

  useEffect(() => {
    if (lastCloseLineRef.current !== entry.closeLine) {
      lastCloseLineRef.current = entry.closeLine;
      if (isOpen) {
        setIsOpen(false);
      }
    }
  }, [entry.closeLine, isOpen]);

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
    console.log('🔍 AccountPicker handleInputChange called with:', value);
    setQuery(value);
    setIsOpen(true);
    const normalizedValue = normalizeForSearch(value);
    const exactMatch = accounts.find(
      (account) =>
        normalizeForSearch(account.name) === normalizedValue ||
        normalizeForSearch(`${account.code} ${account.name}`) === normalizedValue
    );

    console.log('🔍 AccountPicker search results:', { 
      normalizedValue, 
      exactMatch: exactMatch?.name,
      totalAccounts: accounts.length,
      filteredCount: filteredAccounts.length 
    });

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
  
  // Memorizza la funzione nel ref
  useEffect(() => {
    handleInputChangeRef.current = handleInputChange;
  }, [handleInputChange]);

  const openAccountVirtualKeyboard = (target: HTMLInputElement) => {
    if (!onOpenVirtualKeyboard) {
      return;
    }
    (target as any)._handleInputChange = (value: string) => {
      console.log('🔍 Direct handleInputChange called with:', value);
      handleInputChange(value);
    };
    onOpenVirtualKeyboard(target, 'account');
  };

  return (
    <div className="account-picker" ref={rootRef}>
      <input
        id={inputId}
        value={query}
        inputMode={disableSystemKeyboard ? "none" : "text"}
        readOnly={disableSystemKeyboard}
        onFocus={() => {
          onSelectField?.(entryId, "account");
          setIsOpen(true);
        }}
        onClick={(event) => {
          onSelectField?.(entryId, "account");
          if (useTapForVirtualKeyboard) {
            openAccountVirtualKeyboard(event.currentTarget);
          }
        }}
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
        onDoubleClick={(event) => {
          if (!useTapForVirtualKeyboard) {
            openAccountVirtualKeyboard(event.currentTarget);
          }
        }}
        onBlur={(event) => {
          console.log('🔍 AccountPicker onBlur called');
          // Rimuove la funzione esposta quando il campo perde focus
          const target = event.target as HTMLInputElement;
          delete (target as any)._handleInputChange;
        }}
        data-journal-entry-id={entryId}
        data-journal-field="account"
        placeholder="Cerca conto..."
        title={
          useTapForVirtualKeyboard
            ? "Tocca per aprire la tastiera virtuale"
            : "Doppio click per aprire la tastiera virtuale"
        }
        className={isSelected ? "journal-selected-field" : undefined}
        style={{ cursor: 'pointer' }}
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
  selectedProfileId,
  profileOptions,
  isExtracting,
  minRows,
  onClose,
  onChangeProfile,
  onExtract,
  onAddEntry,
  onClearEntries,
  onRemoveEntry,
  onUpdateEntry,
  onOpenVirtualKeyboard,
  onSelectField,
  selectedField,
  onCalculatorTargetChange,
  calculatorTarget,
  onScroll,
  scrollPosition,
  disableSystemKeyboard = true
}: JournalPanelProps) {
  // Ref per memorizzare il campo target
  const targetFieldRef = useRef<{
    entryId: string | null;
    field: 'debit' | 'credit' | null;
    value: string;
  }>({ entryId: null, field: null, value: '' });

  // Stato per il campo di destinazione finale (dove si è aperta la calcolatrice)
  const [destinationField, setDestinationField] = useState<{
    entryId: string | null;
    field: 'debit' | 'credit' | null;
  }>({ entryId: null, field: null });

  // Stato per verificare se la calcolatrice è aperta
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  
  // Flag per prevenire esecuzioni multiple
  const isProcessingClickRef = useRef(false);
  const useTapForMobileInputs = Boolean(disableSystemKeyboard && isCoarsePointerDevice());
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const suppressScrollSyncRef = useRef(false);

  const isFieldSelected = (entryId: string, field: JournalFieldKey) =>
    selectedField?.entryId === entryId && selectedField?.field === field;

  const handleTableScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (suppressScrollSyncRef.current) {
      suppressScrollSyncRef.current = false;
      return;
    }
    const target = event.currentTarget;
    onScroll?.(target.scrollTop, target.scrollLeft);
  };

  useEffect(() => {
    if (!calculatorTarget) {
      setDestinationField({ entryId: null, field: null });
      document.querySelectorAll('.calculator-selected-field').forEach(el => {
        el.classList.remove('calculator-selected-field');
      });
      return;
    }
    setDestinationField({ entryId: calculatorTarget.entryId, field: calculatorTarget.field });
    highlightSelectedField(calculatorTarget.entryId, calculatorTarget.field);
  }, [calculatorTarget]);

  useEffect(() => {
    if (!scrollPosition) {
      return;
    }
    const container = tableWrapRef.current;
    if (!container) {
      return;
    }
    const { top, left } = scrollPosition;
    if (Math.abs(container.scrollTop - top) < 1 && Math.abs(container.scrollLeft - left) < 1) {
      return;
    }
    suppressScrollSyncRef.current = true;
    container.scrollTo({ top, left, behavior: "auto" });
  }, [scrollPosition]);

  // Funzione per evidenziare il campo selezionato
  const highlightSelectedField = (entryId: string, field: 'debit' | 'credit') => {
    // Rimuovi evidenziazioni precedenti
    document.querySelectorAll('.calculator-selected-field').forEach(el => {
      el.classList.remove('calculator-selected-field');
    });
    
    // Evidenzia il campo selezionato
    const selectedField = document.querySelector(`[data-entry-id="${entryId}"][data-field="${field}"]`) as HTMLInputElement;
    if (selectedField) {
      selectedField.classList.add('calculator-selected-field');
    }
  };

  // Event listener per monitorare lo stato della calcolatrice
  useEffect(() => {
    const checkCalculatorState = () => {
      const calculator = document.querySelector('.calculator');
      const wasOpen = isCalculatorOpen;
      const isOpen = !!calculator;
      setIsCalculatorOpen(isOpen);
      
      // Se la calcolatrice si è chiusa, resetta gli stati
      if (wasOpen && !isOpen) {
        isProcessingClickRef.current = false;
        // Rimuovi evidenziazioni
        document.querySelectorAll('.calculator-selected-field').forEach(el => {
          el.classList.remove('calculator-selected-field');
        });
        
        // Resetta il campo di destinazione quando si chiude la calcolatrice
        setDestinationField({ entryId: null, field: null });
        onCalculatorTargetChange?.(null);
      }
    };

    // Controlla ogni 100ms se la calcolatrice è aperta
    const interval = setInterval(checkCalculatorState, 100);
    
    // Event listener per intercettare la cancellazione della calcolatrice
    const handleCalculatorClear = (event: Event) => {
      const detail = (event as CustomEvent | undefined)?.detail as { mode?: string } | undefined;
      if (detail?.mode === "field") {
        return;
      }
      // Quando la calcolatrice viene cancellata, chiudila e riaprila per mantenere il campo evidenziato
      setTimeout(() => {
        const calculator = document.querySelector('.calculator');
        if (calculator && destinationField.entryId && destinationField.field) {
          // Chiudi la calcolatrice in modo sicuro
          try {
            // Prova a trovare il pulsante di chiusura
            const closeButton = calculator.querySelector('[aria-label="Chiudi calcolatrice"], .calculator-close-btn, button[onclick*="close"], button[onclick*="remove"]') as HTMLButtonElement;
            if (closeButton) {
              closeButton.click();
            } else {
              // Rimuovi in modo sicuro controllando il parent
              if (calculator.parentNode) {
                calculator.parentNode.removeChild(calculator);
              }
            }
          } catch (error) {
            // Se c'è un errore, ignoralo silenziosamente
            console.warn('Errore nella chiusura della calcolatrice:', error);
          }
          
          // Riaprila dopo un breve momento
          setTimeout(() => {
            const calculatorButton = document.querySelector('[aria-label="Calcolatrice"]') as HTMLButtonElement;
            if (calculatorButton) {
              calculatorButton.click();
              
              // Rievidenzia il campo
              if (destinationField.entryId && destinationField.field) {
                highlightSelectedField(destinationField.entryId, destinationField.field);
              }
            }
          }, 50);
        }
      }, 100);
    };

    // Ascolta l'evento di cancellazione della calcolatrice
    window.addEventListener('calculator-clear-field', handleCalculatorClear);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('calculator-clear-field', handleCalculatorClear);
    };
  }, [isCalculatorOpen, destinationField]);

  const handleAmountClick = (event: React.MouseEvent<HTMLInputElement>) => {
    const target = event.currentTarget;
    const entryId = target.getAttribute('data-entry-id')!;
    const field = target.getAttribute('data-field') as 'debit' | 'credit';
    const value = target.value;

    onSelectField?.(entryId, field);
    
    // Imposta i data attributes per la calcolatrice
    target.setAttribute('data-calculator-target', entryId);
    target.setAttribute('data-calculator-field', field);
    
    // Controlla se la calcolatrice è già aperta
    if (isCalculatorOpen) {
      // Previeni esecuzioni multiple
      if (isProcessingClickRef.current) {
        return;
      }
      isProcessingClickRef.current = true;
      
      // Calcolatrice già aperta: aggiungi il valore SENZA aggiornare destinazione
      targetFieldRef.current = { entryId, field, value };
      // NON aggiornare destinationField - mantieni quello originale
      // NON evidenziare - solo il doppio click evidenzia
      
      // Aggiungi il valore alla calcolatrice con condizione
      setTimeout(() => {
        // Converti il valore per la calcolatrice (sostituisci virgola con punto)
        const calculatorValue = value.replace(/\./g, '').replace(',', '.');
        
        // Ottieni il valore corrente del display della calcolatrice
        const calculatorInput = document.querySelector('.calculator input') as HTMLInputElement;
        const currentDisplay = calculatorInput ? calculatorInput.value : '';
        const trimmedDisplay = currentDisplay.trim();
        const numericValue = parseFloat(calculatorValue);
        const fieldIsEmpty = calculatorValue.trim() === '';
        const fieldIsNaN = isNaN(numericValue);
        const displayHasResult = trimmedDisplay.includes('=');
        const displayIsEmpty = trimmedDisplay === '';
        const displayHasOnlyZero = trimmedDisplay === '0';
        const displayEndsWithOperator = /[+\-*/(]$/.test(trimmedDisplay);

        const setCalculatorValue = (nextValue: string) => {
          const event = new CustomEvent('calculator-set-value', {
            detail: { value: nextValue }
          });
          window.dispatchEvent(event);
        };

        if (fieldIsEmpty || fieldIsNaN || displayIsEmpty || displayHasOnlyZero || displayHasResult) {
          setCalculatorValue(calculatorValue);
        } else if (displayEndsWithOperator) {
          setCalculatorValue(`${trimmedDisplay}${calculatorValue}`);
        } else {
          setCalculatorValue(`${trimmedDisplay}+${calculatorValue}`);
        }
        
        // Resetta il flag dopo l'elaborazione
        setTimeout(() => {
          isProcessingClickRef.current = false;
        }, 200); // Aumento timeout per sicurezza
      }, 100); // Aumento timeout per debug
    } else {
      // Calcolatrice chiusa: aprila e imposta il campo di destinazione
      setDestinationField({ entryId, field });
      onCalculatorTargetChange?.({ entryId, field });
      targetFieldRef.current = { entryId, field, value };
      highlightSelectedField(entryId, field); // Evidenzia il campo selezionato
      
      // Apri la calcolatrice normalmente
      const calculatorButton = document.querySelector('[aria-label="Calcolatrice"]') as HTMLButtonElement;
      if (calculatorButton) {
        calculatorButton.click();
        
        // Se c'è un valore nel campo, inseriscilo nella calcolatrice
        if (value) {
          setTimeout(() => {
            // Converti il valore per la calcolatrice (sostituisci virgola con punto)
            const calculatorValue = value.replace(/\./g, '').replace(',', '.');
            
            // Emetti evento per aggiornare il display della calcolatrice
            const event = new CustomEvent('calculator-set-value', {
              detail: { value: calculatorValue }
            });
            window.dispatchEvent(event);
          }, 100);
        }
      }
    }
  };

  const handleAmountSingleClick = (event: React.MouseEvent<HTMLInputElement>) => {
    // Se la calcolatrice è già aperta, gestisci il click singolo
    if (isCalculatorOpen) {
      handleAmountClick(event);
    }
  };

  // Event listener globale per l'inserimento automatico
  useEffect(() => {
    const handleCalculatorInput = (event: CustomEvent) => {
      const { value, isResult } = event.detail;
      
      // Per i risultati, usa il campo di destinazione (dove si è aperta la calcolatrice)
      if (isResult) {
        const { entryId, field } = destinationField;
        
        if (entryId && field && onUpdateEntry) {
          // Applica la formattazione per il display prima di inserire il valore
          const formattedValue = formatCalculatorResult(value);
          console.log('🧮 Calculator result formatting:', { original: value, formatted: formattedValue });
          
          // Forza l'aggiornamento anche se il valore è identico
          onUpdateEntry(entryId, { [field]: formattedValue });
          
          // NON resettare il campo di destinazione dopo l'inserimento per permettere ricalcoli multipli
          // setDestinationField({ entryId: null, field: null });
        }
      } else {
        // Per i valori copiati, non fare nulla (gestito dai click sui campi)
        return;
      }
    };

    const handleCalculatorClearField = () => {
      const { entryId, field } = destinationField;
      
      if (entryId && field && onUpdateEntry) {
        onUpdateEntry(entryId, { [field]: '' });
      }
    };

    // Registra gli event listener globali
    window.addEventListener('calculator-input', handleCalculatorInput as EventListener);
    window.addEventListener('calculator-clear-field', handleCalculatorClearField as EventListener);
    
    return () => {
      window.removeEventListener('calculator-input', handleCalculatorInput as EventListener);
      window.removeEventListener('calculator-clear-field', handleCalculatorClearField as EventListener);
    };
  }, [onUpdateEntry, destinationField]);

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

      <div className="journal-table-wrap" ref={tableWrapRef} onScroll={handleTableScroll}>
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
                    inputMode={disableSystemKeyboard ? "none" : "text"}
                    readOnly={disableSystemKeyboard}
                    onFocus={() => onSelectField?.(entry.id, "date")}
                    onClick={() => onSelectField?.(entry.id, "date")}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!value) {
                        onUpdateEntry(entry.id, { date: '' });
                        return;
                      }
                      const match = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
                      if (!match) {
                        return;
                      }
                      const day = match[1].padStart(2, '0');
                      const month = match[2].padStart(2, '0');
                      const yearRaw = match[3];
                      const year = yearRaw
                        ? yearRaw.length === 2
                          ? `20${yearRaw}`
                          : yearRaw
                        : String(new Date().getFullYear());
                      const isoDate = `${year}-${month}-${day}`;
                      onUpdateEntry(entry.id, { date: isoDate });
                    }}
                    onBlur={() => {
                      // Forza il re-render per assicurare che il valore sia sincronizzato
                      if (entry.date) {
                        onUpdateEntry(entry.id, { date: entry.date });
                      }
                    }}
                    placeholder="gg/mm"
                    maxLength={10}
                    data-journal-entry-id={entry.id}
                    data-journal-field="date"
                    className={isFieldSelected(entry.id, "date") ? "journal-selected-field" : undefined}
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
                      onSelectField?.(entry.id, "date");
                      const dateInput = document.querySelector(`#journal-date-${entry.id}`) as HTMLInputElement;
                      if (dateInput) {
                        dateInput.style.opacity = '0';
                        dateInput.style.pointerEvents = 'none';
                        if (typeof dateInput.showPicker === "function") {
                          dateInput.showPicker();
                        } else {
                          dateInput.focus();
                          dateInput.click();
                        }
                        
                        // Gestisci sia change che input events
                        const handleDateChange = () => {
                          // Forza un re-render del componente
                          onUpdateEntry(entry.id, { date: dateInput.value });
                        };
                        
                        dateInput.addEventListener('change', handleDateChange, { once: true });
                        dateInput.addEventListener('input', handleDateChange, { once: true });
                        
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
                    entryId={entry.id}
                    entry={entry}
                    accounts={accounts}
                    onUpdate={(patch) => onUpdateEntry(entry.id, patch)}
                    onOpenVirtualKeyboard={onOpenVirtualKeyboard}
                    onSelectField={onSelectField}
                    isSelected={isFieldSelected(entry.id, "account")}
                    disableSystemKeyboard={disableSystemKeyboard}
                  />
                </td>
                <td className={entry.closeLine ? "journal-close-line-cell" : undefined}>
                  <input
                    value={entry.description}
                    inputMode={disableSystemKeyboard ? "none" : "text"}
                    readOnly={disableSystemKeyboard}
                    onFocus={() => onSelectField?.(entry.id, "description")}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      console.log('📝 Description onChange called with:', nextValue);
                      onUpdateEntry(entry.id, { description: nextValue });
                    }}
                    onDoubleClick={(event) => {
                      if (useTapForMobileInputs) {
                        return;
                      }
                      onSelectField?.(entry.id, "description");
                      const target = event.currentTarget;
                      (target as any)._onUpdateEntry = (value: string) => {
                        onUpdateEntry(entry.id, { description: value });
                      };
                      if (onOpenVirtualKeyboard) {
                        onOpenVirtualKeyboard(target, 'description');
                      }
                    }}
                    onClick={(event) => {
                      if (!useTapForMobileInputs) {
                        return;
                      }
                      onSelectField?.(entry.id, "description");
                      const target = event.currentTarget;
                      (target as any)._onUpdateEntry = (value: string) => {
                        onUpdateEntry(entry.id, { description: value });
                      };
                      if (onOpenVirtualKeyboard) {
                        onOpenVirtualKeyboard(target, 'description');
                      }
                    }}
                    onBlur={(event) => {
                      console.log('📝 Description onBlur called with:', event.target.value);
                      // Rimuove la funzione esposta quando il campo perde focus
                      delete (event.target as any)._onUpdateEntry;
                    }}
                    placeholder="Descrizione"
                    title={useTapForMobileInputs ? "Tocca per aprire la tastiera virtuale" : "Doppio click per aprire la tastiera virtuale"}
                    data-journal-entry-id={entry.id}
                    data-journal-field="description"
                    className={isFieldSelected(entry.id, "description") ? "journal-selected-field" : undefined}
                    style={{ cursor: 'pointer' }}
                  />
                </td>
                <td className="journal-amount-cell">
                  <input
                    value={entry.debit}
                    inputMode={disableSystemKeyboard ? "none" : "decimal"}
                    readOnly={disableSystemKeyboard}
                    data-entry-id={entry.id}
                    data-field="debit"
                    data-journal-entry-id={entry.id}
                    data-journal-field="debit"
                    className={isFieldSelected(entry.id, "debit") ? "journal-selected-field" : undefined}
                    onFocus={() => onSelectField?.(entry.id, "debit")}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      onUpdateEntry(entry.id, { debit: sanitizeAmountTyping(nextValue) });
                    }}
                    onBlur={() => {
                      onUpdateEntry(entry.id, { debit: formatAmountForDisplay(entry.debit) });
                    }}
                    onClick={useTapForMobileInputs ? handleAmountClick : handleAmountSingleClick}
                    onDoubleClick={useTapForMobileInputs ? undefined : handleAmountClick}
                    title={useTapForMobileInputs ? "Tocca per inserire nella calcolatrice" : "Doppio click per inserire nella calcolatrice"}
                    style={{ cursor: 'pointer' }}
                  />
                </td>
                <td className="journal-amount-cell">
                  <input
                    value={entry.credit}
                    inputMode={disableSystemKeyboard ? "none" : "decimal"}
                    readOnly={disableSystemKeyboard}
                    data-entry-id={entry.id}
                    data-field="credit"
                    data-journal-entry-id={entry.id}
                    data-journal-field="credit"
                    className={isFieldSelected(entry.id, "credit") ? "journal-selected-field" : undefined}
                    onFocus={() => onSelectField?.(entry.id, "credit")}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      onUpdateEntry(entry.id, { credit: sanitizeAmountTyping(nextValue) });
                    }}
                    onBlur={() => {
                      onUpdateEntry(entry.id, { credit: formatAmountForDisplay(entry.credit) });
                    }}
                    onClick={useTapForMobileInputs ? handleAmountClick : handleAmountSingleClick}
                    onDoubleClick={useTapForMobileInputs ? undefined : handleAmountClick}
                    title={useTapForMobileInputs ? "Tocca per inserire nella calcolatrice" : "Doppio click per inserire nella calcolatrice"}
                    style={{ cursor: 'pointer' }}
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
        <div className="journal-panel-footer-row">
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
            <div className="journal-profile-inline">
              <label htmlFor="journal-profile-select">Piano dei conti</label>
              <select
                id="journal-profile-select"
                value={selectedProfileId}
                onChange={(event) => onChangeProfile(event.target.value as JournalProfileId)}
              >
                {profileOptions.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <p>
          Il campo E usa il piano dei conti del profilo selezionato. Il file estratto aggiorna il foglio tecnico
          LIBRO_GIORNALE del template scelto.
        </p>
      </footer>
    </section>
  );
}
