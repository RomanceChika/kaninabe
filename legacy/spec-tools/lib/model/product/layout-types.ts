/**
 * 置き場の配置(`ProductLayout`)の**型だけの葉**。何も import しない。値(関数・定数)を 1 つも持たない。
 *
 * 配置の型を読むだけの側 —— 生成の文脈 `GenerateContext.layout`(`lib/gen-kit/generator.ts`)—— は、解決・検査の本体(`layout.ts` /
 * `layout-definition.ts`)を道連れにしない。`generator.ts` は C24(`formal/IdempotentCreate.tla` の写し元 `code-usecase-rpc.ts`)の写し元の
 * 閉包に入っており、型の import も閉包を辿るので、型を本体と同じファイルに置くと、**役割の語彙・解決を 1 行足すたびに RPC のモデルの hash が動く**
 * (部品化 ③-c1b の判断待ち。③-testcase の `types.ts` / `index.ts` と同じ「型・語彙の葉と、値の入口を分ける」形)。
 *
 * そのために、この葉は**役割の名前の一覧もキーの形の一覧も持たない**(どちらも `string`)。役割の語彙(`LAYOUT_ROLES`)・キーの形の語彙・
 * 下限は `layout.ts` が持ち、**配置が語彙に無い役割・キーの形を宣言していないこと**は選ぶ根の 1 回の検査(`layoutDefinitionProblems`)が見る。
 * 語彙を足す日にこの葉は動かない(動くのは契約の 6 項目の形そのものを変える日だけ)。
 *
 * 契約の 6 項目の説明は `layout.ts` の冒頭にある(型の欄ごとの意味はここの JSDoc)。
 *
 * **層と土台ディレクトリの表の型**(`RoleStructure` ・`LayerDecl` ・`BaseDirDecl` ほか。部品化 ③-c5)もここに置く。`source-root` の役割だけが宣言する欄 `structure` の型で、
 * 表の中身(層の 4 名を除く)はアプリの枠の後段の値、解く口は `lib/model/framework-base-dirs.ts`、整合の検査は `layout-structure.ts`。
 */

/** 役割の多重度。 */
export interface RoleMultiplicity {
  /**
   * 役割そのものを宣言する下限(`0` は「配置が宣言しなくてもよい」・`1` は「アプリの枠の後段が必ず宣言する」)。**キーごとに複数の役割でも、
   * 1 つ以上の実体(ファイル)を要求する意味ではない**(宣言しているのは「その役割の置き場をこの後段が決める」こと)。コアが役割ごとに決めた下限
   * (`layout.ts` の `LAYOUT_ROLE_MIN`)を下回れず、下限が 1 の役割は配置が必ず宣言する(`layoutDefinitionProblems`)。
   */
  readonly min: 0 | 1;
  /** 多くて何つか(`many` はキーごとに 1 つずつ複数)。 */
  readonly max: 1 | 'many';
  /** キーの形の名前(語彙は `layout.ts` の `LAYOUT_KEY_SHAPES`。`max: 1` は `none`・`many` は `none` 以外)。 */
  readonly key: string;
}

/** 役割の持ち主 1 つ。 */
export type RoleOwner =
  | { readonly kind: 'product_declaration' }
  | { readonly kind: 'product' }
  | { readonly kind: 'generator'; readonly id: string };

/**
 * 役割の読み書き。
 *
 * **執行するのは `writers` だけ**(持ち主の生成器に含まれること。`layoutDefinitionProblems`)。`readers` と `when` は**文書の欄**であって、
 * どの検査・生成器がそれを読むかを数えて突き合わせる仕組みは無い(書いてあることと実際の利用箇所が食い違っても赤にならない。人が配置を読む入口)。
 */
export interface RoleAccess {
  /** 読む側(検査のルール ID・生成器 ID など)。**文書の欄で、執行しない。** */
  readonly readers: readonly string[];
  /** 書く側(生成器 ID。持ち主の生成器に含まれること)。 */
  readonly writers: readonly string[];
  /** 読み書きが成り立つ条件(人が読む 1 文)。**文書の欄で、空でないことだけを見る。** */
  readonly when: string;
}

/**
 * 役割の**逆引き**(実在のファイルのパス → キー)。§20-2 の `classify` の、役割 1 つに閉じた最初の部分実装である。
 *
 * 仕様の側のキー(例: 画面の `route`)から置き場を引く `place` の逆で、**実装の木を走査して、どのキーの実体がそこにあるかを読む**側が使う
 * (S7 は実ルートを読んで仕様の route と突き合わせる)。走査の根(`dir`)と、その下の相対パス → キーの判定を、役割の宣言が持つ。
 */
