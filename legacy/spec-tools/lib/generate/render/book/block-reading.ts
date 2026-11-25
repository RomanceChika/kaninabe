/**
 * ブロックごとの**読む量**(必読 = 公理 + 受け入れ / 今回変わった / 受け入れの内訳)。
 *
 * ブロック = 章の 1 節 × 仕様ファイル 1 枚(`chapter-files.ts` の `blockOf`)。標識と判断ポイントを数える
 * 単位(`block-loads.ts`)と同じ単位で、**仕様ファイル 1 枚を 1 回だけ数える**(章をまたいで二重に数えない)。
 * 公理・受け入れの分類は `semantics/reading-class.ts`、受け入れの導出は `semantics/reading-load.ts`、
 * 警告の配り方は `finding-placement.ts`、公理の側の差分の型は `semantics/reading-change.ts` が正である。
 *
 * 数の出どころは 4 つで、章の頭の数(従属を畳んだ範囲)とは単位が違う:
 *
 * - 公理 … 不変条件の言明・アクセスの宣言・状態の意味・要約の文・計算の例の表の行、通知・ジョブ・画面・認証・設定・保証の宣言(`axiomsByFile`)
 * - 理由つき … 手書き・定型外・確認の上書きとリント・タスクの受け入れ
 * - まだ通していない … 検証器の警告(場所のファイル)。検証の結果が渡されていなければ null
 * - 変更 … 基点つきのときの公理の側の差分。基点なしは null(0 とは別)
 *
 * 純粋関数だけ。
 */

import type { Finding } from '../../../kernel/finding.js';
import { systemRoleId } from '../../../model/role-hierarchy.js';
import type { SpecModel } from '../../../model/types.js';
import { computeExampleOpOf, computeExampleSets } from '../../../semantics/compute-examples.js';
import { accessTable, accessUnits, stateMeanings } from '../../../semantics/reading-axioms.js';
import { authUnits, configUnits, guaranteeUnits, jobUnits, notificationUnits, screenUnits } from '../../../semantics/reading-layers.js';
import { readerOf, readerOfFinding, type ReadingClass, type ReadingReader } from '../../../semantics/reading-class.js';
import { SIGN_READER, signClassOf } from '../../../semantics/reading-sign.js';
import type { ReadingChange } from '../../../semantics/reading-change.js';
import { acceptCounts, acceptItems } from '../../../semantics/reading-load.js';
import { collectSigns } from '../../prose.js';
import type { ActionSpec } from '../../../model/trace/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { blockOf, exemptionOf, signHostOf } from './chapter-files.js';
import { bookLayout } from './face-scope.js';
import { pendingFindings, unplacedFindings } from './finding-placement.js';

/** 読み手 1 人ぶんの読む量(公理は業務の判断なので、業務にだけ載る)。 */
export interface ReaderLoad {
  readonly axioms: number;
  /** 理由つきの受け入れ(人が通した分)。 */
  readonly reasoned: number;
  /** まだ通していない受け入れ。検証の結果が渡されていなければ null。 */
  readonly pending: number | null;
}

/** ブロック 1 つ分の読む量。 */
export interface BlockReading {
  /** 章ページのファイル。 */
  readonly chapter: string;
  /** 節の名前。 */
  readonly section: string;
  /** 仕様ファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** 公理の本数。 */
  readonly axioms: number;
  /** 理由つきの受け入れ(人が通した分)。 */
  readonly reasoned: number;
  /** まだ通していない受け入れ。検証の結果が渡されていなければ null。 */
  readonly pending: number | null;
  /** 公理の側の変更。基点なしは null。 */
  readonly changed: number | null;
  /** 標識の本数(単位が違うので、必読などには足さない)。 */
  readonly signs: number;
  /** 標識の行き先(標識を持つブロックだけ)。 */
  readonly signClass: ReadingClass | null;
  /** 標識の読み手(標識を持つブロックだけ)。 */
  readonly signReader: ReadingReader | null;
  /** 読み手ごとの読む量(公理・理由つき・まだ通していない)。合計は上の 3 つに一致する。 */
  readonly byReader: Readonly<Record<ReadingReader, ReaderLoad>>;
}

/** 公理の側の差分が指す仕様ファイル(増えた・変わったものは head の仕様で引く。消えたものは引けない)。 */
function changeFile(change: ReadingChange, model: SpecModel, actions: readonly ActionSpec[]): string | null {
  if (change.element === 'computes.example') {
    // 例の行は宣言のある操作の仕様に数える(`axiomsByFile`)。操作が消えていれば引けない。
    const op = computeExampleOpOf(change.key);
    return actions.find((action) => action.handles.raw === op)?.location.file ?? null;
  }
  if (change.element === 'invariant.statement') {
    for (const specs of model.aggregates.values()) {
      if (specs.invariants?.invariants.some((invariant) => invariant.id === change.key) === true) return specs.invariants.location.file;
    }
    return null;
  }
  if (change.element === 'entity.summary') {
    for (const specs of model.aggregates.values()) if (specs.entity?.entity === change.key) return specs.entity.location.file;
    return null;
  }
  const machineName = change.element === 'machine.summary' ? change.key : (change.key.split('.')[0] ?? '');
  for (const specs of model.aggregates.values()) {
    const machine = specs.stateMachines.find((candidate) => candidate.machine === machineName);
    if (machine !== undefined) return machine.location.file;
  }
  return null;
}

