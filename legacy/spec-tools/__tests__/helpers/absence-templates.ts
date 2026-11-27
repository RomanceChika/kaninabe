/**
 * 実装の範囲で外せる指摘(印 `absentFor` つき)の、**許す文面の閉じた表**(検査 ID ごと)。
 *
 * 印は「仕様が名指しする実装・テストが無い」という不在の指摘だけに付ける。同じ検査が、同じ関数の別の枝で
 * 「あるが食い違う」「宣言が無い」「ホストの設定の不在」などの指摘も出すので、検査 ID の一覧だけでは枝を限れない。
 * ここは**枝ごとの文面**を、今のコードの文面から取って正規表現で固定する。印のついた指摘がこの表のどれにも当たらなければ、
 * 付けてはいけない枝に印が付いている(`implemented-scope.test.ts`)。表の検査 ID は、C26 の閉じた一覧と同じ集合である(`scope-sites-parity.test.ts`)。
 *
 * 文面を直したら、この表も一緒に直す(行頭と行末を固定しているので、文面の一部が当たるだけでは通らない)。
 * 同じ検査の**付けない枝**(例: J2 の「app/vercel.json がありません」・「口が vercel.json に登録されていません」・S7 の「宣言していない実ルート」)の文面は、
 * 表のどの正規表現にも当たらないことを `absence-templates.test.ts` が見る。
 */

/** テストの不在(`checkTestCaseTrace` の 2 つの文面。`@tc` がどこにも無いときだけ印が付く)。 */
const TEST_ABSENT: readonly RegExp[] = [/^\S+ の implementation が指すテストファイルがありません$/u, /^\S+ に対応する "@tc \S+" がテストコードにありません$/u];

/** 検査 ID → 印を付けてよい文面。 */
export const ABSENCE_TEMPLATES: Readonly<Record<string, readonly RegExp[]>> = {
  A2: [/^handles\(.+\)に対応する Server Action の実装がありません$/u],
  A6: TEST_ABSENT,
  A10: [...TEST_ABSENT, /^\S+ の走査として宣言された \S+ が存在しません$/u],
  G7: [/^トークン --\S+ をどの実装 CSS からも参照していません\(死語彙\)$/u],
  G8: [/^brand\.\S+ が指すファイル \S+ が実在しません$/u],
  H2: [/^関門 \S+ の implementation \S+ が実在しません$/u],
  H3: TEST_ABSENT,
  J2: [
    /^ジョブ \S+ の implementation \S+ が実在しません$/u,
    /^ジョブ \S+ の endpoint \S+ に対応する Route Handler がありません$/u,
    /^認証 (?:callback|start|logout) の endpoint \S+ に対応する Route Handler がありません$/u,
    /^外部連携 \S+ の endpoints \S+ に対応する Route Handler がありません$/u,
  ],
  J3: [/^ジョブ \S+\(scheduler: database\)が \S+ の cron\.schedule に登録されていません$/u],
  K1: [/^カタログの設定 \S+ を読んでいる実装がありません$/u],
  Q6: TEST_ABSENT,
  S7: [/^route \S+ に対応する実ルートが \S+ にありません$/u],
  S8: TEST_ABSENT,
  S11: [/^\S+ の smoke の implementation が指すファイル\(.+\)がありません$/u],
  T3: TEST_ABSENT,
  T17: [/^トリガ関数 \S+ の handwritten が名指した migration \S+ は実在しません$/u],
  V10: [/^enforced_by\(kind: application\)の ref ".+" は app\/src に export された関数・定数として実在しません$/u],
  X1: [/^連携 \S+ の adapter \S+ が実在しません$/u],
  X4: TEST_ABSENT,
  Y9: TEST_ABSENT,
  Z1: TEST_ABSENT,
};

/**
 * 指摘の文面がその検査の許す文面に当たるか。
 *
 * @param verifier 検査 ID
 * @param message 指摘の文面(`INV-…:` のような持ち主の接頭辞が付く検査は、接頭辞を除いて当てる)
 */
export function matchesAbsenceTemplate(verifier: string, message: string): boolean {
  const templates = ABSENCE_TEMPLATES[verifier];
  if (templates === undefined) return false;
  const body = message.replace(/^INV-[A-Z0-9-]+: /u, '');
  return templates.some((template) => template.test(body));
}