export interface RoleClassifier {
  /** 走査する根(基準の役割からの相対。この下のファイルだけが対象)。 */
  readonly dir: string;
  /** `dir` からの相対パス(区切りは `/`)→ キー。この役割の実体でなければ null(どの役割にも当たらないファイルは数えない)。 */
  readonly keyOf: (relativePath: string) => string | null;
  /**
   * `dir` からの相対パス → この役割の**入口のファイルか**(キーに結べるかには依らない)。**省略は「キーに結べるファイルだけが入口」**(`keyOf` が null でないもの)。
   * 「全ての入口がどれかの宣言に分類される」という閉世界の検査(J2 の続き)が、**キーに結べない入口**(動的なセグメントの下・ルーティングに使わない名前の下)も
   * 見落とさないために使う —— そういう入口は URL を 1 本に決められず宣言のしようがないので、`keyOf` だけで集めると黙って検査の漏れになる。
   */
  readonly entryOf?: (relativePath: string) => boolean;
  /**
   * 入口のファイルとして**受ける唯一のファイル名**(例: `route.ts`)。省略は「入口のファイルの綴りを問わない」。
   * 宣言すると、入口の閉世界(J2 の続き)は `entryOf` が拾った入口のうち、ファイル名がこれと違うもの(`route.tsx` / `route.js` など)を error にする
   * —— 口を数える検査は置き場(`place`)の綴り 1 つで読むので、ほかの綴りの入口は実行時に口になるのに検査から消える(5 回目 C5-4・B5-1)。
   */
  readonly entryFileName?: string;
  /**
   * 製品の根(`product-root`)からの相対で、**あってはならない置き場**(在れば入口の閉世界(J2 の続き)が error)。省略は無し。
   * 枠が走査の根(`dir`)と並んで、または優先して口の根に選ぶ置き場を宣言する(Next.js の `pages` / `src/pages` / `app`。6 回目 C6-5・B6-2)。
   * 走査の根だけを歩く閉世界は、枠が別の根を選んだ口を見られないので、置き場そのものを拒む。
   */
  readonly forbiddenRoots?: readonly string[];
  /**
   * 製品の根からの相対で、枠がそのまま配る静的な置き場と、置いてよい拡張子(省略は見ない)。表の外の拡張子のファイルは J2 の続きが error にする。
   * 配る文書は前段の守りの外に出るので、文書として開かれない形だけに閉じる(点検 13 回目 B13-7)。
   */
  readonly staticRoot?: { readonly dir: string; readonly extensions: readonly string[] };
  /**
   * 製品の根に置く枠の設定ファイルと、その**既定の export に書いてよい鍵の許可表**(省略は見ない)。在るファイルの既定の export は、
   * 同じファイルのオブジェクトのリテラルで鍵が全部この表の中でなければ J2 が error にする(構文木で読む。`lib/job/frame-config-keys.ts`)。
   * 入口の母集合を変える欄(Next.js の `pageExtensions`・`rewrites` など)を表に載せないことで閉じる(6 回目 C6-5・7 回目 C7-4)。
   */
  readonly frameConfig?: {
    readonly files: readonly string[];
    readonly allowedKeys: readonly string[];
    /** 値の形を固定した欄(鍵 → その欄の文全体の綴り。字句の並びで比べる。7 回目 B7-4)。省略は固定しない。 */
    readonly fixedMembers?: Readonly<Record<string, string>>;
    /**
     * true なら**設定が在ることを要する**: `files` のどれも無ければ error、在るファイルが `fixedMembers` の欄を 1 つでも書いていなければ error(点検 16 回目 C16-3)。
     * 省略は「在るものだけ見る」。枠の設定が守りの配線(応答のヘッダなど)を持つとき、ファイルや欄を消すと守りが黙って消えるので、不在も閉じる。
     */
    readonly required?: boolean;
  };
  /**
   * 製品の根からの相対で、**枠が直下のファイルを名前で呼ぶ置き場**と、そこに置いてよいコードのファイルの許可表(省略は見ない)。
   * 置き場の直下のコードのファイル(拡張子 `.js` / `.jsx` / `.ts` / `.tsx` と、その `c` / `m` の形)のうち、表に無いものは J2 の続きが error にする(点検 16 回目 C16-3)。
   * Next.js は `src` の直下の `proxy` / `middleware` / `instrumentation` / `instrumentation-client` を名前で呼ぶので、表に載せた名前だけを口にする。
   */
  readonly frameRootFiles?: { readonly dir: string; readonly files: readonly string[] };
}

