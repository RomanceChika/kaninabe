/**
 * **adapter の公開の口の閉じた照らし**(fix27 項目 C。差分点検 fix26 14 回目 E14-1・M14-1 の直し)。照らしの本体の唯一の持ち主。
 *
 * 約束は「RPC と表の書き込みの道は、やり直しの口(`retryRollbacks` / `retryTableWrites`)を通った型の印つきの口だけ」である
 * (保証 `fw_connection_path_closed`)。名指した口だけを見る試験では、adapter に生の接続層を返す口を 1 つ足しても何も赤にならない。
 * そこで、adapter の `package.json` の `exports` の**全部の入口の、全部の口(値と型)**を TypeScript の型検査器で数え、次を照らす:
 *
 * 1. **閉じた表**: 各 adapter の `src/__tests__/public-surface.test.ts` の `export interface PublicSurface` が、入口ごとに口の名前 → 型を
 *    持つ。入口の集合・口の集合は `exports` と入口のモジュールの輸出に両方向で一致する(足したのに表に無い・消したのに表に残るは赤)。
 *    各欄の型は、その入口を名前空間で読んだ `typeof 入口.名前`(値の口)か `入口.名前<…>`(型の口)で、欄の名前と同じ名前を指す。
 *    入口は `exports` の鍵の全部で、`test` 条件の無い入口も型の入口を解いて数え、解けない鍵は赤にする({@link entriesOf})。
 * 2. **生の道**: 表の各口の型(と、型引数を持つ口は宣言の型を制約の上限で読んだもの。{@link declaredTypeOf})を、型検査器で**全部の多重定義**の引数と戻り値・構築子・欄・添字まで、上限の深さ
 *    ({@link SURFACE_DEPTH_LIMIT} 段)までたどり、たどった先の各型を規則 `RawPathRule`(`../src/rpc/read-only-client.ts`。「何が生の道か」の
 *    規則の持ち主)に掛ける。当たれば口と住所を名指す(生の `rpc`・`schema`・`from` の書き込みを返す・受け取る口)。
 * 2b. **読み切れない口**(閉じる側に倒す): 上限の深さでまだ奥に関数が続く型・型検査器が解けない型・どの段でも口が渡す `any` に
 *    当たったら、その口は赤である。
 *    表の `export interface UnreadAddresses`(入口 → 住所 → 理由)に理由つきの行があるときだけ、その住所の奥の「読み切れない」を受ける
 *    (行の奥でも生の道は名指す。当たる住所の無い行も赤)。黙って通す形は持たない。
 * 3. **期待した型の誤りの番号**({@link expectedErrorProblems}): `// @ts-expect-error TS2339 …` の行の次の行が、**その番号の誤りだけ**で
 *    落ちること(別の理由で落ちて黙って通る `@ts-expect-error` を作らない)。
 *
 * 字面は読まない(構文木と型検査器だけ)。試験の作り物を渡せるように、ファイルの中身を差し替える口(`files`)を持つ。
 *
 * @oversize 公開の口の照らし 1 つの責務(表の閉世界・型の走査・読み切れない住所の行・誤りの番号)を、同じ住所の文法と同じ型検査の道具で 1 か所に持つ。
 * @split-review 割る案は「型をたどる走査(SurfaceWalk と規則の読み取り)」と「表との突き合わせ(入口・口・行の照らしと誤りの番号)」の 2 枚。
 * 採らなかった: 走査が組む住所の書き方(`()`・`(0)`・`@2`・`<0>`・`[]`)と、表の UnreadAddresses の行が当たる判定は同じ住所の文法を
 * 両側で持ち、走査は表の行を受け取って行の奥かどうかを状態に持つ。割ると住所の文法が 2 枚に分かれ、片方だけ変えると行が黙って当たらなくなる。
 * 照らしの持ち主を 1 つのモジュールに置く決め(fix27 項目 C の続き)でもある。
 */

/// <reference types="node" />

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** 閉じた表の置き場(adapter の根からの相対)。 */
export const SURFACE_TABLE = 'src/__tests__/public-surface.test.ts';

/** 期待した型の誤りを並べる探りの置き場(adapter の根からの相対。無い adapter もある)。 */
export const SURFACE_PROBE = 'src/__tests__/surface-probe.ts';

/**
 * たどる深さの上限(口 = 0 段。引数・戻り値・欄・添字・標準の型の型引数へ 1 歩進むごとに 1 段。`Promise` を解くのは数えない)。
 * これより深くに続く型は読み切れないとして赤にする(表の {@link UNREAD_INTERFACE} の理由つきの行だけが受ける)。
 */
export const SURFACE_DEPTH_LIMIT = 12;

/** 表の interface の名前。 */
const SURFACE_INTERFACE = 'PublicSurface';

/** 「何が生の道か」の規則(このパッケージの持ち物)。 */
const RAW_RULE_FILE = join(import.meta.dirname, '../src/rpc/read-only-client.ts');

/** 差し替える中身(絶対パス → 中身)。 */
export type FileOverlay = Readonly<Record<string, string>>;

/** 照らしの入力。 */
export interface SurfaceInput {
  /** adapter の根(`package.json` と `tsconfig.json` を持つ)。 */
  readonly packageDir: string;
  /** 閉じた表のファイル(省略は {@link SURFACE_TABLE})。 */
  readonly tableFile?: string;
  /** 中身の差し替え(試験の作り物)。 */
  readonly files?: FileOverlay;
  /** たどる深さの上限(省略は {@link SURFACE_DEPTH_LIMIT}。試験が上限の手前と奥を作るための口)。 */
  readonly depthLimit?: number;
}

/** 差し替えを考えたファイルの読み口。 */
function reader(files: FileOverlay): { readonly exists: (file: string) => boolean; readonly read: (file: string) => string | undefined } {
  return {
    exists: (file) => file in files || existsSync(file),
    read: (file) => files[file] ?? (existsSync(file) ? readFileSync(file, 'utf8') : undefined),
  };
}

/** adapter の型検査の設定(試験の条件で自分のソースに解く)。 */
function compilerOptionsOf(packageDir: string, files: FileOverlay): ts.CompilerOptions {
  const { read } = reader(files);
  const configFile = join(packageDir, 'tsconfig.json');
  const text = read(configFile);
  if (text === undefined) throw new Error(`${configFile} がありません`);
  const parsed = ts.parseJsonConfigFileContent(ts.parseConfigFileTextToJson(configFile, text).config, ts.sys, packageDir);
  return { ...parsed.options, noEmit: true, incremental: false, customConditions: ['test'] };
}

