export type Role = "admin" | "teacher";
export type ReceiptStatus = "pending" | "paid";
export type ReceiptSource = "web" | "manual";
export type IncomeCategory = "헌금" | "회비" | "전도금" | "지원금" | "잡수입" | "기타";
export type IncomeSource = "bank" | "manual";
export type BankTxnKind = "expense" | "income" | "wash" | "transfer" | "unknown";
export type BankTxnMatchStatus = "matched" | "unmatched" | "na";

export interface Organization {
  id: string;
  name: string;
  invite_code: string;
}

export interface Profile {
  id: string;
  org_id: string | null;
  name: string | null;
  email: string | null;
  role: Role;
  bank_name: string | null;
  bank_account: string | null;
  account_holder: string | null;
}

export interface BudgetCategory {
  id: string;
  org_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface BankAccount {
  id: string;
  org_id: string;
  label: string;
  account_no: string;
  bank_name: string;
  is_active: boolean;
}

export interface ReceiptItem {
  name: string;
  qty?: number;
  price?: number;
}

export interface Receipt {
  id: string;
  org_id: string;
  receipt_no: number | null;
  user_id: string;
  merchant: string | null;
  expense_date: string | null;
  total_amount: number;
  description: string | null;
  items: ReceiptItem[] | null;
  category_id: string | null;
  refund_bank_name: string | null;
  refund_account: string | null;
  refund_holder: string | null;
  status: ReceiptStatus;
  paid_from_bank_id: string | null;
  paid_at: string | null;
  paid_by: string | null;
  source: ReceiptSource;
  created_at: string;
  updated_at: string;
}

export interface ReceiptImage {
  id: string;
  receipt_id: string;
  storage_path: string;
  sort_order: number;
}

export interface BankImportBatch {
  id: string;
  org_id: string;
  bank_account_id: string;
  period: string | null;
  file_name: string | null;
  query_from: string | null;
  query_to: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  withdraw_total: number;
  deposit_total: number;
  row_count: number;
  imported_by: string | null;
  imported_at: string;
}

export interface BankTransaction {
  id: string;
  org_id: string;
  bank_account_id: string;
  import_batch_id: string | null;
  txn_no: number | null;
  txn_at: string;
  counterparty: string | null;
  withdraw: number;
  deposit: number;
  balance: number | null;
  memo: string | null;
  method: string | null;
  branch: string | null;
  kind: BankTxnKind;
  match_status: BankTxnMatchStatus;
  matched_receipt_id: string | null;
  matched_income_id: string | null;
  locked: boolean;
  dedupe_key: string;
  created_at: string;
}

export interface Income {
  id: string;
  org_id: string;
  income_date: string;
  amount: number;
  category: IncomeCategory;
  source: IncomeSource;
  deposit_to_bank_id: string | null;
  bank_transaction_id: string | null;
  memo: string | null;
  excluded: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LedgerEntry {
  id: string;
  org_id: string;
  bank_account_id: string;
  txn_at: string;
  txn_date: string;
  direction: "income" | "expense";
  deposit: number;
  withdraw: number;
  balance: number | null;
  counterparty: string | null;
  memo: string | null;
  method: string | null;
  kind: BankTxnKind;
  match_status: BankTxnMatchStatus;
  matched_receipt_id: string | null;
  matched_income_id: string | null;
}

export interface Database {
  public: {
    Tables: {
      organization: {
        Row: Organization;
        Insert: Omit<Organization, "id"> & { id?: string };
        Update: Partial<Organization>;
      };
      profile: {
        Row: Profile;
        Insert: Profile;
        Update: Partial<Profile>;
      };
      budget_category: {
        Row: BudgetCategory;
        Insert: Omit<BudgetCategory, "id"> & { id?: string };
        Update: Partial<BudgetCategory>;
      };
      bank_account: {
        Row: BankAccount;
        Insert: Omit<BankAccount, "id"> & { id?: string };
        Update: Partial<BankAccount>;
      };
      receipt: {
        Row: Receipt;
        Insert: Omit<Receipt, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Receipt>;
      };
      receipt_image: {
        Row: ReceiptImage;
        Insert: Omit<ReceiptImage, "id"> & { id?: string };
        Update: Partial<ReceiptImage>;
      };
      bank_import_batch: {
        Row: BankImportBatch;
        Insert: Omit<BankImportBatch, "id" | "imported_at"> & {
          id?: string;
          imported_at?: string;
        };
        Update: Partial<BankImportBatch>;
      };
      bank_transaction: {
        Row: BankTransaction;
        Insert: Omit<BankTransaction, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<BankTransaction>;
      };
      income: {
        Row: Income;
        Insert: Omit<Income, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Income>;
      };
    };
    Views: {
      ledger_entry: {
        Row: LedgerEntry;
      };
    };
  };
}
