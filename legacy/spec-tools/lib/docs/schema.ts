/**
 * doc_type ごとのフロントマター要件と id 形式の定義。M1 と M2 の「正」を 1 か所に集める。
 *
 * 出典(この表を変えるときは必ず先に文書を直す):
 *   - 必須フィールド: docs/rules/meta/standards/frontmatter_policy.md
 *     「doc_type ごとの必須フロントマター対応表」
 *   - id 形式: docs/rules/meta/standards/id_policy.md「ID の形式」
 *   - doc_type の一覧: docs/rules/meta/standards/doc_types.md
 *
 * docs/specs 配下の仕様系 doc_type(action_spec / state_spec 等)は SPEC_DOC_TYPE_RULES に分けてある。
 * M 群は docs/rules と docs/specs の両方を走査するが、仕様の中身(handles / states / reads …)の
 * 妥当性を見るのは V1 / A0 / Q0 であり、M 群がそこへ踏み込むと同じ事実に検査が 2 つ並ぶ。
 * 2 つの表に分けているのは、その境界を「表に何が書いてあるか」で示すためである
 * (仕様側の表が required に持つのは、他の誰も見ていない `id` だけ。理由は表のコメント)。
 */

/** 1 つの doc_type に課す要件。 */
export interface DocTypeRule {
  /** 共通必須(doc_type / scope)に加えて必須になるフィールド名。 */
  readonly required: readonly string[];
  /** id の形式。null は「形式を規定しない(M2 の形式検査の対象外)」。 */
  readonly idPattern: RegExp | null;
  /** 人間に示す形式の例(Finding の suggestion に載せる)。 */
  readonly idExample: string;
}

/** doc_type によらず全文書に必須のフィールド。 */
export const COMMON_REQUIRED: readonly string[] = ['doc_type', 'scope'];

/**
 * doc_type ごとの要件表。ここに無い doc_type は「doc_types.md 未定義」として M1 が警告する。
 *
 * 連番部分を 4 桁に固定しているのは id_policy の例示(PRIN-0001 / DG-BE-0001 等)に合わせるため。
 * 末尾のスラッグ(`-spec-as-truth` 等)は任意。
 */
export const DOC_TYPE_RULES: Readonly<Record<string, DocTypeRule>> = {
  directory_guide: {
    required: ['id', 'norms'],
    idPattern: /^DG-(?:BE-|FE-)?\d{4}$/,
    idExample: 'DG-0001 / DG-BE-0001 / DG-FE-0001',
  },
  meta: { required: [], idPattern: null, idExample: '(meta に id は不要)' },
  principle: {
    required: ['id'],
    idPattern: /^PRIN-(?:BE-|FE-)?\d{4}(?:-[a-z0-9-]+)?$/,
    idExample: 'PRIN-0001-spec-as-truth / PRIN-BE-0001-xxx',
  },
  architecture: {
    required: ['id', 'norms'],
    idPattern: /^ARCH-(?:SP-)?(?:BE-|FE-)?\d{4}(?:-[a-z0-9-]+)?$/,
    idExample: 'ARCH-0001-xxx / ARCH-BE-0013-xxx / ARCH-SP-BE-0001-xxx',
  },
  process: {
    required: [],
    idPattern: /^PROC-(?:BE-|FE-)?\d{4}(?:-[a-z0-9-]+)?$/,
    idExample: 'PROC-BE-0001(process の id は任意)',
  },
  decision: {
    required: ['id', 'targets', 'status'],
    idPattern: /^ADR-(?:BE-|FE-)?\d{4}(?:-[a-z0-9-]+)?$/,
    idExample: 'ADR-0001-xxx / ADR-BE-0001-xxx',
  },
  spec: { required: ['id'], idPattern: null, idExample: '(specs の命名に従う)' },
  domain_glossary: {
    required: ['id', 'term_id'],
    idPattern: /^TERM-[a-z0-9_-]+$/,
    idExample: 'TERM-product',
  },
  domain_invariant: {
    required: ['id'],
    idPattern: /^INVARIANT-[a-z0-9_-]+$/,
    idExample: 'INVARIANT-product-composition',
  },
  domain_example: {
    required: ['id'],
    idPattern: /^EXAMPLE-[a-z0-9_-]+$/,
    idExample: 'EXAMPLE-product-creation',
  },
  domain_design_context: {
    required: ['id'],
    idPattern: /^DC-[a-z0-9_-]+$/,
    idExample: 'DC-product-ingredient-snapshot',
  },
  domain_precedent: {
    required: ['id'],
    idPattern: /^PRECEDENT-[a-z0-9_-]+$/,
    idExample: 'PRECEDENT-public-visibility-snapshot',
  },
};