/** 差し替えを読む型検査の道具一式。 */
function programOf(roots: readonly string[], options: ts.CompilerOptions, files: FileOverlay): ts.Program {
  const host = ts.createCompilerHost(options);
  const { exists, read } = reader(files);
  const base = { getSourceFile: host.getSourceFile.bind(host) };
  // 差し替えの置き場はディスクに無くてよい(作り物の adapter)。モジュールの解決は置き場の実在も確かめるので、差し替えの親も在ることにする。
  const overlayDirs = new Set(Object.keys(files).flatMap((file) => {
    const dirs: string[] = [];
    for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) dirs.push(dir);
    return dirs;
  }));
  const directoryExists = host.directoryExists?.bind(host);
  host.fileExists = exists;
  host.readFile = read;
  host.directoryExists = (dir) => overlayDirs.has(dir) || (directoryExists?.(dir) ?? existsSync(dir));
  host.getSourceFile = (file, language, onError) => {
    const text = files[file];
    return text === undefined ? base.getSourceFile(file, language, onError) : ts.createSourceFile(file, text, language);
  };
  return ts.createProgram({ rootNames: [...roots], options, host });
}

/** 誤りを 1 行の文にする(ファイル・行・番号・文)。 */
function describe(diagnostic: ts.Diagnostic): string {
  const where = diagnostic.file === undefined || diagnostic.start === undefined ? '' : `${basename(diagnostic.file.fileName)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1} `;
  return `${where}TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
}

/** 名前の付いた欄の名前(文字列のリテラルか識別子)。 */
function memberName(member: ts.TypeElement): string | undefined {
  const { name } = member;
  return name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined;
}

/** 別名をたどった先の記号。 */
function resolved(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);
}

/** 片方にだけある名前を、向きつきの文にする。 */
function oneSided(where: string, actual: readonly string[], listed: readonly string[]): string[] {
  return [
    ...actual.filter((name) => !listed.includes(name)).map((name) => `${where}: 口 ${name} が表に載っていない`),
    ...listed.filter((name) => !actual.includes(name)).map((name) => `${where}: 表の ${name} は口に無い`),
  ];
}

/** 表の 1 欄の型の書き方が、その入口の同じ名前の口を指しているか。 */
function memberProblems(checker: ts.TypeChecker, entry: string, module: ts.Symbol, member: ts.PropertySignature, exported: ts.Symbol): string[] {
  const name = memberName(member) ?? '?';
  const node = member.type;
  const qualified = node !== undefined && ts.isTypeQueryNode(node) ? node.exprName : node !== undefined && ts.isTypeReferenceNode(node) ? node.typeName : undefined;
  if (qualified === undefined || !ts.isQualifiedName(qualified) || !ts.isIdentifier(qualified.left)) return [`${entry}: 表の ${name} は「入口.名前」の形で口を指さない`];
  const namespace = checker.getSymbolAtLocation(qualified.left);
  const problems: string[] = [];
  if (namespace === undefined || resolved(checker, namespace) !== module) problems.push(`${entry}: 表の ${name} は別の入口を指す`);
  if (qualified.right.text !== name) problems.push(`${entry}: 表の ${name} は別の口 ${qualified.right.text} を指す`);
  const isValue = (resolved(checker, exported).flags & ts.SymbolFlags.Value) !== 0;
  if (isValue !== ts.isTypeQueryNode(node as ts.TypeNode)) problems.push(`${entry}: 表の ${name} は${isValue ? '値の口なので typeof で' : '型の口なので型の参照で'}書く`);
  return problems;
}

/**
 * 型の入口を解く条件(型検査器が試験の条件 `customConditions: ['test']` と bundler の解決で当てる条件の全部)。
 * ほかの条件(`node`・`browser`・`development` など)は型検査器が当てないので、その下の入口は読まない(読めない入口は下で赤にする)。
 */
const ENTRY_CONDITIONS: ReadonlySet<string> = new Set(['test', 'types', 'import', 'require', 'default']);

/** 型検査器が型として読むファイル(`.ts` / `.mts` / `.cts` / `.tsx` と、その `.d.ts`)。 */
const TYPED_FILE = /\.(?:d\.)?[mc]?tsx?$/;

/**
 * `exports` の 1 つの値から、型の入口の相対パスを解く(型検査器と同じく、鍵の順に当たる条件を見て、最初に解けたもの。入れ子の条件も読む)。
 * 文字列はそのまま入口。配列・当たる条件が無い・どの枝も解けないは undefined(呼び手が「読めない入口」として赤にする)。
 */
function targetOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  for (const [condition, nested] of Object.entries(value)) {
    if (!ENTRY_CONDITIONS.has(condition)) continue;
    const target = targetOf(nested);
    if (target !== undefined) return target;
  }
  return undefined;
}

/** `exports` の入口の数え上げ(鍵の全部と、解けた入口のソース。解けない鍵は食い違いの文)。 */
interface Entries {
  /** `exports` の鍵の全部(解けない鍵も含む。表の入口の集合と両方向に照らす)。 */
  readonly keys: readonly string[];
  /** 鍵 → 型の入口のソース(解けた鍵だけ)。 */
  readonly sources: ReadonlyMap<string, string>;
  /** 解けない鍵の食い違い。 */
  readonly problems: readonly string[];
}

/**
 * `exports` の入口の**全部**を数える(fix27 差分点検 C27-1。黙って捨てる鍵を持たない)。
 * 文字列の入口・`{ types, default }`・入れ子の条件も、`test` 条件の入口と同じく型の入口を解いて照らす。`./testing/` の入口も外さない
 * (試験の基盤の口も配布の入口なので、表に載せて同じ照らしに掛ける)。`exports` が文字列か条件だけのオブジェクトなら `.` の 1 本である。
 * 解けない鍵(`*` の入口・型のファイルを指さない・ファイルが無い)は赤にする。`null` の鍵は入口を塞ぐ宣言で、口が無いので数えない。
 */
function entriesOf(packageDir: string, files: FileOverlay): Entries {
  const { read, exists } = reader(files);
  const manifest = JSON.parse(read(join(packageDir, 'package.json')) ?? '{}') as { readonly exports?: unknown };
  const raw = manifest.exports;
  const sugar = typeof raw === 'string' || Array.isArray(raw) || (typeof raw === 'object' && raw !== null && Object.keys(raw).every((key) => !key.startsWith('.')));
  const map: Readonly<Record<string, unknown>> = raw === undefined || raw === null ? {} : sugar ? { '.': raw } : (raw as Readonly<Record<string, unknown>>);
  const keys: string[] = [];
  const sources = new Map<string, string>();
  const problems: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (value === null) continue;
    keys.push(key);
    const target = key.includes('*') ? undefined : targetOf(value);
    const source = target === undefined ? undefined : join(packageDir, target);
    if (source === undefined || !TYPED_FILE.test(source) || !exists(source)) {
      problems.push(`入口 ${key} の型の入口を解けない(${target ?? '当たる条件 test / types / import / require / default が無い・* の入口'}。照らせない入口は閉じる側に倒して赤)`);
      continue;
    }
    sources.set(key, source);
  }
  return { keys, sources, problems };
}

/** たどった先の答え(住所は口からの相対。`''` はその型そのもの)。 */
interface Found {
  /** 生の道に届く最初の住所(無ければ undefined)。 */
  readonly raw: string | undefined;
  /** 深さの上限で読み切れなかった最初の住所(表の行が受けたものは数えない)。 */
  readonly unread: string | undefined;
  /** 読み切れなかった住所の数(同じ型を別の道で通ると重ねて数える。目安)。 */
  readonly unreadCount: number;
  /** 読み切れない住所を受けた、表の行。 */
  readonly excused: ReadonlySet<string>;
}

/** 何も見つからない答え。 */
const NOTHING: Found = { raw: undefined, unread: undefined, unreadCount: 0, excused: new Set() };

/** 規則 `RawPathRule` を読んだもの(規則のデータの持ち主は `../src/rpc/read-only-client.ts`)。 */
interface Rule {
  readonly callables: ReadonlySet<string>;
  readonly opener: ReadonlySet<string>;
  readonly reads: ReadonlySet<string>;
  readonly writes: ReadonlySet<string>;
  readonly except: ts.Type;
  readonly anyOutWithin: number;
}

/** 規則の interface の名前。 */
const RULE_INTERFACE = 'RawPathRule';

/** 読まなくてよい住所の表の interface の名前(`入口 → 住所 → 理由の文字列`)。 */
const UNREAD_INTERFACE = 'UnreadAddresses';

/**
 * 読まなくてよい宣言の表の interface の名前(`宣言の鍵 → 理由の文字列`。fix27 直し C の続き)。宣言の鍵は
 * `パッケージ/パッケージの中のファイル#名前`(`node_modules` の外は `./adapter の根からのファイル#名前`)。住所の行と違い、
 * 同じベンダーの型が多くの住所に現れる(利用者の metadata の袋が認証の全部の戻りに出る)ときに、宣言 1 つで受ける。
 * 受けるのは、その宣言の中に書かれた欄・添字・引数・戻り値の奥の「読み切れない」(渡す `any` を含む)だけで、生の道は行の中でも名指す。
 */
const UNREAD_DECLARATIONS_INTERFACE = 'UnreadDeclarations';

/** 受けた答えの中で、宣言の行を住所の行と分ける印。 */
const DECLARATION_MARK = 'decl:';

/** 名前を持つ宣言(宣言の行の鍵になるもの)。 */
type NamedDeclaration = ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration;

/** 欄・添字・関数の宣言を囲む、名前を持つ宣言の鍵(置き場と名前。囲む宣言が無ければ undefined)。 */
function declarationKeyOf(member: ts.Node, packageDir: string): string | undefined {
  let node: ts.Node | undefined = member;
  while (node !== undefined && !(ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node))) node = node.parent;
  const named = node as NamedDeclaration | undefined;
  if (named?.name === undefined) return undefined;
  const file = named.getSourceFile().fileName;
  const vendor = /^.*[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/](.+)$/.exec(file);
  const place = vendor === null ? `./${relative(packageDir, file).split(sep).join('/')}` : `${vendor[1]!.replace(/\\/g, '/')}/${vendor[2]!.replace(/\\/g, '/')}`;
  return `${place}#${named.name.text}`;
}

