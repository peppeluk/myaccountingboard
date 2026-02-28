// Journal Hook - Gestisce journal entries e data auto-completion
import { useCallback, useState } from "react";
import type { JournalEntry } from "../types";

export function useJournal() {
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);

  const createJournalEntry = useCallback((): JournalEntry => {
    return {
      id: `journal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: "",
      accountCode: "",
      accountName: "",
      description: "",
      debit: "",
      credit: "",
      closeLine: false
    };
  }, []);

  const addJournalEntry = useCallback(() => {
    setJournalEntries((previous) => {
      const newEntry = createJournalEntry();
      
      // Copia data dalla riga precedente, o usa data di oggi per la prima riga
      if (previous.length === 0) {
        newEntry.date = new Date().toISOString().split('T')[0];
      } else {
        const lastEntry = previous[previous.length - 1];
        newEntry.date = lastEntry.date;
      }
      
      return [...previous, newEntry];
    });
  }, [createJournalEntry]);

  const updateJournalEntry = useCallback((entryId: string, patch: Partial<JournalEntry>) => {
    setJournalEntries((previous) => {
      const updated = previous.map((entry) => {
        if (entry.id !== entryId) {
          return entry;
        }
        return {
          ...entry,
          ...patch
        };
      });

      // Se la data è stata aggiornata O se è stato attivata la linea di chiusura O se è stato inserito importo, 
      // copia alla riga successiva se vuota
      if (patch.date || patch.closeLine || patch.debit || patch.credit) {
        const currentIndex = updated.findIndex(entry => entry.id === entryId);
        const nextIndex = currentIndex + 1;
        
        if (nextIndex < updated.length && !updated[nextIndex].date) {
          const currentEntry = updated[currentIndex];
          updated[nextIndex] = {
            ...updated[nextIndex],
            date: currentEntry.date
          };
        }
      }

      return updated;
    });
  }, []);

  const removeJournalEntry = useCallback((entryId: string) => {
    setJournalEntries((previous) => {
      if (previous.length <= 10) { // MIN_VISIBLE_JOURNAL_ENTRIES
        return previous;
      }
      const nextEntries = previous.filter((entry) => entry.id !== entryId);
      return nextEntries.length > 0
        ? nextEntries
        : [createJournalEntry()];
    });
  }, [createJournalEntry]);

  const clearJournalEntries = useCallback(() => {
    setJournalEntries([createJournalEntry()]);
  }, [createJournalEntry]);

  return {
    journalEntries,
    setJournalEntries,
    addJournalEntry,
    updateJournalEntry,
    removeJournalEntry,
    clearJournalEntries
  };
}