/**
 * docs/specs 配下の仕様文書の doc_type ごとの要件。
 *
 * 出典:
 *   - doc_type の一覧と必須フィールド: docs/rules/meta/standards/doc_types.md「spec > doc_type 一覧」
 *   - id 形式: docs/rules/meta/standards/id_policy.md「docs/specs の仕様文書の ID」
 *
 * **required に仕様のスキーマを並べないのは意図である**。仕様の中身(handles / input /
 * test_cases / states / reads …)が揃っているかは V1(ドメイン仕様)・A0(action_spec)・
 * Q0(query_spec)が見ており、M 群が同じ項目を数え直すと「1 つの欠落に 2 つのエラー」が出る。
 * M 群がここで担うのは、仕様の中身に立ち入らない 3 つだけ:
 *   - フロントマターが閉じて YAML として読めること(ローダーが M1 として積む)
 *   - doc_type / scope があること(COMMON_REQUIRED。全文書共通の frontmatter_policy 側の要求で、
 *     V1 / A0 / Q0 はどちらも見ていない)
 *   - id が台帳の中で一意で、doc_type ごとの形式に合っていること(M2)
 *
 * **ドメインの 5 種だけ required に `id` を持つ**。V 群は文書の `id` を一切読んでいない
 * (集約名はディレクトリから、状態・イベントの id は本文の YAML から取る)ため、
 * ここを空にすると `id` を書き忘れた仕様が M2 の台帳から静かに落ち、
 * 重複も形式も無検査になる。これらの id は `spec_ids: [workshop-access]` のように
 * A 群・Q 群の参照先として実際に使われるので、欠落は検出しなければならない。
 * action_spec / query_spec に `id` を書かない場合は A0 / Q0 がエラーにするため、ここでは重ねない。
 *
 * この表に載っている doc_type は M5(テンプレート準拠 H2)の対象外にもなる。
 * 仕様文書の本文は `<!-- AUTO-GENERATED -->` の生成物が主で、節の構成は生成器が決めるため、
 * テンプレートとの H2 突合は「人が書く文書」に対する検査としての意味を持たない。
 */
