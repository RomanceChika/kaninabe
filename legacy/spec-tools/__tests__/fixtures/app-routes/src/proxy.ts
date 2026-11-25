// リクエスト前段のフィクスチャ。matcher の静的パースだけを試験する。
export const config = {
  matcher: ['/workshops/:path*', '/settings/:id(\d+)'],
};
