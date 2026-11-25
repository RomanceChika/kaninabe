// 入口の閉世界のテスト用の枠の設定(値を固定した欄を決まった形で書く。点検 16 回目 C16-3)。
const nextConfig = {
  poweredByHeader: false,
  async headers() { return [{ source: "/:path*", headers: staticHeaderEntries(BROWSER_DEFENSE) }]; },
  experimental: { agentUpgrade: false },
};

export default nextConfig;