/** これ以上たどらない型(値の中身を持たない)。 */
const LEAF_FLAGS = ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.EnumLike | ts.TypeFlags.ESSymbolLike
  | ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never | ts.TypeFlags.Unknown | ts.TypeFlags.NonPrimitive;

/**
 * 型検査器が解けなかった型か(展開が深すぎる・壊れた型。`any` の形をとるが、口の約束ではなく読めなかった印)。読めない所は閉じる側に倒す。
 */
function isUnresolved(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.Any) !== 0 && (type as { readonly intrinsicName?: string }).intrinsicName === 'error';
}

/** Node の実行時の型の置き場(標準の型に数える。{@link SurfaceWalk} の isStandardFile)。 */
const NODE_RUNTIME_TYPES = /[\\/]node_modules[\\/](?:@types[\\/]node|undici-types)[\\/]/;

/** 循環に当たらなかった印(道の上の位置より大きい)。 */
const NO_CYCLE = Number.POSITIVE_INFINITY;

/** 規則のファイルから規則を読む(読めなければ食い違いの文)。 */
function ruleOf(checker: ts.TypeChecker, file: ts.SourceFile | undefined): Rule | string {
  const declaration = file?.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === RULE_INTERFACE);
  if (declaration === undefined) return `規則 ${RULE_INTERFACE} を読めません`;
  const rule = checker.getTypeAtLocation(declaration.name);
  const member = (name: string): ts.Type | undefined => {
    const symbol = checker.getPropertyOfType(rule, name);
    return symbol === undefined ? undefined : checker.getTypeOfSymbol(symbol);
  };
  const names = (name: string): ReadonlySet<string> => {
    const type = member(name);
    return new Set((type === undefined ? [] : type.isUnion() ? type.types : [type]).flatMap((part) => (part.isStringLiteral() ? [part.value] : [])));
  };
  const except = member('except');
  const within = member('anyOutWithin');
  if (except === undefined || within === undefined || !within.isNumberLiteral()) return `規則 ${RULE_INTERFACE} の欄が足りません`;
  return { callables: names('callables'), opener: names('opener'), reads: names('reads'), writes: names('writes'), except, anyOutWithin: within.value };
}

