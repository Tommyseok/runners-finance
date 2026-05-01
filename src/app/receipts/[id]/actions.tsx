"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";

export function ReceiptActions({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();

      const { data: imgs } = await supabase
        .from("receipt_image")
        .select("storage_path")
        .eq("receipt_id", receiptId);
      const paths =
        (imgs as { storage_path: string }[] | null)?.map((i) => i.storage_path) ??
        [];
      if (paths.length > 0) {
        await supabase.storage.from("receipts").remove(paths);
      }

      const { error: delErr } = await supabase
        .from("receipt")
        .delete()
        .eq("id", receiptId);
      if (delErr) throw delErr;

      router.replace("/receipts");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "삭제 실패";
      setError(msg);
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => router.push(`/receipts/${receiptId}/edit`)}
        >
          수정
        </Button>
        <Button
          variant="outline"
          className="flex-1 text-destructive hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          삭제
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>영수증을 삭제할까요?</DialogTitle>
            <DialogDescription>
              영수증과 첨부 이미지가 모두 삭제되며 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
