import nextPwa from "next-pwa";

const withPWA = nextPwa({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
    serverComponentsExternalPackages: ["pdfkit", "exceljs"],
    // PDF 라우트 람다에 한글 폰트(.ttf) 파일을 명시적으로 포함 (fs.readFile 동적경로 추적 누락 방지)
    outputFileTracingIncludes: {
      "/api/download/expense-report": ["./public/fonts/NanumGothic-*.ttf"],
      "/api/download/pdf": ["./public/fonts/NanumGothic-*.ttf"],
    },
  },
};

export default withPWA(nextConfig);