/**
 * 口の外から届く欄か(fix27 差分点検 C27-3)。`private` と `#名前` は宣言したクラスの本文の中からしか届かない(継承の先からも
 * 届かない)ので外す。`protected` は継承の先(`class X extends 口 { … this.欄 … }`)から届くので、クラスを継承できる所 ——
 * 構築子を持つ型の静的な欄と、構築子が返すインスタンスの欄(`inherited`)—— ではたどる。構築子を名指せない所(関数が返した値)の
 * `protected` は継承の先を作れないので外から届かない。
 */
function isReachable(symbol: ts.Symbol, inherited: boolean): boolean {
  if (symbol.name.startsWith('__#')) return false;
  const flags = (symbol.declarations ?? []).reduce((all, declaration) => all | ts.getCombinedModifierFlags(declaration), ts.ModifierFlags.None);
  if ((flags & ts.ModifierFlags.Private) !== 0) return false;
  return inherited || (flags & ts.ModifierFlags.Protected) === 0;
}

/** 子の答えを、住所の 1 歩を前に付けて束ねる。 */
function merge(parts: readonly (readonly [string, Found])[]): Found {
  const raw = parts.find(([, found]) => found.raw !== undefined);
  const unread = parts.find(([, found]) => found.unread !== undefined);
  const excused = new Set(parts.flatMap(([, found]) => [...found.excused]));
  return {
    raw: raw === undefined ? undefined : `${raw[0]}${raw[1].raw ?? ''}`,
    unread: unread === undefined ? undefined : `${unread[0]}${unread[1].unread ?? ''}`,
    unreadCount: parts.reduce((sum, [, found]) => sum + found.unreadCount, 0),
    excused: excused.size === 0 ? NOTHING.excused : excused,
  };
}

/**
 * **型検査器で公開の口をたどる**(全部の多重定義の引数と戻り値・構築子・欄・添字。合併は割り、型の引数は制約で読み、`Promise` は解く)。
 * たどった先の各型を規則に掛け、上限の深さでまだ続く型(その奥に関数・構築子がある型)を「読み切れない」として返す(閉じる側に倒す。
 * 黙って通さない)。表の「読まなくてよい住所」の行の奥で読み切れなかったものだけは、その行が受ける(生の道は行の奥でも名指す)。
 *
 * 標準の型(TypeScript の lib と Node の実行時の型で宣言されたクラス・interface・関数。`Promise`・`Array`・`Response`・`fetch` など)は中身をたどらず、
 * 型引数だけをたどる(lib の中に生の道は無い。型引数の側に製品の型が入る)。答えは型・向き・行の中の位置ごとに覚え、循環は道の上の型の
 * 答えに任せる(循環の途中の型の答えは、循環の頭が読み終えるまで欠けるので覚えない)。1 つの入口の表に 1 つ作る。
 */
class SurfaceWalk {
  /** 鍵(型・向き・行の中の位置) → 読み終えた答えと、そのときの深さ(より浅く読んだ答えは、より深い所でもそのまま使える)。 */
  private readonly memo = new Map<string, { readonly found: Found; readonly depth: number }>();
  /** いまたどっている道の上の鍵 → 道の上の位置(循環の検出)。 */
  private readonly path = new Map<string, number>();
  /** 上限の深さで続く型か(奥の関数の有無)。 */
  private readonly continuing = new Map<ts.Type, boolean>();

  private readonly checker: ts.TypeChecker;
  private readonly program: ts.Program;
  private readonly rule: Rule;
  private readonly limit: number;
  private readonly rows: readonly string[];
  private readonly declarations: ReadonlySet<string>;
  private readonly packageDir: string;

  constructor(context: {
    readonly checker: ts.TypeChecker;
    readonly program: ts.Program;
    readonly rule: Rule;
    readonly limit: number;
    readonly rows: readonly string[];
    readonly declarations: ReadonlySet<string>;
    readonly packageDir: string;
  }) {
    this.checker = context.checker;
    this.program = context.program;
    this.rule = context.rule;
    this.limit = context.limit;
    this.rows = context.rows;
    this.declarations = context.declarations;
    this.packageDir = context.packageDir;
  }

  /** 口の型の答え(口が渡す `any` は口とその直下だけで数える。奥の答えは型ごとに覚えるので、深さに依る規則はここで足す)。 */
  surface(name: string, type: ts.Type): Found {
    const shallow = this.shallowAny(type, this.rule.anyOutWithin, '');
    const deep = this.visit(type, true, 0, this.advance(`p:`, name)).found;
    return merge([['', shallow === undefined ? NOTHING : { ...NOTHING, raw: shallow }], ['', deep]]);
  }

  /**
   * 行の中の位置を 1 歩進める(`''` = どの行の上でもない・`p:住所` = ある行の手前・`x:行` = 行の奥)。
   * 住所はたどる間は組み立てない(行の手前にいるときだけ持つ)ので、行の無い所の答えは住所に依らず使い回せる。
   */
  private advance(state: string, step: string): string {
    if (!state.startsWith('p:')) return state;
    const next = `${state.slice(2)}${step}`;
    if (this.rows.includes(next)) return `x:${next}`;
    return this.rows.some((row) => row.startsWith(next)) ? `p:${next}` : '';
  }

  /** 口が渡す `any` の住所(`within` 段まで。合併は割り、`Promise` は解く。引数へは進まない —— 受け取る `any` は数えない)。 */
  private shallowAny(type: ts.Type, within: number, address: string): string | undefined {
    if (isUnresolved(type)) return undefined; // 読めない型は奥の走査が「読み切れない」と名指す
    if ((type.flags & ts.TypeFlags.Any) !== 0) return address;
    if (type.isUnion()) return type.types.map((part) => this.shallowAny(part, within, address)).find((hit) => hit !== undefined);
    const promised = this.promised(type);
    if (promised !== undefined) return this.shallowAny(promised, within, address);
    if (within === 0 || (type.flags & LEAF_FLAGS) !== 0) return undefined;
    return this.children(type).filter(([, , flip]) => !flip).map(([step, child]) => this.shallowAny(child, within - 1, `${address}${step}`)).find((hit) => hit !== undefined);
  }