/**
 * 公理の本数を仕様ファイルごとに数える(必読に数える公理は 5 種類。数え方は `semantics/reading-axioms.ts`)。
 *
 * 不変条件は `invariants.md`、アクセスの宣言(表の行)は `access.md`、状態の意味と節の要約は `states.md`、
 * 章頭の 1 文は `entity.md`、計算の例の表の行は宣言のある操作の仕様(`action_spec`)に数える。
 * 通知・ジョブ・認証・設定・保証の宣言はそれぞれのカタログのファイルに、画面の宣言は画面の仕様ファイルに数える。計算される欄の宣言そのものは導出なので数えない。
 */
function axiomsByFile(model: SpecModel, ctx: GenerateContext): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (file: string | undefined, count: number): void => {
    if (file !== undefined && count > 0) counts.set(file, (counts.get(file) ?? 0) + count);
  };
  const system = systemRoleId(model.roles.roles);
  for (const specs of model.aggregates.values()) {
    add(specs.invariants?.location.file, specs.invariants?.invariants.length ?? 0);
    add(specs.access?.location.file, accessUnits(accessTable(specs.access, system)));
    add(specs.entity?.location.file, specs.entity?.summary === undefined ? 0 : 1);
    for (const machine of specs.stateMachines) {
      add(machine.location.file, stateMeanings([machine]).length + (machine.summary === undefined ? 0 : 1));
    }
  }
  for (const set of computeExampleSets(ctx.actions?.actions ?? [])) add(set.file, set.examples.length);
  // 通知・ジョブ・画面・認証・設定・保証の層は、宣言 1 つ(通知 1 本・ジョブ 1 本・画面 1 枚・分岐 1 行・設定 1 本・保証 1 本・語彙の語 1 語)を 1 本と数える(`semantics/reading-layers.ts`)。
  const layerUnits = [
    ...notificationUnits(ctx.notifications?.catalog ?? null),
    ...jobUnits(ctx.jobs?.catalog ?? null, ctx.notifications?.catalog ?? null),
    ...screenUnits(ctx.screens?.screens ?? []),
    ...authUnits(ctx.auth?.flow ?? null),
    ...configUnits(ctx.config?.catalog ?? null),
    ...guaranteeUnits(ctx.guarantees?.catalog ?? null),
  ];
  for (const unit of layerUnits) add(unit.file, 1);
  return counts;
}

/** 件数を数える小道具(ファイル → 件数)。 */
function tally(files: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file, (counts.get(file) ?? 0) + 1);
  return counts;
}

/** 数えられる読む量(公理・受け入れ・まだ通していない・変更)があるか。標識だけのブロックは含めない。 */
export function hasReading(reading: BlockReading): boolean {
  return reading.axioms + reading.reasoned + (reading.pending ?? 0) + (reading.changed ?? 0) > 0;
}

/**
 * 全ブロックの読む量。読む量が 0 のブロックのうち、標識も持たないものは含めない。
 * 並びは出どころの順(ファイルの昇順)で、手引きが読み手と章で束ねる。
 */