/**
 * 層(ソースの根の直下のディレクトリ)1 つの宣言。層の 4 名(`domain` / `operation` / `infrastructure` / `composition`)は**コアの語**で、コアが持つ。
 * 配置の値が宣言するのは、スタックが足す層(例: ルーティングの層・UI 部品の層)だけである。
 */
export interface LayerDecl {
  /** 層の名前 = ソースの根の直下のディレクトリ名。 */
  readonly name: string;
  /** 何の層か(人が読む説明。閉世界の検査のエラー文面に出る)。 */
  readonly role: string;
  /** 直下の「集約か、宣言された土台ディレクトリか」の閉世界を、誰が見るか(`structure_test` = 構造テスト / `verifier` = 検証器 / `none` = 見ていない)。 */
  readonly closedWorld: 'structure_test' | 'verifier' | 'none';
  /** 層ぜんたいを語彙漏れの走査(W1)に載せるときの拡張子。**省略は載せない**(層の直下の土台ディレクトリだけが `BaseDirDecl.vocabularyScan` で載る)。 */
  readonly scanExtensions?: readonly string[];
}

/**
 * 層の直下にある「集約でないディレクトリ」(土台)1 つの宣言。置き場は `{ソースの根}/{層}/{dir}`(`root: 'framework'` は実行時パッケージのソースの根から)。
 * 土台は検査・lint・構造テストが免除リストとして別々に持っていた事実の唯一の正で、生成物 `framework-structure.json` に写る。
 */
export interface BaseDirDecl {
  /** どちらの根に住んでいるか(`product` = 製品の実装の木 / `framework` = 実行時パッケージ)。 */
  readonly root: 'product' | 'framework';
  /** 属する層の名前(コアの層の 4 名か、`RoleStructure.layers` の名前)。 */
  readonly layer: string;
  /** 層の直下からの相対パス(区切りは `/`。例: `usecase` ・`_actions/usecase`)。 */
  readonly dir: string;
  /** 何の置き場か(人が読む説明)。 */
  readonly role: string;
  /** 配下が生成物か。 */
  readonly generated: boolean;
  /** 仕組みの手書きコードとして語彙漏れの走査(W1 / W2)に載せるか(`root: 'product'` の行だけが走査の入力になる)。 */
  readonly vocabularyScan: boolean;
  /** 中身の並び方(`flat` = 直下にファイル / `nested` = 1 段のサブディレクトリの下にファイル)。 */
  readonly layout: 'flat' | 'nested';
  /** 中身がそのアプリの仕様の量で決まるか(`generated: true` の置き場だけが true になりうる)。 */
  readonly perSpec: boolean;
  /**
   * この置き場に書き込む役割と、その役割のキーの見本(**文書ではなく、執行される**)。宣言すると、役割の置き場(キーの見本を `place` に通したパス)が
   * この土台の中にあることを配置の定義の検査が見る(役割の表と土台の表が別々に書かれて食い違うのを止める)。
   */
  readonly placedBy?: { readonly role: string; readonly key: string };
  /**
   * この土台が値として import してよい外部の SDK のパッケージ(綴りは external_spec の `sdk_packages` と同じ。省略は無し)。
   * **この土台の下でだけ**引ける(接続層のクライアントの SDK など。X1 の (d) と ESLint の層の境界が同じ表を見る。点検 9 回目 B9-4)。
   */
  readonly sdkPackages?: readonly string[];
}

/**
 * 土台の表に**載せていない**、層の直下の手書きの置き場 1 つ。逆引き(`classify`)が操作・集約として読まないためにだけ使い、生成物 `framework-structure.json` には写らない
 * (載せると生成物が変わる。閉世界を宣言できていない層の穴を、載せないまま名指しておく)。
 */
export interface UnlistedDirDecl {
  /** 属する層の名前。 */
  readonly layer: string;
  /** 層の直下からの相対パス。 */
  readonly dir: string;
  /** 何の置き場か(人が読む説明)。 */
  readonly role: string;
}