  /** 1 つの型をたどる(`low` は当たった循環の頭の位置。自分より上を指す答えは使い回さない)。 */
  private visit(type: ts.Type, out: boolean, depth: number, state: string): { readonly found: Found; readonly low: number } {
    const key = `${(type as { readonly id?: number }).id ?? this.checker.typeToString(type)}:${out ? 'out' : 'in'}:${state}`;
    const onPath = this.path.get(key);
    if (onPath !== undefined) return { found: NOTHING, low: onPath };
    const known = this.memo.get(key);
    if (known !== undefined && known.depth <= depth) return { found: known.found, low: NO_CYCLE };
    const position = this.path.size;
    this.path.set(key, position);
    const { found, low } = this.compute(type, out, depth, state);
    this.path.delete(key);
    if (low >= position) this.memo.set(key, { found, depth });
    return { found, low: low >= position ? NO_CYCLE : low };
  }

  private compute(type: ts.Type, out: boolean, depth: number, state: string): { readonly found: Found; readonly low: number } {
    if (isUnresolved(type) || this.isUnconstrainedConditional(type)) return { found: this.stopped(state), low: NO_CYCLE };
    // 口が渡す `any` は、どの段でも中身を型検査器が読めない値(生の接続層でもありうる)なので読み切れない(fix27 差分点検 C27-2)。
    // 浅い段の `any` は {@link surface} が生の道としても名指す。受け取る `any`(向きが in)は何も渡さないので数えない。
    if ((type.flags & ts.TypeFlags.Any) !== 0) return { found: out ? this.stopped(state) : NOTHING, low: NO_CYCLE };
    if ((type.flags & LEAF_FLAGS) !== 0) return { found: NOTHING, low: NO_CYCLE };
    const steps = this.steps(type, out, depth);
    let low = NO_CYCLE;
    const parts = steps.map(([step, child, childOut, childDepth, member]) => {
      const result = this.visit(child, childOut, childDepth, this.enter(this.advance(state, step), member));
      low = Math.min(low, result.low);
      return [step, result.found] as const;
    });
    const here: Found = this.isRawHere(type) ? { ...NOTHING, raw: '' } : NOTHING;
    const stop = steps.length === 0 && depth >= this.limit && this.continues(type) ? this.stopped(state) : NOTHING;
    return { found: merge([['', here], ['', stop], ...parts]), low };
  }

  /** ここで読み切れなかった答え(表の住所の行の奥ならその行が、宣言の行の中ならその行が受ける)。 */
  private stopped(state: string): Found {
    if (state.startsWith('x:')) return { ...NOTHING, excused: new Set([state.slice(2)]) };
    if (state.startsWith('d:')) return { ...NOTHING, excused: new Set([`${DECLARATION_MARK}${state.slice(2)}`]) };
    return { ...NOTHING, unread: '', unreadCount: 1 };
  }

  /**
   * 欄・添字・引数・戻り値の 1 歩が、表の宣言の行({@link UNREAD_DECLARATIONS_INTERFACE})の宣言の中に書かれた欄なら、その奥を行が受ける状態
   * (`d:鍵`)に入る。住所の行の奥(`x:`)・既に宣言の行の中(`d:`)なら、そのまま。宣言の鍵は置き場(パッケージとファイル)と名前で、
   * 同じ名前の別の宣言を受けない({@link declarationKeyOf})。
   */
  private enter(state: string, member: ts.Node | undefined): string {
    if (member === undefined || this.declarations.size === 0 || state.startsWith('x:') || state.startsWith('d:')) return state;
    const key = declarationKeyOf(member, this.packageDir);
    return key !== undefined && this.declarations.has(key) ? `d:${key}` : state;
  }

  /** 1 歩先(住所の 1 歩・型・向き・深さ)。合併・制約・`Promise` は段に数えない。上限の深さでは先へ進まない。 */
  private steps(type: ts.Type, out: boolean, depth: number): (readonly [string, ts.Type, boolean, number, ts.Node | undefined])[] {
    if (type.isUnion()) return type.types.map((part) => ['', part, out, depth, undefined] as const);
    if ((type.flags & ts.TypeFlags.Instantiable) !== 0) {
      const constraint = this.checker.getBaseConstraintOfType(type);
      return constraint === undefined || constraint === type ? [] : [['', constraint, out, depth, undefined]];
    }
    const promised = this.promised(type);
    if (promised !== undefined) return [['', promised, out, depth, undefined]];
    if (depth >= this.limit) return [];
    const library = this.libraryArguments(type);
    if (library !== undefined) return library.map((argument, index) => [`<${index}>`, argument, out, depth + 1, undefined] as const);
    return this.children(type).map(([step, child, flip, member]) => [step, child, flip ? !out : out, depth + 1, member] as const);
  }

  /**
   * 型検査器が制約の上限を解けない条件型か(制約が循環する `G<T> = T extends string ? G<T> : G<T>` など。fix27 差分点検 C27-4 の続き)。
   * 条件型は枝を制約の上限で読むので、上限が無いと枝の中身(生の型でもありうる)を 1 つも読めない。解けない型と同じく読み切れない
   * (閉じる側。表の明示の行だけが受ける)。制約の無い型の引数 `T` と、その添字 `T[K]` は呼び手が渡す型なので、ここには入れない。
   */
  private isUnconstrainedConditional(type: ts.Type): boolean {
    if ((type.flags & ts.TypeFlags.Conditional) === 0) return false;
    const constraint = this.checker.getBaseConstraintOfType(type);
    return constraint === undefined || constraint === type;
  }

  /** その型そのものが生の道か(規則に掛ける)。 */
  private isRawHere(type: ts.Type): boolean {
    if (this.hasBrand(type)) return false;
    const callable = (name: string): ts.Type | undefined => {
      const symbol = this.checker.getPropertyOfType(type, name);
      const member = symbol === undefined ? undefined : this.checker.getNonNullableType(this.checker.getTypeOfSymbol(symbol));
      return member !== undefined && member.getCallSignatures().length > 0 ? member : undefined;
    };
    if ([...this.rule.callables].some((name) => callable(name) !== undefined)) return true;
    return [...this.rule.opener].some((name) => (callable(name)?.getCallSignatures() ?? []).some((signature) => this.isWriteBuilder(signature.getReturnType())));
  }

  /**
   * 例外の型の印(`Retried` の欄の全部)を、同じ宣言の欄として持つか。代入の可否は問わない(型検査器の代入の判定は巨大なベンダーの型で
   * 底を抜ける)。印の欄の名前は一意の symbol なので、同じ宣言を持つ欄はこのパッケージの印だけである。
   */
  private hasBrand(type: ts.Type): boolean {
    const brands = this.checker.getPropertiesOfType(this.rule.except);
    return brands.length > 0 && brands.every((brand) => {
      const own = this.checker.getPropertiesOfType(type).find((property) => property.escapedName === brand.escapedName);
      return own !== undefined && (own.declarations ?? []).some((declaration) => (brand.declarations ?? []).includes(declaration));
    });
  }

