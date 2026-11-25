/**
 * 製品が**採る仕様の種類**(`product.md` の `uses`)の値域と置き場。
 *
 * `roots` が「木がどこにあるか」(置き場)を宣言するのに対し、`uses` は「どの種類を採るか」
 * (採用)を宣言する。**別の軸**である。仕組みは、採っていない種類の検査を「未実施」と報告し、
 * 採ったのに読めない種類の検査を「阻害」と報告する(`kernel/input-state.ts`)。ファイルの有無から
 * 採用を推定しない —— 推定すると、採ったのに消えた種類が「採っていない」に化けて黙る。
 *
 * **値域は仕組みが固定する**(閉じた一覧)。名前は各種類のカタログ名で、製品の語ではない。
 * 検査が別の種類の入力として受け取りうる種類(各群の入力・台帳の材料に現れる種類)を全部載せる。
 * 載せないもの: ドメイン仕様(どの製品にも要る。`roots.specs` の中の `domain`)・用語の台帳
 * (どの検査の入力でもなく、M 群が自分で読む)。
 */

/** 採ることを宣言できる仕様の種類(閉じた一覧)。 */
export const SPEC_KINDS = [
  'actions',
  'queries',
  'data_tables',
  'notifications',
  'jobs',
  'config',
  'auth',
  'guarantees',
  'external',
  'surface',
  'screens',
  'usecases',
  'ux_principles',
  'design_tokens',
] as const;

/** 採ることを宣言できる仕様の種類。 */
export type SpecKind = (typeof SPEC_KINDS)[number];

/** 製品が採ると宣言した種類(`uses`。宣言順・重複なし)。 */
export type ProductUses = readonly SpecKind[];

/** 置き場の形: `file` は 1 枚のカタログ、`dir` は 1 件 1 ファイルのディレクトリ。 */
export type SpecPlacementShape = 'file' | 'dir';

/** 種類の置き場(仕様の木 `roots.specs` からの相対パス。区切りは "/")。 */
export interface SpecKindPlacement {
  readonly shape: SpecPlacementShape;
  /** 置き場の候補。**どれか 1 つに仕様があれば**採っている形である(画面は screens と chrome の 2 つ)。 */
  readonly paths: readonly string[];
}

/**
 * 種類ごとの置き場(根の中の形は仕組みが決めている。placement_policy.md の specs 配下の表と同じ)。
 *
 * `dir` の置き場は、README とテンプレート(`template.*`)以外の `.md` が 1 枚でもあれば「仕様がある」とみなす
 * (テンプレートだけを置いた新規の製品を「採っている」と数えない)。
 */
export const SPEC_KIND_PLACEMENTS: Readonly<Record<SpecKind, SpecKindPlacement>> = {
  actions: { shape: 'dir', paths: ['backend/actions'] },
  queries: { shape: 'dir', paths: ['backend/queries'] },
  data_tables: { shape: 'dir', paths: ['backend/data/tables'] },
  notifications: { shape: 'file', paths: ['backend/notifications.md'] },
  jobs: { shape: 'file', paths: ['backend/jobs.md'] },
  config: { shape: 'file', paths: ['backend/config.md'] },
  auth: { shape: 'file', paths: ['backend/auth.md'] },
  guarantees: { shape: 'file', paths: ['backend/guarantees.md'] },
  external: { shape: 'file', paths: ['backend/external.md'] },
  surface: { shape: 'file', paths: ['backend/surface.md'] },
  screens: { shape: 'dir', paths: ['frontend/screens', 'frontend/chrome'] },
  usecases: { shape: 'dir', paths: ['frontend/usecases'] },
  ux_principles: { shape: 'file', paths: ['frontend/ux-principles.md'] },
  design_tokens: { shape: 'file', paths: ['frontend/design/tokens.md'] },
};

/**
 * 依存が効く条件(閉じた一覧)。依る側の仕様の中身の事実が条件で、名指す先が無い仕様(0 件のカタログ・名指しの無い連携だけ・
 * 副作用を持たないドメイン仕様)に、先の種類を要求しない。`kind` を採るだけで要る依存は、いまは無い(足すときは条件の値を足す)。
 *
 * - `has-integration` … 外部連携カタログに連携が 1 件以上ある
 * - `has-inbound-integration` … 外部連携カタログに受信の連携が 1 件以上ある
 * - `has-domain-effects` … ドメイン仕様に副作用の宣言(`effects[].do` / `writes[].effects`)が 1 件以上ある
 * - `has-notify-effects` … その副作用のうち通知の ID(`notify_` で始まる)が 1 件以上ある
 * - `has-schedule-emits` … ジョブカタログの走査(`source: schedule`)が通知を積む宣言(`emits`)を 1 件以上持つ
 */