/** 集約ディレクトリの直下にあって、ドメインイベントに対応しないファイル 1 つの宣言(「1 ドメインイベント = 1 ファイル」の例外)。 */
export interface AuxFileDecl {
  /** どの層の集約ディレクトリの直下か(層の名前)。 */
  readonly layer: string;
  /** ファイル名(拡張子込み)。 */
  readonly file: string;
  /** 何のファイルか(人が読む説明)。 */
  readonly role: string;
}

/**
 * ソースの根の下の**層と土台ディレクトリの表**(`source-root` の役割だけが持つ)。アプリの枠の後段が、自分のスタックの木のこの表を宣言する。
 * 層の 4 名はコアの語で、ここに書くのはスタックが足す層・全部の土台・載せていない手書きの置き場・補助ファイル・実行時パッケージのソースの根の綴りである。
 */
export interface RoleStructure {
  /** コアの層の 4 名に**足す**層(宣言順に、コアの 4 名のあとへ並ぶ)。 */
  readonly layers: readonly LayerDecl[];
  /** 土台ディレクトリの全数(宣言順がそのまま生成物の並びになる)。 */
  readonly baseDirs: readonly BaseDirDecl[];
  /** 土台の表に載せていない手書きの置き場。 */
  readonly unlistedDirs: readonly UnlistedDirDecl[];
  /** 集約ディレクトリの直下の補助ファイル(「1 ドメインイベント = 1 ファイル」の例外)の全数。 */
  readonly auxFiles: readonly AuxFileDecl[];
  /** 実行時パッケージ(`root: 'framework'` の土台が住む)のソースの根(パッケージの根からの相対)。 */
  readonly runtimeSource: string;
  /**
   * 枠の基盤のパッケージ(どの層のどのファイルも値として import してよい外部パッケージ。綴りは包みの名前)。基盤の層(infrastructure)の
   * ファイルが引く外部パッケージは、これ・土台の `sdkPackages`・外部連携の `sdk_packages` のどれかでなければならない(X1 の (d)。
   * 宣言の無い SDK を基盤の層に置かせない)。省略は無し(Node の組み込みと仕組みの部品だけ)。
   */
  readonly foundationPackages?: readonly string[];
}

/** 役割 1 つの宣言(契約の 6 項目 + 値)。 */
export interface RoleDecl {
  /** 多重度。 */
  readonly multiplicity: RoleMultiplicity;
  /** 持ち主(1 つ以上)。 */
  readonly owners: readonly RoleOwner[];
  /** 基準の役割の名前(`null` はリポジトリルート)。基準の役割はキーを持たない。 */
  readonly base: string | null;
  /** 生成物か手書きか(`generated` は持ち主が生成器だけ・`handwritten` は生成器を含まない・`mixed` は両方)。 */
  readonly origin: 'generated' | 'handwritten' | 'mixed';
  /** 読み書きの条件。 */
  readonly access: RoleAccess;
  /** 衝突したときの扱い(失敗だけ)。 */
  readonly onCollision: 'fail';
  /**
   * 基準の役割からの相対パス(キーを受ける)。`null` は「製品の宣言が決める」(製品の宣言が持ち主の役割だけ)。
   * **具体のスタックの綴りはここにだけ書かれる**(後段の値)。
   */
  readonly place: ((key: string) => string) | null;
  /**
   * import に使うモジュール指定(`@/…` など。生成物の本文に出る)。`null` は import されない役割。
   * import される役割(`layout.ts` の `LAYOUT_MODULE_ROLES`)は必須で、`place(k)` の拡張子を除いたものを基準の役割の `module` に接いだ形と一致すること
   * (`layoutDefinitionProblems`)。
   */
  readonly module: ((key: string) => string) | null;
  /** 逆引き(実在のファイル → キー)。**持たない役割は省略**(実装の木を走査して読む必要のある役割だけが宣言する)。 */
  readonly classify?: RoleClassifier;
  /** 層と土台ディレクトリの表。**`source-root` の役割だけが宣言する**(ほかの役割が持つと配置の定義の問題)。 */
  readonly structure?: RoleStructure;
}

/**
 * 役割の名前 → 宣言。**宣言していない役割は、この構成では置き場が決まらない**(解決は null)。
 *
 * 役割の名前は `string` である(語彙の正は `layout.ts` の `LAYOUT_ROLES`。語彙に無い名前の宣言は `layoutDefinitionProblems` が止める)。
 */
export type ProductLayout = Readonly<Partial<Record<string, RoleDecl>>>;