  /** 問い合わせの組み立てで、読み取りと書き換えを両方持つか(合併は 1 つでも当たれば当たる)。 */
  private isWriteBuilder(type: ts.Type): boolean {
    const target = this.promised(type) ?? type;
    const parts = target.isUnion() ? target.types : [target];
    return parts.some((part) => {
      const has = (names: ReadonlySet<string>): boolean => [...names].some((name) => this.checker.getPropertyOfType(this.checker.getApparentType(part), name) !== undefined);
      return has(this.rule.reads) && has(this.rule.writes);
    });
  }

  /** 標準の `Promise` / `PromiseLike` なら、解いた中身(段に数えない。型検査器の `getAwaitedType` は再帰の型で底を抜けるので使わない)。 */
  private promised(type: ts.Type): ts.Type | undefined {
    const name = type.getSymbol()?.name;
    if (name !== 'Promise' && name !== 'PromiseLike') return undefined;
    const [inner] = this.libraryArguments(type) ?? [];
    return inner;
  }

  /**
   * 標準の型の宣言のファイルか: TypeScript の lib と、Node の実行時の型(`@types/node` と、それが `fetch` などに使う `undici-types`)。
   * 照らしの道具自身が Node の型を読む(この照らしのファイルの `reference types="node"`)ので、`fetch`・`AbortSignal`・`Error` は lib と
   * Node の型の両方に宣言を持つ。Node の型を標準に数えないと、標準の型の奥(DOM のイベントの口の戻りの `any` など)を口の約束として読んでしまう。
   */
  private isStandardFile(file: ts.SourceFile): boolean {
    return this.program.isSourceFileDefaultLibrary(file) || NODE_RUNTIME_TYPES.test(file.fileName);
  }

  /** 標準の型なら、たどる型引数(標準の型でなければ undefined)。 */
  private libraryArguments(type: ts.Type): readonly ts.Type[] | undefined {
    const symbol = type.getSymbol();
    const declarations = symbol?.declarations ?? [];
    if (symbol === undefined || declarations.length === 0 || (symbol.flags & ts.SymbolFlags.TypeLiteral) !== 0) return undefined;
    if (!declarations.every((declaration) => this.isStandardFile(declaration.getSourceFile()))) return undefined;
    const objectFlags = (type.flags & ts.TypeFlags.Object) !== 0 ? (type as ts.ObjectType).objectFlags : 0;
    return (objectFlags & ts.ObjectFlags.Reference) !== 0 ? this.checker.getTypeArguments(type as ts.TypeReference) : [];
  }

  /**
   * 1 段下の子(住所の 1 歩・子の型・向きを入れ替えるか)。多重定義は全部(2 本以上なら `@番号` で住所を分ける)。
   * 構築子を持つ型(クラス)は、静的な欄と、構築子が返すインスタンスの `protected` の欄もたどる(継承の先から届く。{@link isReachable})。
   * インスタンスの `protected` の欄は `new()` の戻りの 1 歩と欄の 1 歩を 1 段にまとめる(段を少なく数えるのは、奥まで読む側)。
   */
  private children(type: ts.Type): (readonly [string, ts.Type, boolean, ts.Node | undefined])[] {
    const steps: (readonly [string, ts.Type, boolean, ts.Node | undefined])[] = [];
    const constructs = type.getConstructSignatures();
    for (const [prefix, signatures] of [['', type.getCallSignatures()], ['new', constructs]] as const) {
      signatures.forEach((signature, index) => {
        const head = `${prefix}${signatures.length > 1 ? `@${index + 1}` : ''}`;
        const declared = signature.getDeclaration() as ts.Node | undefined;
        signature.getParameters().forEach((parameter, position) => steps.push([`${head}(${position})`, this.checker.getTypeOfSymbol(parameter), true, declared]));
        const instance = signature.getReturnType();
        steps.push([`${head}()`, instance, false, declared]);
        if (prefix !== 'new') return;
        for (const property of this.checker.getPropertiesOfType(instance)) {
          if (isReachable(property, true) && !isReachable(property, false)) steps.push([`${head}().${property.name}`, this.checker.getTypeOfSymbol(property), false, property.declarations?.[0]]);
        }
      });
    }
    for (const property of this.checker.getPropertiesOfType(type)) if (isReachable(property, constructs.length > 0)) steps.push([`.${property.name}`, this.checker.getTypeOfSymbol(property), false, property.declarations?.[0]]);
    for (const info of this.checker.getIndexInfosOfType(type)) steps.push(['[]', info.type, false, info.declaration]);
    return steps;
  }

  /**
   * 上限の深さで、まだ続く型か: その奥のどこかに関数・構築子がある(欄・添字・型引数・合併・制約をたどる。循環は 1 回だけ見る)。
   * 値だけの型(`Json` の循環など)は続かない。奥を全部たどるのは関数があるかだけで、住所も向きも持たないので、口の答えより軽い。
   */
  private continues(root: ts.Type): boolean {
    const known = this.continuing.get(root);
    if (known !== undefined) return known;
    const seen = new Set<ts.Type>([root]);
    const queue: ts.Type[] = [root];
    let found = false;
    for (let type = queue.pop(); type !== undefined && !found; type = queue.pop()) {
      const next = this.inner(type);
      if (next === undefined) found = true;
      else for (const child of next) if (!seen.has(child)) { seen.add(child); queue.push(child); }
    }
    this.continuing.set(root, found);
    return found;
  }

  /** 関数があるかを調べるための、1 段下の型(その型が関数・構築子なら undefined)。 */
  private inner(type: ts.Type): readonly ts.Type[] | undefined {
    if (isUnresolved(type) || this.isUnconstrainedConditional(type)) return undefined;
    if ((type.flags & (ts.TypeFlags.Any | LEAF_FLAGS)) !== 0) return [];
    if (type.isUnion()) return type.types;
    if ((type.flags & ts.TypeFlags.Instantiable) !== 0) {
      const constraint = this.checker.getBaseConstraintOfType(type);
      return constraint === undefined || constraint === type ? [] : [constraint];
    }
    const library = this.libraryArguments(type);
    if (library !== undefined) return library;
    if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return undefined;
    return this.children(type).map(([, child]) => child);
  }
}

