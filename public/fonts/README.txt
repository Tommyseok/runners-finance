PDF 보고서 생성에 한국어 폰트가 필요합니다.

이 폴더에 다음 두 파일을 직접 다운로드해 넣어주세요:

- NotoSansKR-Regular.ttf
- NotoSansKR-Bold.ttf

다운로드 위치 (Google Fonts):
  https://fonts.google.com/noto/specimen/Noto+Sans+KR
  → "Get font" → ZIP 다운로드 → 압축 해제 후 .ttf 두 개 복사

또는 Pretendard 등 다른 한글 폰트의 .ttf/.otf를 사용해도 됩니다.
다른 파일을 쓰려면 src/app/api/download/pdf/route.ts 의
FONT_REGULAR / FONT_BOLD 경로를 그에 맞게 바꿔주세요.

이 폰트 파일들은 .gitignore에 의해 git에 커밋되지 않습니다 (라이선스/용량 이유).
새 환경에서 PDF 다운로드를 처음 쓸 때 이 안내를 따라 한 번만 받아두면 됩니다.