export const SPEC_DOC_TYPE_RULES: Readonly<Record<string, DocTypeRule>> = {
  role_spec: {
    required: ['id'],
    idPattern: /^[a-z][a-z0-9_]*-roles$/,
    idExample: 'domain-roles',
  },
  entity_spec: {
    required: ['id'],
    idPattern: /^[a-z][a-z0-9_]*-entity$/,
    idExample: 'workshop-entity',
  },
  state_spec: {
    required: ['id'],
    idPattern: /^[a-z][a-z0-9_]*-states$/,
    idExample: 'workshop-states',
  },
  access_spec: {
    required: ['id'],
    idPattern: /^[a-z][a-z0-9_]*-access$/,
    idExample: 'workshop-access',
  },
  invariant_spec: {
    required: ['id'],
    idPattern: /^[a-z][a-z0-9_]*-invariants$/,
    idExample: 'workshop-invariants',
  },
  // data_table も action_spec / query_spec と同じ分担で空にしてある。T0 が id が table から
  // 導かれる `table-{テーブル名}` と一致することまで見る(欠落も形式違反もそこでエラーになる)。
  data_table: {
    required: [],
    idPattern: null,
    idExample: '(T0 が table との一致を見る)',
  },
  // notification_spec も同じ分担で空にしてある。N0 が id が `notification-catalog` 固定であることを
  // 見ており(1 プロジェクト 1 カタログなので導出元が無い)、欠落も形式違反もそこでエラーになる。
  notification_spec: {
    required: [],
    idPattern: null,
    idExample: '(N0 が notification-catalog 固定であることを見る)',
  },
  // job_spec も同じ分担で空にしてある。J0 が id が `job-catalog` 固定であることを見ており
  // (1 プロジェクト 1 カタログなので導出元が無い)、欠落も形式違反もそこでエラーになる。
  job_spec: {
    required: [],
    idPattern: null,
    idExample: '(J0 が job-catalog 固定であることを見る)',
  },
  // config_spec も同じ分担で空にしてある。K0 が id が `config-catalog` 固定であることを見ており
  // (1 プロジェクト 1 カタログなので導出元が無い)、欠落も形式違反もそこでエラーになる。
  config_spec: {
    required: [],
    idPattern: null,
    idExample: '(K0 が config-catalog 固定であることを見る)',
  },
  // auth_spec も同じ分担で空にしてある。H0 が id が `auth-flow` 固定であることを見ており
  // (1 プロジェクト 1 フローなので導出元が無い)、欠落も形式違反もそこでエラーになる。
  auth_spec: {
    required: [],
    idPattern: null,
    idExample: '(H0 が auth-flow 固定であることを見る)',
  },
  // guarantee_spec も同じ分担で空にしてある。Z0 が id が `guarantee-catalog` 固定であることを見ており
  // (1 プロジェクト 1 カタログなので導出元が無い)、欠落も形式違反もそこでエラーになる。
  guarantee_spec: {
    required: [],
    idPattern: null,
    idExample: '(Z0 が guarantee-catalog 固定であることを見る)',
  },
  // surface_spec も同じ分担で空にしてある。T12 が id が `surface` 固定であることを見ており
  // (1 プロジェクト 1 枚なので導出元が無い)、欠落も形式違反もそこでエラーになる。
  surface_spec: {
    required: [],
    idPattern: null,
    idExample: '(T12 が surface 固定であることを見る)',
  },
  // external_spec も同じ分担で空にしてある。X0 が id が `external-catalog` 固定であることを見ており
  // (1 プロジェクト 1 カタログなので導出元が無い)、欠落も形式違反もそこでエラーになる。
  external_spec: {
    required: [],
    idPattern: null,
    idExample: '(X0 が external-catalog 固定であることを見る)',
  },
  // action_spec / query_spec で required と idPattern の両方を空にしているのは緩和ではなく分担である。
  // A0 は id が handles から導かれる `{集約}-{イベント}-action` と**一致する**ことを、
  // Q0 は id が name から導かれる `query-{name}` と一致することを、それぞれ既に見ている
  // (欠落も形式違反も、より強い検査でそこでエラーになる)。
  // 形だけを見る正規表現をここに置くと、同じ違反に弱い検査が 1 つ増えるだけになる。
  action_spec: {
    required: [],
    idPattern: null,
    idExample: '(A0 が handles との一致を見る)',
  },
  query_spec: {
    required: [],
    idPattern: null,
    idExample: '(Q0 が name との一致を見る)',
  },
  // screen_spec / query_spec と同じ理由で空にしてある。S0 が id と name の一致
  // (`screen-{name}` / `chrome-{name}`)を見ており、欠落も形式違反もそこでエラーになる。
  screen_spec: {
    required: [],
    idPattern: null,
    idExample: '(S0 が name との一致を見る)',
  },
  chrome_spec: {
    required: [],
    idPattern: null,
    idExample: '(S0 が name との一致を見る)',
  },
  // design_token_spec だけは id が導出元を持たない(1 プロジェクト 1 ファイルなので、
  // 名前から導く相手も連番も無い)。したがって G0 は id を見ておらず、
  // 「id: design-tokens であること」を確かめているのはこの 1 行だけである。
  design_token_spec: {
    required: ['id'],
    idPattern: /^design-tokens$/,
    idExample: 'design-tokens(固定)',
  },
  // ux_principles_spec(UX 原則の台帳)も 1 プロジェクト 1 ファイルで、id は導出元を持たない。
  // U8(台帳のローダー)が `ux-principles` 固定であることを見るので、ここは design_token_spec と同じく
  // 欠落と形式を M1 / M2 にも見せておく(台帳の id を書き忘れたとき、読み込みが落ちる前に M1 が名指しできる)。
  ux_principles_spec: {
    required: ['id'],
    idPattern: /^ux-principles$/,
    idExample: 'ux-principles(固定)',
  },
  // term_ledger(用語の台帳)は 1 プロジェクト 1 ファイルで、id は導出元を持たない。
  // M11(台帳のローダー)が `term-ledger` 固定であることを見るので、ここは design_token_spec と同じく
  // 欠落と形式を M1 / M2 にも見せておく(台帳の id を書き忘れたとき、台帳の読み込みが
  // 落ちる前に M1 が名指しできる)。
  term_ledger: {
    required: ['id'],
    idPattern: /^term-ledger$/,
    idExample: 'term-ledger(固定)',
  },
  // screen_spec / query_spec と同じ理由で空にしてある。Y0 が id と name の一致
  // (`usecase-{name}`)を見ており、欠落も形式違反もそこでエラーになる。
  usecase_spec: {
    required: [],
    idPattern: null,
    idExample: '(Y0 が name との一致を見る)',
  },
};

/**
 * doc_type に対応する要件を引く。ルール文書・仕様文書のどちらの表からも引く。
 *
 * @param docType フロントマターの doc_type
 * @returns 要件。doc_types.md に定義が無い doc_type なら null
 */
export function ruleFor(docType: string | null): DocTypeRule | null {
  if (docType === null) return null;
  return DOC_TYPE_RULES[docType] ?? SPEC_DOC_TYPE_RULES[docType] ?? null;
}

/**
 * docs/specs 配下の仕様文書の doc_type か。
 *
 * 判定にファイルの置き場所を使わないのは、「仕様かどうか」を決めるのは doc_type であって
 * ディレクトリではないため(置き場所の正は ARCH-SP-0002 / ARCH-SP-BE-0001 が別に持つ)。
 *
 * @param docType フロントマターの doc_type
 * @returns 仕様文書の doc_type なら true
 */
export function isSpecDocType(docType: string | null): boolean {
  return docType !== null && SPEC_DOC_TYPE_RULES[docType] !== undefined;
}
