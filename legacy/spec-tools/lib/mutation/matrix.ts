/**
 * 変異 × 検査の**対応表**を実測する(束 ⑳-5c)。
 *
 * やることは 1 つである: 変異の前のモデルで全検査の指紋を取り、変異のあとでもう一度取って、
 * **違った検査を「捕った」と数える**。
 *
 * ここは免除リストを持たない。**件数の上限も持たない** —— 「1 変異器あたり先頭 N 件だけ実行する」は
 * 一見ただの手加減だが、実際には**残りを黙って見ないことにする免除リスト**として働く
 * (束 ⑳-5c は上限 2 で「穴 0 件」を出し、上限を外すと 202 件中 6 件の穴が出た)。壊せる場所は
 * 全部実行する。重ければ並列化で解き、件数で解かない。
 *
 * **捕る検査が 1 つも無い変異は、そのまま「検査の漏れ」として出る** —— 受け入れる口を作らないのは、
 * 穴が見つかったときの出口が「検査を直す」だけになるようにするためである(ユーザー原則)。
 * 捕られなかった変異は 3 つに分かれる。どの分け方も**機械が宣言と検査器から読む**のであり、
 * 書き足せる台帳はどこにも無い(exemptions.ts)。
 *
 * | 分類 | 意味 |
 * |---|---|
 * | 宣言された例外 | 仕様が「本文は手で持つ」と理由つきで宣言し、見張りテストの宣言が見張っている(`runner` / `handwritten`) |
 * | 報告された漏れ | 執行点が無いことを**検査器が warning で報告している**(A18)。警告は消えない |
 * | **検査の漏れ** | どちらでもない —— 誰も気づかず、どこにも出ない |
 *
 * 直す出口はいつも 1 つで、**検査か仕様を直す**ことだけである。
 *
 * 指紋を取る途中で例外が飛んだ場合(生成器が前提の破れで止まる等)は、その旨を指紋にする ——
 * **止まったこと自体が「捕った」**である(黙って同じ指紋にすると、止まる変異が穴に見える)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import { eqCatalog } from '../world/index.js';
import { ALL_MUTATION_DETECTORS } from './detectors.js';
import { ALL_MUTATION_OPERATORS } from './operators.js';
import { exemptionOf, namedHoleOf } from './exemptions.js';
import type { MutationReport, MutationRow } from '../kernel/mutation-report.js';
import { MUTATION_SCOPE, UNMUTATED_DECLARATIONS } from './scope.js';
import type { MutationDetector, MutationSubject } from './types.js';

/** 題材 1 つを組み立てるのに要るもの(`catalog` だけはここで組む)。 */
export type MutationSubjectInput = Omit<MutationSubject, 'catalog'>;

/**
 * 題材 1 つの材料を組み立てる(一致の証明の軸を**変異前**で 1 度だけ作る)。
 *
 * @param input 題材の名前・変異前のモデル・他の仕様種・生成器の文脈
 * @returns 変異テストに渡す材料
 */
export function mutationSubjectOf(input: MutationSubjectInput): MutationSubject {
  return {
    ...input,
    catalog: eqCatalog({
      domain: input.model,
      guards: input.guards,
      actions: input.actions,
      dataTables: input.dataTables,
      jobs: input.jobs,
    }),
  };
}

/**
 * 題材 1 つについて、**壊せる場所すべて** × 全検査を実測する。
 *
 * @param subject 題材の材料
 * @returns 変異 1 件ごとの行(捕った検査の ID と、捕られなかった行の分類)
 */
export function mutationRows(subject: MutationSubject): readonly MutationRow[] {
  const before = new Map(
    ALL_MUTATION_DETECTORS.map((detector) => [detector.id, fingerprintOf(detector, subject.model, subject)]),
  );
  const rows: MutationRow[] = [];
  for (const operator of ALL_MUTATION_OPERATORS) {
    for (const mutant of operator.mutate(subject.model)) {
      const caughtBy = ALL_MUTATION_DETECTORS.filter(
        (detector) => fingerprintOf(detector, mutant.model, subject) !== before.get(detector.id),
      ).map((detector) => detector.id);
      const exemption = caughtBy.length > 0 ? undefined : exemptionOf(mutant.site, subject);
      const named = caughtBy.length > 0 || exemption !== undefined ? undefined : namedHoleOf(mutant.site, subject);
      rows.push({
        subject: subject.name,
        operator: operator.id,
        at: mutant.at,
        caughtBy,
        ...(exemption === undefined ? {} : { exemption }),
        ...(named === undefined ? {} : { named }),
      });
    }
  }
  return rows;
}

/**
 * その題材で「壊せる場所が 1 つも無かった」変異器の ID。
 *
 * 対応表で「捕られなかった」と区別するために要る —— 壊せなかったのは検査の漏れではない。
 *
 * @param model 変異前のモデル
 * @returns 変異を 1 件も作れなかった変異器の ID
 */
export function operatorsWithoutSite(model: SpecModel): readonly string[] {
  return ALL_MUTATION_OPERATORS.filter((operator) => operator.mutate(model).length === 0).map(
    (operator) => operator.id,
  );
}

/**
 * 題材 1 つの実測を、**人向けの本へ渡すデータ**にまとめる。
 *
 * 本(保証の章)は変異を自分で回さず、組み立ての根(`context-report.ts` の `mutationReportOfContext` を
 * CLI と通し実行が `completeGenerateContext` へ渡す)がここを 1 度呼んで `GenerateContext.mutation` に載せる。表の行・列の並び(変異器と検査の全数)もデータで運ぶ ——
 * 本が `detectors.ts`(生成器を呼ぶ)を import せずに済む。
 *
 * @param subject 題材の材料
 * @returns 実測の結果と、表を組むのに要る変異器・検査の表示用の情報
 */
export function mutationReportOf(subject: MutationSubject): MutationReport {
  return {
    rows: mutationRows(subject),
    operators: ALL_MUTATION_OPERATORS.map((operator) => ({
      id: operator.id,
      title: operator.title,
      breaks: operator.breaks,
    })),
    detectors: ALL_MUTATION_DETECTORS.map((detector) => ({ id: detector.id, title: detector.title })),
    withoutSite: operatorsWithoutSite(subject.model),
    scope: MUTATION_SCOPE,
    unmutated: UNMUTATED_DECLARATIONS,
  };
}

/** 指紋を取る(例外は指紋に畳む —— 止まったことも「捕った」である)。 */
function fingerprintOf(detector: MutationDetector, model: SpecModel, subject: MutationSubject): string {
  try {
    return detector.fingerprint(model, subject);
  } catch (error) {
    return `error:${error instanceof Error ? error.message : String(error)}`;
  }
}
