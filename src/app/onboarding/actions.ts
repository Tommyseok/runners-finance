"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface JoinForm {
  inviteCode: string;
  userName: string;
  bankName: string;
  bankAccount: string;
  accountHolder: string;
}

export interface CreateForm {
  orgName: string;
  userName: string;
  bankName: string;
  bankAccount: string;
  accountHolder: string;
}

const KNOWN_ERRORS = new Set([
  "인증되지 않은 사용자",
  "이미 다른 조직에 속해 있습니다",
  "유효하지 않은 초대코드",
]);

function mapError(message: string | undefined): string {
  if (!message) return "오류가 발생했습니다.";
  if (KNOWN_ERRORS.has(message)) return message;
  return "오류가 발생했습니다.";
}

function getSupabaseForAction() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: CookieOptions;
          }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // ignored: server component context
          }
        },
      },
    },
  );
}

export async function createOrganizationAction(
  form: CreateForm,
): Promise<ActionResult> {
  const trimmedOrg = form.orgName.trim();
  const trimmedName = form.userName.trim();
  if (!trimmedOrg) return { ok: false, error: "조직 이름을 입력해주세요." };
  if (!trimmedName) return { ok: false, error: "이름을 입력해주세요." };

  const supabase = getSupabaseForAction();

  const { data, error } = await supabase.rpc("create_organization_and_join", {
    org_name: trimmedOrg,
    user_name: trimmedName,
    p_bank_name: form.bankName.trim() || null,
    p_bank_account: form.bankAccount.trim() || null,
    p_account_holder: form.accountHolder.trim() || null,
  });
  console.log("[onboarding action] create_organization_and_join:", {
    data,
    error: error
      ? { message: error.message, code: error.code, details: error.details }
      : null,
  });
  if (error) return { ok: false, error: mapError(error.message) };

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function joinOrganizationAction(
  form: JoinForm,
): Promise<ActionResult> {
  const code = form.inviteCode.trim().toUpperCase();
  const trimmedName = form.userName.trim();
  if (!code) return { ok: false, error: "초대코드를 입력해주세요." };
  if (!trimmedName) return { ok: false, error: "이름을 입력해주세요." };

  const supabase = getSupabaseForAction();

  const { data, error } = await supabase.rpc("join_organization_by_code", {
    code,
    user_name: trimmedName,
    p_bank_name: form.bankName.trim() || null,
    p_bank_account: form.bankAccount.trim() || null,
    p_account_holder: form.accountHolder.trim() || null,
  });
  console.log("[onboarding action] join_organization_by_code:", {
    data,
    error: error
      ? { message: error.message, code: error.code, details: error.details }
      : null,
  });
  if (error) return { ok: false, error: mapError(error.message) };

  revalidatePath("/", "layout");
  return { ok: true };
}
