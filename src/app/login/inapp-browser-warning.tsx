"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";

interface DetectionResult {
  detected: boolean;
  name: string | null;
}

function detectInAppBrowser(ua: string): DetectionResult {
  if (/KAKAOTALK/i.test(ua)) return { detected: true, name: "카카오톡" };
  if (/\bLine\//.test(ua)) return { detected: true, name: "라인" };
  if (/FBAN|FBAV/i.test(ua)) return { detected: true, name: "페이스북" };
  if (/Instagram/i.test(ua)) return { detected: true, name: "인스타그램" };
  if (/NAVER/i.test(ua)) return { detected: true, name: "네이버" };
  if (/; ?wv\)/.test(ua)) return { detected: true, name: "인앱 브라우저" };
  if (/\bWebView\b/i.test(ua)) return { detected: true, name: "인앱 브라우저" };
  return { detected: false, name: null };
}

export function InAppBrowserWarning() {
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setResult(detectInAppBrowser(navigator.userAgent));
    setUrl(`${window.location.origin}${window.location.pathname}`);
  }, []);

  if (!result?.detected) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1 space-y-2 text-sm">
          <p className="font-semibold">
            {result.name}에서는 Google 로그인이 차단됩니다.
          </p>
          <p className="text-xs leading-relaxed text-amber-900/90">
            외부 브라우저(Chrome, Safari)에서 다시 열어주세요.
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-900/90">
            <li>
              <b>Android</b>: 우측 상단 메뉴(⋮) → &ldquo;다른 브라우저로 열기&rdquo; → Chrome
            </li>
            <li>
              <b>iOS</b>: 우측 상단 공유 버튼 → &ldquo;Safari로 열기&rdquo;
            </li>
          </ul>
          <p className="pt-1 text-xs text-amber-900/90">
            또는 아래 URL을 외부 브라우저에 직접 입력하세요:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded border border-amber-200 bg-white px-2 py-1.5 text-xs">
              {url}
            </code>
            <button
              type="button"
              onClick={copy}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-amber-300 bg-white"
              aria-label="URL 복사"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          {copied && (
            <p className="text-xs font-medium text-green-700">
              URL이 복사되었습니다!
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