/** 表の「読まなくてよい住所」の行(入口 → 住所 → 理由)。行の形の誤りは食い違いの文に入れる。 */
function unreadRowsOf(checker: ts.TypeChecker, table: ts.SourceFile, problems: string[]): ReadonlyMap<string, readonly string[]> {
  const declaration = table.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === UNREAD_INTERFACE);
  const rows = new Map<string, string[]>();
  for (const member of declaration?.members ?? []) {
    const entry = memberName(member) ?? '?';
    if (!ts.isPropertySignature(member) || member.type === undefined || !ts.isTypeLiteralNode(member.type)) {
      problems.push(`${UNREAD_INTERFACE} の ${entry} は { 住所: '理由' } の形で書く`);
      continue;
    }
    const addresses: string[] = [];
    for (const row of member.type.members) {
      const address = memberName(row) ?? '?';
      const reason = ts.isPropertySignature(row) && row.type !== undefined ? checker.getTypeAtLocation(row.type) : undefined;
      if (reason === undefined || !reason.isStringLiteral() || reason.value.trim().length < 10) problems.push(`${entry}: 読まなくてよい住所 ${address} に理由(10 文字以上の文字列)が無い`);
      else addresses.push(address);
    }
    rows.set(entry, addresses);
  }
  return rows;
}

/**
 * 口の宣言そのものの型(型引数を当てる前。fix27 差分点検 C27-4)。値の口は値の型(型引数を持つ関数・クラスは型の引数のまま)、
 * 型の口は宣言した型(型の別名・interface の型の引数のまま)。型の引数は走査が**制約の上限**で読むので、表が書いた型引数の 1 点では
 * 通らない枝(`T extends 1 ? 生の型 : 無害な型` の生の枝など)も照らす。表の書いた型引数の型も別に照らす(具体の形で外れることを見る)。
 */
function declaredTypeOf(checker: ts.TypeChecker, exported: ts.Symbol): ts.Type {
  const symbol = resolved(checker, exported);
  return (symbol.flags & ts.SymbolFlags.Value) !== 0 ? checker.getTypeOfSymbol(symbol) : checker.getDeclaredTypeOfSymbol(symbol);
}

/** 表の「読まなくてよい宣言」の行(宣言の鍵の集合)。理由の短い行・鍵の形の崩れた行は食い違いの文に入れる。 */
function unreadDeclarationsOf(checker: ts.TypeChecker, table: ts.SourceFile, problems: string[]): ReadonlySet<string> {
  const declaration = table.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === UNREAD_DECLARATIONS_INTERFACE);
  const keys = new Set<string>();
  for (const row of declaration?.members ?? []) {
    const key = memberName(row) ?? '?';
    const reason = ts.isPropertySignature(row) && row.type !== undefined ? checker.getTypeAtLocation(row.type) : undefined;
    if (!/^.+#[^#]+$/.test(key)) problems.push(`${UNREAD_DECLARATIONS_INTERFACE} の ${key} は「置き場#名前」の形で書く`);
    else if (reason === undefined || !reason.isStringLiteral() || reason.value.trim().length < 10) problems.push(`${UNREAD_DECLARATIONS_INTERFACE}: 読まなくてよい宣言 ${key} に理由(10 文字以上の文字列)が無い`);
    else keys.add(key);
  }
  return keys;
}

/** 1 つの入口の、表の全部の口をたどった食い違い(生の道・読み切れない住所・当たらない行)。口ごとに、表の型と宣言の型の両方をたどる。 */
function walkProblems(entry: string, surface: ReadonlyMap<string, readonly ts.Type[]>, walk: SurfaceWalk, rows: readonly string[], limit: number, used: Set<string>): string[] {
  const problems: string[] = [];
  for (const [name, types] of surface) {
    const answers = [...new Set(types)].map((type) => walk.surface(name, type));
    // のべの数は、2 つの型が同じ奥を通ると重なるので多い方をとる(目安の数)。
    const found = { ...merge(answers.map((answer) => ['', answer] as const)), unreadCount: Math.max(0, ...answers.map((answer) => answer.unreadCount)) };
    if (found.raw !== undefined) problems.push(`${entry}: 口 ${name} が生の道(rpc・schema・from の書き込み)に届く(${name}${found.raw})`);
    if (found.unread !== undefined) problems.push(`${entry}: 口 ${name} は ${limit} 段で読み切れない(${name}${found.unread} ほか、のべ ${found.unreadCount} か所。読まなくてよいなら ${UNREAD_INTERFACE} に理由つきの行が要る)`);
    for (const row of found.excused) used.add(row.startsWith(DECLARATION_MARK) ? row : `${entry}\u0000${row}`);
  }
  for (const row of rows) if (!used.has(`${entry}\u0000${row}`)) problems.push(`${entry}: 読まなくてよい住所 ${row} に当たる読み切れない住所が無い`);
  return problems;
}

/**
 * adapter の公開の口を閉じた表と照らし、生の道に届く口を名指す。
 *
 * @param input - adapter の根と、表のファイル・差し替え
 * @returns 食い違いと生の道(空なら閉じている)
 */
