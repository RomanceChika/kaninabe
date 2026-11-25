/**
 * 状態機械のドキュメント生成器(states.md 用)。
 *
 * 1 つの states.md に対して 3 つのマーカーを埋める:
 * - `state-diagram`: mermaid の状態遷移図(骨格)
 * - `transition-table`: 定義された遷移の一覧(条件・権限・副作用つき)
 * - `state-event-matrix`: 全状態 × 全イベントのマトリクス(暗黙の禁止を目視するための表)
 *
 * 1 ファイルに直交する複数の状態機械(machines: 形式)が書かれている場合、
 * マーカーは 1 組しか無いため、機械ごとに H3 見出しを付けて 1 セクションに連結する。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import { allMachines, type SpecModel, type StateMachineSpec } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { renderStateDiagram } from './state-machine-mermaid.js';
import { renderTransitionTable } from '../../gen-kit/state-machine-table.js';
import { renderStateEventMatrix } from './state-machine-matrix.js';

/** マーカー名と、そのマーカーに差し込む本文を作る関数の対応。 */
const RENDERERS: readonly (readonly [string, (machine: StateMachineSpec) => string])[] = [
  ['state-diagram', renderStateDiagram],
  ['transition-table', renderTransitionTable],
  ['state-event-matrix', renderStateEventMatrix],
];

/**
 * 状態機械の図・遷移表・マトリクスを生成するジェネレーター。
 * 差し込み先は各状態機械の `location.file`(= その states.md 自身)。
 */
export const stateMachineGenerator: DocGenerator = {
  id: 'state-machine',

  generate(model: SpecModel, _ctx: GenerateContext): GeneratedSection[] {
    const sections: GeneratedSection[] = [];
    for (const [file, machines] of groupByFile(model)) {
      for (const [marker, render] of RENDERERS) {
        sections.push({ file, marker, content: sectionContent(machines, render) });
      }
    }
    return sections;
  },
};

/**
 * 状態機械を差し込み先ファイルごとにまとめる。
 * キーの順序はモデル上の出現順(= 生成されるセクションの順序も決定的になる)。
 */
function groupByFile(model: SpecModel): Map<string, StateMachineSpec[]> {
  const groups = new Map<string, StateMachineSpec[]>();
  for (const { machine } of allMachines(model)) {
    const file = machine.location.file;
    const current = groups.get(file);
    if (current === undefined) groups.set(file, [machine]);
    else current.push(machine);
  }
  return groups;
}

/**
 * 1 マーカー分の本文を組み立てる。
 * 機械が 1 つならレンダラーの出力そのまま、複数なら `### {machine}` 見出しを付けて連結する。
 */
function sectionContent(
  machines: readonly StateMachineSpec[],
  render: (machine: StateMachineSpec) => string,
): string {
  const only = machines.length === 1 ? machines[0] : undefined;
  if (only !== undefined) return render(only);
  return machines.map((machine) => `### ${machine.machine}\n\n${render(machine)}`).join('\n\n');
}
