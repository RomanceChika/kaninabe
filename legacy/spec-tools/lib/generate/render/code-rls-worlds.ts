/**
 * access_spec の `reads` + data_table → **RLS の挙動テストが置く world の設計図**
 * (`app/src/domain/generated/rls-worlds.ts`)の生成器(束 ⑳-4b)。
 *
 * ⑳-4a でポリシーの本文が生成物になり、`policy-parity` が実 DB と**意味で**突き合わせるように
 * なった。それでも残る穴は 1 つある —— **述語の翻訳そのものが間違っていれば、生成物と実 DB は
 * 仲良く同じ間違いをする**。そこで「宣言どおりの行集合が返るか」を実 DB で確かめる。
 *
 * この生成器が出すのは**world**(何人の実行者を作り、どの行を誰に束縛して置くか)と、
 * **オラクルが期待を計算するのに要る宣言**(ロールの根拠と読み取り規則)である。期待そのものは
 * 実行する側の TS(`@kaninabe/runtime/testing/rls/oracle`)が計算する —— SQL の述語を組み立てる `rls-predicate.ts` を
 * 呼ばない別の写像であることが、この束の要点である。
 *
 * world を宣言から作れない表は**ここに出さない**(同じ判定を T8 が warning にする)。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { RlsWorld, RlsWorldRole } from '@kaninabe/runtime/testing/rls/types';
import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { rlsWorldCatalog, rlsWorldRoles } from '../../world/index.js';
import { findAccessSpec, findEntitySpec } from '../../semantics/domain-lookup.js';
import { generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';
import { RUNTIME_TESTING_RLS_TYPES_MODULE } from './runtime-modules.js';

/** 設計図の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'rls-worlds.ts');


/**
 * 設計図の型の**再輸出**(形の正はハーネスが 1 か所で持つ。束 ①-d 手 2)。
 *
 * 値はこの生成物が書き出し、形は実行時パッケージのハーネス(`@kaninabe/runtime/testing/rls/types`)が
 * 持つ —— 2 か所で宣言していたあいだ、片方だけを直した日に黙って食い違う形が残っていた。
 * 実行する側(生成テスト・アダプタ・見張りテスト)は今までどおりこの生成物から型を引ける。
 */
const TYPE_REEXPORT: readonly string[] = [
  'export type {',
  '  RlsValue,',
  '  RlsWorld,',
  '  RlsWorldActor,',
  '  RlsWorldBinding,',
  '  RlsWorldRead,',
  '  RlsWorldRole,',
  '  RlsWorldRow,',
  `} from '${RUNTIME_TESTING_RLS_TYPES_MODULE}';`,
];

/** 全 data_table の RLS から world の設計図を生成するジェネレーター。 */
export const rlsWorldsGenerator: DocGenerator = {
  id: 'code-rls-worlds',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const entries = rlsWorldCatalog(model, ctx.dataTables);
    if (entries.length === 0) return [];
    // **組み立ての場所でハーネスの型に縛る**(`RlsWorld` / `RlsWorldRole` はハーネスが持つ形)。
    // 導出側の型の欄を変えると、生成物の `satisfies` まで待たずここが型エラーになる。
    const worlds: Record<string, RlsWorld> = {};
    for (const entry of entries) {
      if (entry.result.ok) worlds[entry.table.table] = entry.result.world;
    }
    const roles: readonly RlsWorldRole[] = rlsWorldRoles(model);
    return [
      {
        file: outputFile(ctx.roots),
        content: renderFile(worlds, roles, specFilesOf(model, entries)),
        wholeFile: true,
      },
    ];
  },
};

/** その設計図の正になる仕様ファイル。 */
function specFilesOf(model: SpecModel, entries: ReturnType<typeof rlsWorldCatalog>): readonly string[] {
  const files = new Set<string>([model.roles.location.file]);
  for (const entry of entries) {
    if (!entry.result.ok) continue;
    files.add(entry.table.location.file);
    const access = findAccessSpec(model, entry.table.entity ?? '');
    const entity = findEntitySpec(model, entry.table.entity ?? '');
    if (access !== null) files.add(access.location.file);
    if (entity !== null) files.add(entity.location.file);
  }
  return [...files].sort();
}

/** 設計図のファイル全体。 */
function renderFile(
  worlds: Readonly<Record<string, RlsWorld>>,
  roles: readonly RlsWorldRole[],
  specFiles: readonly string[],
): string {
  return [
    generatedHeader(specFiles),
    '',
    // 形はハーネスが持つ(束 ①-d 手 2)。値を書くのに要る型だけを名前で引き、残りは再輸出する。
    `import type { RlsWorld, RlsWorldRole } from '${RUNTIME_TESTING_RLS_TYPES_MODULE}';`,
    '',
    ...TYPE_REEXPORT,
    '',
    docComment([
      'ロールの根拠の全数(宣言順)。',
      '',
      'オラクルはこの表だけを見て「この実行者はこのロールで立つか」を決める —— 未ログインか /',
      '実行者の集約に行があれば立つか / 実行者自身の行のどの欄が根拠か / 対象の行のどの集約の',
      'どの列を実行者と比べるか / 何を含意するか。SQL の述語は 1 行も読まない。',
      '',
      '`grant select` の宛先(権限そのものの有無)もオラクルがこの表と `reads` から導く ——',
      'ポリシーの計画(翻訳器)から渡すと、刈り込みの間違いを期待と生成 SQL が共有してしまう。',
    ]),
    `export const rlsRoles = ${renderLiteral(roles)} as const satisfies readonly RlsWorldRole[];`,
    '',
    docComment([
      '表ごとの world の設計図(world を宣言から作れる表だけ)。',
      '',
      '1 表につき「ポリシーに現れるロールごとの実行者 + 既定のログイン実行者(他人) + 未ログイン」を',
      '作り、実行者ごとに 1 系統の行を置く。系統の中では集約ごとに 1 行だけを共有する —— 参照を',
      '別々に作ると、行内比較の不変条件(「この行の親は、その行の親と同じ」)が必ず落ちる。',
      '',
      '**可視性に状態の条件(reads[].when)がある表では、系統ごとに「その条件を偽にする状態の行」',
      'をもう 1 つ置く**(束 §14)。反例の行が無い world では、ポリシーから条件を落としても検査が',
      '通ってしまう —— 境界(filters)にもう 1 人の実行者を足したのと同じ理由である。',
      '',
      '**ここに無い表は、world を宣言から作れないと判定された表である**(執行点の条件が DSL 外・',
      '数の上限・状態依存・トリガが参照先を決める)。理由は verify の T8 が報告する。',
    ]),
    `export const rlsWorlds = ${renderLiteral(worlds)} as const satisfies Readonly<Record<string, RlsWorld>>;`,
    '',
    docComment(['挙動テストを生成した表の全数(表名順)。']),
    'export const rlsWorldTables: readonly string[] = Object.keys(rlsWorlds);',
    '',
  ].join('\n');
}