export function blockReadings(model: SpecModel, ctx: GenerateContext): BlockReading[] {
  const sources = ctx.specSources ?? new Map<string, string>();
  const layout = bookLayout(model, ctx);
  const accept = acceptItems(acceptCounts(ctx.actions?.actions ?? [], ctx.dataTables?.tables ?? [], ctx.usecases?.usecases ?? [], ctx.screens?.screens ?? [], ctx.jobs?.catalog?.jobs ?? [], ctx.config?.catalog?.variables ?? []));
  const reasoned = tally(accept.map((item) => item.file));
  const reasonedBy = (reader: ReadingReader): Map<string, number> =>
    tally(accept.filter((item) => readerOf(item.element) === reader).map((item) => item.file));
  const reasonedByReader = { business: reasonedBy('business'), developer: reasonedBy('developer') };
  const axioms = axiomsByFile(model, ctx);
  const found = pendingFindings(ctx);
  const pending = tally((found ?? []).map((finding) => finding.location.file));
  const pendingBy = (reader: ReadingReader): Map<string, number> =>
    tally((found ?? []).filter((finding) => readerOfFinding(finding.verifier) === reader).map((finding) => finding.location.file));
  const pendingByReader = { business: pendingBy('business'), developer: pendingBy('developer') };
  const changes = ctx.readingBase === undefined ? null : tally(ctx.readingBase.changes.flatMap((change) => changeFile(change, model, ctx.actions?.actions ?? []) ?? []));
  const files = [...new Set([...axioms.keys(), ...reasoned.keys(), ...pending.keys(), ...(changes?.keys() ?? []), ...sources.keys()])].sort();
  return files.flatMap((file) => {
    const source = sources.get(file) ?? '';
    const block = blockOf(file, model, ctx.roots, layout);
    if (block === null || exemptionOf(file, source) !== null) return [];
    const host = signHostOf(file, model, ctx.roots);
    const signs = collectSigns(source).length;
    const reading: BlockReading = {
      ...block,
      file,
      axioms: axioms.get(file) ?? 0,
      reasoned: reasoned.get(file) ?? 0,
      pending: found === null ? null : (pending.get(file) ?? 0),
      changed: changes === null ? null : (changes.get(file) ?? 0),
      signs,
      signClass: signs > 0 && host !== null ? signClassOf(host) : null,
      signReader: signs > 0 && host !== null ? SIGN_READER[host] : null,
      byReader: {
        business: {
          axioms: axioms.get(file) ?? 0,
          reasoned: reasonedByReader.business.get(file) ?? 0,
          pending: found === null ? null : (pendingByReader.business.get(file) ?? 0),
        },
        developer: {
          axioms: 0,
          reasoned: reasonedByReader.developer.get(file) ?? 0,
          pending: found === null ? null : (pendingByReader.developer.get(file) ?? 0),
        },
      },
    };
    return hasReading(reading) || reading.signClass !== null ? [reading] : [];
  });
}

/** どの章のブロックにも配れないもの(警告と、消えて引けない公理の側の差分)。 */
export interface UnplacedReading {
  readonly pending: readonly Finding[];
  /** 基点つきのとき、仕様ファイルを引けなかった公理の側の差分(消えた不変条件など)。基点なしは null。 */
  readonly changes: readonly ReadingChange[] | null;
}

/** 配れなかったものを集める。 */
export function unplacedReading(model: SpecModel, ctx: GenerateContext): UnplacedReading {
  const found = pendingFindings(ctx);
  return {
    pending: found === null ? [] : unplacedFindings(found, model, ctx.roots, bookLayout(model, ctx)),
    changes: ctx.readingBase === undefined ? null : ctx.readingBase.changes.filter((change) => changeFile(change, model, ctx.actions?.actions ?? []) === null),
  };
}

/** 読む量の合計(行の合算。まだ通していない・変更は引けた行だけを足す)。 */
export interface ReadingSum {
  readonly axioms: number;
  readonly reasoned: number;
  readonly pending: number | null;
  readonly changed: number | null;
  /** 読み手ごとの合計(業務 + 開発者 = 上の合計)。 */
  readonly byReader: Readonly<Record<ReadingReader, ReaderLoad>>;
}

/** ある読み手の必読(公理 + 受け入れ)。まだ通していない分が引けていなければ、引けた分だけ。 */
export function requiredOf(load: ReaderLoad): number {
  return load.axioms + load.reasoned + (load.pending ?? 0);
}

/**
 * 行を足し合わせる。まだ通していない・変更は、**引けているときだけ**数にする(行が 0 件でも、
 * 検証の結果や基点が渡されていなければ null。0 とは書かない)。
 */
export function sumReadings(rows: readonly BlockReading[], ctx: GenerateContext): ReadingSum {
  const sumOf = (reader: ReadingReader): ReaderLoad => ({
    axioms: rows.reduce((sum, row) => sum + row.byReader[reader].axioms, 0),
    reasoned: rows.reduce((sum, row) => sum + row.byReader[reader].reasoned, 0),
    pending: ctx.findings === undefined ? null : rows.reduce((sum, row) => sum + (row.byReader[reader].pending ?? 0), 0),
  });
  return {
    byReader: { business: sumOf('business'), developer: sumOf('developer') },
    axioms: rows.reduce((sum, row) => sum + row.axioms, 0),
    reasoned: rows.reduce((sum, row) => sum + row.reasoned, 0),
    pending: ctx.findings === undefined ? null : rows.reduce((sum, row) => sum + (row.pending ?? 0), 0),
    changed: ctx.readingBase === undefined ? null : rows.reduce((sum, row) => sum + (row.changed ?? 0), 0),
  };
}

/**
 * 章 1 つの読む量の合計(その章のブロックだけを足す)。
 *
 * 集約の章は従属を畳んだ範囲で数える(`face-facts.ts`)ので、ここの合計とは合わない。ブロックを章に配るだけの
 * 章(タスクの章など)は、この合計がそのまま章の数になる。
 *
 * @param chapterFile 章ページのファイル
 */
export function chapterReading(model: SpecModel, ctx: GenerateContext, chapterFile: string): ReadingSum {
  return sumReadings(
    blockReadings(model, ctx).filter((reading) => reading.chapter === chapterFile),
    ctx,
  );
}
