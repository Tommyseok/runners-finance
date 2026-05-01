export type Role = "admin" | "teacher";
export type ReceiptStatus = "pending" | "paid";

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
  created_at: string;
  updated_at: string;
}

export interface ReceiptImage {
  id: string;
  receipt_id: string;
  storage_path: string;
  sort_order: number;
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
    };
  };
}
