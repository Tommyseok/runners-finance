"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import imageCompression from "browser-image-compression";
import { Camera, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { BudgetCategory, ReceiptItem } from "@/lib/db-types";

interface FormDefaults {
  refund_bank_name: string | null;
  refund_account: string | null;
  refund_holder: string | null;
}

interface AnalyzeResult {
  merchant: string | null;
  expense_date: string | null;
  total_amount: number;
  items: ReceiptItem[];
  category_hint: string | null;
  memo: string | null;
}

const MAX_IMAGES = 10;

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function NewReceiptForm({
  categories,
  defaults,
}: {
  categories: BudgetCategory[];
  defaults: FormDefaults;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [merchant, setMerchant] = useState("");
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [totalAmount, setTotalAmount] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [categoryId, setCategoryId] = useState<string>("");

  const [bankName, setBankName] = useState(defaults.refund_bank_name ?? "");
  const [account, setAccount] = useState(defaults.refund_account ?? "");
  const [holder, setHolder] = useState(defaults.refund_holder ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [compressing, setCompressing] = useState(false);

  async function handleFilesPicked(picked: FileList | null) {
    if (!picked) return;
    const list = Array.from(picked);
    const remaining = MAX_IMAGES - files.length;
    const accepted = list.slice(0, Math.max(0, remaining));
    if (accepted.length === 0) return;

    setCompressing(true);
    try {
      const processed = await Promise.all(
        accepted.map(async (f) => {
          try {
            const compressed = await imageCompression(f, {
              maxSizeMB: 1,
              maxWidthOrHeight: 1600,
              useWebWorker: true,
              fileType: "image/jpeg",
              initialQuality: 0.85,
            });
            // browser-image-compression returns a File; ensure JPEG name.
            const renamed = compressed.name.match(/\.jpe?g$/i)
              ? compressed
              : new File(
                  [compressed],
                  compressed.name.replace(/\.[^.]+$/, "") + ".jpg",
                  { type: "image/jpeg", lastModified: Date.now() },
                );
            return renamed;
          } catch (e) {
            console.warn("[receipt new] compression failed, using original:", e);
            return f;
          }
        }),
      );

      setFiles((prev) => [...prev, ...processed]);

      await Promise.all(
        processed.map(
          (f) =>
            new Promise<void>((resolve) => {
              const reader = new FileReader();
              reader.onload = (e) => {
                const url = e.target?.result as string;
                setPreviews((prev) => [...prev, url]);
                resolve();
              };
              reader.onerror = () => resolve();
              reader.readAsDataURL(f);
            }),
        ),
      );
    } finally {
      setCompressing(false);
    }
  }

  function removeImage(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  }

  async function analyze() {
    if (files.length === 0) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const first = files[0];
      const base64 = await fileToBase64(first);
      const res = await fetch("/api/analyze-receipt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          mediaType: first.type || "image/jpeg",
          categories: categories.map((c) => c.name),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message ?? json.error ?? "분석 실패");
      }
      const result = json.result as AnalyzeResult;

      if (result.merchant) setMerchant(result.merchant);
      if (result.expense_date) setExpenseDate(result.expense_date);
      if (result.total_amount) setTotalAmount(String(result.total_amount));
      if (Array.isArray(result.items)) setItems(result.items);
      if (result.memo) setDescription(result.memo);
      if (result.category_hint) {
        const lower = result.category_hint.toLowerCase();
        const match = categories.find(
          (c) =>
            c.name.toLowerCase() === lower ||
            c.name.toLowerCase().includes(lower) ||
            lower.includes(c.name.toLowerCase()),
        );
        if (match) setCategoryId(match.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "분석 실패";
      setAnalyzeError(msg);
    } finally {
      setAnalyzing(false);
    }
  }

  function updateItem(idx: number, patch: Partial<ReceiptItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, { name: "", qty: 1, price: 0 }]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (files.length === 0) {
      setSubmitError("사진을 1장 이상 업로드해주세요.");
      return;
    }
    if (!totalAmount || Number.isNaN(Number(totalAmount))) {
      setSubmitError("총금액을 숫자로 입력해주세요.");
      return;
    }
    if (!categoryId) {
      setSubmitError("카테고리를 선택해주세요.");
      return;
    }

    setSubmitting(true);
    const uploadedPaths: string[] = [];
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");

      // 1) Upload all images first, collect paths
      for (let i = 0; i < files.length; i += 1) {
        const f = files[i];
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "jpg";
        const path = `${user.id}/${Date.now()}-${i}.${ext}`;
        const { data: upData, error: upErr } = await supabase.storage
          .from("receipts")
          .upload(path, f, {
            contentType: f.type || "image/jpeg",
            upsert: false,
          });
        console.log("[receipt new] storage upload:", {
          path,
          ok: !upErr,
          error: upErr?.message,
          data: upData,
        });
        if (upErr) throw upErr;
        uploadedPaths.push(path);
      }

      // 2) Create receipt + receipt_image rows via SECURITY DEFINER RPC
      const { data: receiptId, error: rpcErr } = await supabase.rpc(
        "create_receipt",
        {
          p_merchant: merchant || null,
          p_expense_date: expenseDate || null,
          p_total_amount: Number(totalAmount),
          p_description: description || null,
          p_items: items.length ? items : null,
          p_category_id: categoryId,
          p_refund_bank_name: bankName || null,
          p_refund_account: account || null,
          p_refund_holder: holder || null,
          p_image_paths: uploadedPaths,
        },
      );
      console.log("[receipt new] rpc create_receipt:", {
        receiptId,
        error: rpcErr
          ? {
              message: rpcErr.message,
              code: rpcErr.code,
              details: rpcErr.details,
              hint: rpcErr.hint,
            }
          : null,
      });
      if (rpcErr) throw rpcErr;
      if (!receiptId) throw new Error("영수증 ID를 받지 못했습니다.");

      router.replace(`/receipts/${receiptId}`);
      router.refresh();
    } catch (err) {
      // Roll back uploaded files if the RPC failed
      if (uploadedPaths.length > 0) {
        try {
          const supabase = createClient();
          await supabase.storage.from("receipts").remove(uploadedPaths);
        } catch {
          // best-effort cleanup
        }
      }
      const msg = err instanceof Error ? err.message : "저장 실패";
      console.error("[receipt new] submit failed:", err);
      setSubmitError(msg);
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>영수증 사진 ({files.length}/{MAX_IMAGES})</Label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {previews.map((url, idx) => (
            <div
              key={idx}
              className="relative aspect-square overflow-hidden rounded-lg border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeImage(idx)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                aria-label="삭제"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {files.length < MAX_IMAGES && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={compressing}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-muted-foreground disabled:opacity-50"
            >
              {compressing ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Camera className="h-6 w-6" />
              )}
              <span className="text-xs">
                {compressing ? "처리 중..." : "사진 추가"}
              </span>
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFilesPicked(e.target.files);
            e.target.value = "";
          }}
        />
        {compressing && (
          <p className="mt-2 text-xs text-muted-foreground">
            사진 처리 중... (큰 사진은 자동으로 압축됩니다)
          </p>
        )}
        {files.length > 0 && (
          <Button
            type="button"
            variant="outline"
            className="mt-3 w-full"
            onClick={analyze}
            disabled={analyzing || compressing}
          >
            {analyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {analyzing ? "분석 중..." : "AI로 자동 인식"}
          </Button>
        )}
        {analyzeError && (
          <p className="mt-2 text-sm text-destructive">{analyzeError}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="merchant">가맹점</Label>
        <Input
          id="merchant"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          placeholder="예: GS25 서초점"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="date">사용일</Label>
          <Input
            id="date"
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="total">총금액</Label>
          <Input
            id="total"
            type="number"
            inputMode="numeric"
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
            placeholder="0"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>카테고리</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger>
            <SelectValue placeholder="카테고리를 선택하세요" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {categories.length === 0 && (
          <p className="text-xs text-muted-foreground">
            아직 카테고리가 없습니다. 관리자에게 문의하세요.
          </p>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>품목</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addItem}
          >
            <Plus className="h-4 w-4" /> 추가
          </Button>
        </div>
        {items.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-center text-sm text-muted-foreground">
              품목 정보 없음
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={it.name}
                  onChange={(e) => updateItem(idx, { name: e.target.value })}
                  placeholder="품목명"
                  className="flex-1"
                />
                <Input
                  type="number"
                  inputMode="numeric"
                  value={it.qty ?? ""}
                  onChange={(e) =>
                    updateItem(idx, { qty: Number(e.target.value) })
                  }
                  placeholder="수량"
                  className="w-16"
                />
                <Input
                  type="number"
                  inputMode="numeric"
                  value={it.price ?? ""}
                  onChange={(e) =>
                    updateItem(idx, { price: Number(e.target.value) })
                  }
                  placeholder="단가"
                  className="w-24"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeItem(idx)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="desc">메모 (선택)</Label>
        <Textarea
          id="desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="용도, 특이사항 등"
        />
      </div>

      <div className="rounded-xl border bg-muted/40 p-4">
        <div className="mb-3 text-sm font-semibold">환급 받을 계좌</div>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="bank">은행</Label>
            <Input
              id="bank"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="국민은행"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="acct">계좌번호</Label>
            <Input
              id="acct"
              inputMode="numeric"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="000-0000-0000"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="holder">예금주</Label>
            <Input
              id="holder"
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              placeholder="홍길동"
            />
          </div>
        </div>
      </div>

      {submitError && (
        <p className="text-sm text-destructive">{submitError}</p>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={submitting || compressing}
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : null}
        {submitting ? "저장 중..." : "영수증 등록"}
      </Button>
    </form>
  );
}