export function closedSurfaceProblems(input: SurfaceInput): string[] {
  const files = input.files ?? {};
  const tableFile = input.tableFile ?? join(input.packageDir, SURFACE_TABLE);
  if (!reader(files).exists(tableFile)) return [`閉じた表 ${tableFile} がありません`];
  const entries = entriesOf(input.packageDir, files);
  const program = programOf([tableFile, RAW_RULE_FILE], compilerOptionsOf(input.packageDir, files), files);
  const checker = program.getTypeChecker();
  const table = program.getSourceFile(tableFile);
  if (table === undefined) return ['表を読めません'];
  const rule = ruleOf(checker, program.getSourceFile(RAW_RULE_FILE));
  if (typeof rule === 'string') return [rule];
  const problems = [...program.getSyntacticDiagnostics(table), ...program.getSemanticDiagnostics(table)].map(describe);
  const surface = table.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === SURFACE_INTERFACE);
  if (surface === undefined) return [...problems, `表に export interface ${SURFACE_INTERFACE} がありません`];
  const limit = input.depthLimit ?? SURFACE_DEPTH_LIMIT;
  const unread = unreadRowsOf(checker, table, problems);
  const declarations = unreadDeclarationsOf(checker, table, problems);
  const used = new Set<string>();
  const listed = new Map(surface.members.map((member) => [memberName(member) ?? '?', member]));
  problems.push(...oneSided('入口', entries.keys, [...listed.keys()]), ...entries.problems);
  for (const [entry, source] of entries.sources) {
    const member = listed.get(entry);
    const file = program.getSourceFile(source);
    const module = file === undefined ? undefined : checker.getSymbolAtLocation(file);
    if (member === undefined || module === undefined) {
      if (member !== undefined) problems.push(`${entry}: 表が入口のモジュールを読んでいない`);
      continue;
    }
    if (!ts.isPropertySignature(member) || member.type === undefined || !ts.isTypeLiteralNode(member.type)) {
      problems.push(`${entry}: 表の入口の欄は { 口: 型 } の形で書く`);
      continue;
    }
    const exported = new Map(checker.getExportsOfModule(module).map((symbol) => [symbol.name, symbol]));
    const rows = new Map(member.type.members.map((row) => [memberName(row) ?? '?', row]));
    problems.push(...oneSided(entry, [...exported.keys()], [...rows.keys()]));
    for (const [name, row] of rows) {
      const symbol = exported.get(name);
      if (symbol !== undefined && ts.isPropertySignature(row)) problems.push(...memberProblems(checker, entry, module, row, symbol));
    }
    const types = new Map(member.type.members.flatMap((row) => {
      if (!ts.isPropertySignature(row) || row.type === undefined) return [];
      const name = memberName(row) ?? '?';
      const symbol = exported.get(name);
      return [[name, [checker.getTypeAtLocation(row.type), ...(symbol === undefined ? [] : [declaredTypeOf(checker, symbol)])]] as const];
    }));
    const rowsOfEntry = unread.get(entry) ?? [];
    const walk = new SurfaceWalk({ checker, program, rule, limit, rows: rowsOfEntry, declarations, packageDir: input.packageDir });
    problems.push(...walkProblems(entry, types, walk, rowsOfEntry, limit, used));
  }
  for (const key of declarations) if (!used.has(`${DECLARATION_MARK}${key}`)) problems.push(`${UNREAD_DECLARATIONS_INTERFACE}: 読まなくてよい宣言 ${key} に当たる読み切れない所が無い`);
  for (const entry of unread.keys()) if (!entries.sources.has(entry)) problems.push(`${UNREAD_INTERFACE} の ${entry} は入口に無い`);
  return problems;
}

/** `@ts-expect-error` の行(番号つき)。 */
const DIRECTIVE = /^(\s*)\/\/\s*@ts-expect-error\b(.*)$/;

/** 理由の頭の誤りの番号。 */
const CODE = /^\s*TS(\d+)\b/;

/**
 * 探りのファイルの `@ts-expect-error` を外して型検査し、各行が書いた番号の誤り**だけ**で落ちることを照らす。
 *
 * 書き方: `// @ts-expect-error TS2339 理由` の次の行が、TS2339 の誤りを 1 つ以上持ち、ほかの番号の誤りを持たない。
 * 番号の無い `@ts-expect-error`・誤りの無い行・印の無い行の誤りは、全部食い違いとして返す。
 *
 * @param input - adapter の根(型検査の設定)と、探りのファイル・差し替え
 * @param input.packageDir - adapter の根
 * @param input.file - 探りのファイル
 * @param input.files - 中身の差し替え
 * @returns 食い違い(空なら書いた番号のとおり)
 */
export function expectedErrorProblems(input: { readonly packageDir: string; readonly file: string; readonly files?: FileOverlay }): string[] {
  const files = input.files ?? {};
  const text = reader(files).read(input.file);
  if (text === undefined) return [`探り ${input.file} がありません`];
  const problems: string[] = [];
  const expected = new Map<number, number>();
  const lines = text.split('\n').map((line, index) => {
    const directive = DIRECTIVE.exec(line);
    if (directive === null) return line;
    const code = CODE.exec(directive[2] ?? '');
    if (code === null) problems.push(`${basename(input.file)}:${index + 1} の @ts-expect-error に誤りの番号(TSxxxx)が無い`);
    else expected.set(index + 1, Number(code[1]));
    return `${directive[1] ?? ''}// (外した印)${directive[2] ?? ''}`;
  });
  if (expected.size === 0) problems.push(`${basename(input.file)} に番号つきの @ts-expect-error が 1 つも無い`);
  const program = programOf([input.file], compilerOptionsOf(input.packageDir, files), { ...files, [input.file]: lines.join('\n') });
  const file = program.getSourceFile(input.file);
  if (file === undefined) return [...problems, '探りを読めません'];
  const byLine = new Map<number, number[]>();
  for (const diagnostic of [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]) {
    const line = diagnostic.start === undefined ? 0 : file.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
    if (!expected.has(line - 1)) problems.push(`印の無い行の誤り: ${describe(diagnostic)}`);
    else byLine.set(line, [...(byLine.get(line) ?? []), diagnostic.code]);
  }
  for (const [directiveLine, code] of expected) {
    const codes = byLine.get(directiveLine + 1) ?? [];
    if (!codes.includes(code)) problems.push(`${basename(input.file)}:${directiveLine} は TS${code} で落ちない(実際: ${codes.length === 0 ? '誤り無し' : codes.map((c) => `TS${c}`).join(', ')})`);
    const others = codes.filter((c) => c !== code);
    if (others.length > 0 && codes.includes(code)) problems.push(`${basename(input.file)}:${directiveLine} は TS${code} のほかに ${others.map((c) => `TS${c}`).join(', ')} でも落ちる`);
  }
  return problems;
}

/**
 * adapter が自分の表の試験から呼ぶ入口: 表の置き場(`import.meta.url`)から adapter の根を決め、閉じた表と探り(あれば)を照らす。
 *
 * @param tableUrl - 表の試験の `import.meta.url`({@link SURFACE_TABLE} に置く)
 * @returns 食い違いと生の道(空なら閉じている)
 */
export function ownSurfaceProblems(tableUrl: string): string[] {
  const tableFile = fileURLToPath(tableUrl);
  const packageDir = join(dirname(tableFile), '../..');
  if (join(packageDir, SURFACE_TABLE) !== tableFile) return [`表は ${SURFACE_TABLE} に置く(今は ${tableFile})`];
  const probe = join(packageDir, SURFACE_PROBE);
  return [...closedSurfaceProblems({ packageDir }), ...(existsSync(probe) ? expectedErrorProblems({ packageDir, file: probe }) : [])];
}
