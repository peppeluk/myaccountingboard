import type { JournalTemplateKey } from "../lib/api";
import { PIANO_DEI_CONTI, type AccountOption } from "./pianoDeiConti";
import { PIANO_DEI_CONTI_T_SMART_SNC } from "./pianoDeiContiTSmartSNC";
import { PIANO_DEI_CONTI_T_SMART_SRL } from "./pianoDeiContiTSmartSRL";
import { PIANO_DEI_CONTI_T_SMART_OFFICE } from "./pianoDeiContiTSmartOffice";

export type JournalProfileOption = {
  id: string;
  templateKey: JournalTemplateKey;
  label: string;
  description: string;
  maxRows: number;
  accounts: readonly AccountOption[];
};

export type JournalProfileId = (typeof JOURNAL_PROFILE_OPTIONS)[number]["id"];

export const DEFAULT_JOURNAL_PROFILE_ID = "spa";

export const JOURNAL_PROFILE_OPTIONS: readonly JournalProfileOption[] = [
  {
    id: "spa",
    templateKey: "t-smart",
    label: "S.P.A.",
    description: "Template base (212 righe)",
    maxRows: 202,
    accounts: PIANO_DEI_CONTI
  },
  {
    id: "snc",
    templateKey: "t-smart",
    label: "S.N.C.",
    description: "Template base (212 righe)",
    maxRows: 202,
    accounts: PIANO_DEI_CONTI_T_SMART_SNC
  },
  {
    id: "srl",
    templateKey: "t-smart",
    label: "S.R.L.",
    description: "Template base (212 righe)",
    maxRows: 202,
    accounts: PIANO_DEI_CONTI_T_SMART_SRL
  },
  {
    id: "impresa-individuale",
    templateKey: "t-smart-office",
    label: "Impresa individuale",
    description: "Template Office (309 righe)",
    maxRows: 299,
    accounts: PIANO_DEI_CONTI_T_SMART_OFFICE
  }
];

export function getJournalProfileOption(id: string): JournalProfileOption {
  return JOURNAL_PROFILE_OPTIONS.find((profile) => profile.id === id) ?? JOURNAL_PROFILE_OPTIONS[0];
}