export type SpecKindCondition =
  | 'has-integration'
  | 'has-inbound-integration'
  | 'has-domain-effects'
  | 'has-notify-effects'
  | 'has-schedule-emits';

/**
 * 依る側の種類。採る種類(`SpecKind`)に加えて**ドメイン仕様**(`domain`)を持つ —— ドメイン仕様は `uses` に載らない
 * (どの製品にも要る)が、中身が別の種類を名指すことはある(副作用の ID はジョブカタログ・通知カタログを名指す)。
 */
export type RequiringKind = SpecKind | 'domain';

/** 「ある種類を採るなら(ドメイン仕様がこう書くなら)、別の種類も採る」の 1 本(P2 が見る)。 */
export interface SpecKindRequirement {
  /** 採ると(`domain` は常に)、`requires` も要る種類。 */
  readonly kind: RequiringKind;
  /** 一緒に採らなければならない種類。 */
  readonly requires: SpecKind;
  /** 要求が効く条件(`kind` の仕様の中身を読む。読めないときは効くものとして扱う)。 */
  readonly when: SpecKindCondition;
  /** なぜ要るか(P2 の指摘の文に載る)。 */
  readonly because: string;
}

/**
 * 種類同士の依存(閉じた一覧)。**仕様の側が必ず別の種類を名指す**種類だけを載せる —— 名指された先を採っていないと、
 * 名指しの接地(その先に実在するか)を見る検査が「接地先は無い」と読んで何も言わなくなる(採っていない = 事実、という基準と衝突する)。
 * 衝突は検査の中ではなく、宣言の段(P2)で止める。名指しが**連携の 1 件ごと**に生まれる依存は、連携が 1 件以上あるとき(受信なら受信が
 * 1 件以上あるとき)だけ要求する(`when`)。ドメイン仕様の副作用も同じで、副作用を 1 件でも宣言したら、その接地先のカタログが要る
 * (ジョブカタログを採らないと、連鎖の判定・T19・同じトランザクションで実現する副作用の判定が黙って空になり、匿名化が同じ
 * トランザクションで起きない計画が組まれる)。
 */
export const SPEC_KIND_REQUIREMENTS: readonly SpecKindRequirement[] = [
  {
    kind: 'external',
    requires: 'config',
    when: 'has-integration',
    because: '各連携が config: で設定の id を必ず挙げる(空にできない)ので、その接地先の設定カタログが要る',
  },
  {
    kind: 'external',
    requires: 'data_tables',
    when: 'has-inbound-integration',
    because: '受信の連携が event_id_table(必須)で data_tables の表を必ず挙げるので、その接地先のテーブル仕様が要る',
  },
  {
    kind: 'domain',
    requires: 'jobs',
    when: 'has-domain-effects',
    because:
      'ドメイン仕様の副作用(state_spec の effects[].do / access_spec の writes[].effects)が outbox のジョブの ID を名指すので、' +
      'その接地先のジョブカタログが要る(無いと、どの副作用が同じトランザクションで実現されるか・何が連鎖するかの判定が黙って空になる)',
  },
  {
    kind: 'domain',
    requires: 'notifications',
    when: 'has-notify-effects',
    because: 'ドメイン仕様の副作用が通知の ID(notify_…)を名指すので、その接地先の通知カタログが要る',
  },
  {
    kind: 'jobs',
    requires: 'notifications',
    when: 'has-schedule-emits',
    because: '時刻で起きる走査が emits で通知の ID を名指すので、その接地先の通知カタログが要る',
  },
];

/** 依る側が採られているか(ドメイン仕様はどの製品も持つので常に採っている)。 */
export function requiringKindUsed(uses: ProductUses, kind: RequiringKind): boolean {
  return kind === 'domain' || usesKind(uses, kind);
}

/**
 * 旧い綴りの種類と、書き直し先の対応。二重には受けず、`uses` の parser が名指して error にする。
 * 引くのは自前の `Map` だけ(オブジェクトの添字で引くと継承されたプロパティを拾う)。
 */
export const RETIRED_SPEC_KINDS: ReadonlyMap<string, SpecKind> = new Map<string, SpecKind>([['api', 'surface']]);

/** 文字列が、採ることを宣言できる種類か(閉じた一覧に載っているか)。 */
export function isSpecKind(value: string): value is SpecKind {
  return SPEC_KINDS.some((kind) => kind === value);
}

/** 製品がその種類を採っているか。 */
export function usesKind(uses: ProductUses, kind: SpecKind): boolean {
  return uses.includes(kind);
}

/** 入力の状態(`kernel/input-state.ts` の `catalogInput`)へ渡す選択。 */
export function selectionOf(uses: ProductUses, kind: SpecKind): 'selected' | 'unselected' {
  return usesKind(uses, kind) ? 'selected' : 'unselected';
}
