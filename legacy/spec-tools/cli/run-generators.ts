/**
 * 生成器の並びを回し、出力先のファイルごとにセクションをまとめる(`cli/generate-docs.ts` と
 * `cli/generate-book.ts` が同じ 1 本を呼ぶ)。
 *
 * 生成器の前提が破れたとき(`GeneratorPreconditionError` = 検査の穴)は、スタックトレースでなく Finding を返す
 * —— 「何を・どう直すか」が読めなければ、仕様の問題と区別がつかない(scripts-code-quality.md)。印字して
 * 止めるのは CLI の仕事で、ここは投げ直さない対象だけを結果の型にする。それ以外の例外は投げ直す。
 * **`lib/generate/**` に置かないのは、生成器の置き場は throw しない規約(ESLint)で、投げ直しもその対象だから**。
 * 例外を捕まえて Finding にする側は組み立ての根(CLI)の仕事である。
 */

import type { SpecModel } from '../lib/model/types.js';
import type { Finding } from '../lib/kernel/finding.js';
import { GeneratorPreconditionError } from '../lib/kernel/generator-precondition.js';
import type { FileSection } from '../lib/generate/apply-sections.js';
import { resetTrusted, sliceTrusted } from '../lib/kernel/trusted-html.js';
import type { DocGenerator, GenerateContext } from '../lib/gen-kit/generator.js';

/** 生成の結果(ファイルごとのセクション、または破れた前提)。 */
export type GenerationOutcome =
  | {
      readonly ok: true;
      readonly byFile: ReadonlyMap<string, readonly FileSection[]>;
      /** 何も出さなかった生成器の ID(宣言順。材料の種類が無い製品では、その種類の章を出す生成器が入る)。 */
      readonly emptyGenerators: readonly string[];
    }
  | { readonly ok: false; readonly findings: readonly Finding[] };

/**
 * 生成器を宣言順に回し、出力先のファイルごとにセクションをまとめる。
 *
 * @param generators 回す生成器(宣言順 = 同じファイルへ書くセクションの並び順)
 * @param model ドメイン仕様全体
 * @param ctx 完成した生成の文脈
 * @returns ファイルごとのセクションと何も出さなかった生成器。前提が破れていれば、破れた前提(error の Finding)
 */
export function runGenerators(
  generators: readonly DocGenerator[],
  model: SpecModel,
  ctx: GenerateContext,
): GenerationOutcome {
  const byFile = new Map<string, FileSection[]>();
  const emptyGenerators: string[] = [];
  // 例外の登録簿は実行ごとに空にし、生成器ごとの登録をその生成器が出すセクションにだけ付ける(別のページの登録で例外にならない)。
  const registry = resetTrusted();
  try {
    for (const gen of generators) {
      const from = registry.log.length;
      const sections = gen.generate(model, ctx);
      const trusted = sliceTrusted(registry, from);
      if (sections.length === 0) emptyGenerators.push(gen.id);
      for (const section of sections) {
        const list = byFile.get(section.file) ?? [];
        list.push({ ...section, trusted });
        byFile.set(section.file, list);
      }
    }
  } catch (error) {
    if (!(error instanceof GeneratorPreconditionError)) throw error;
    return { ok: false, findings: error.findings };
  }
  return { ok: true, byFile, emptyGenerators };
}
