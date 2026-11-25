/**
 * 検証の群(`*-group.ts`)と束ね(`lib/compose/verify-pipeline.ts`)が共有する契約。
 *
 * 型だけの葉である(何も import しない)。群が束ねの型を読む(`lib/compose/verify-pipeline.ts` ← 各群 ← `lib/compose/verify-pipeline.ts`)形だと、
 * 束ねが全群を import する向きと循環するので、群の側から読む契約はここに置く。
 */

/** 実行状況の 1 行報告の受け口(CLI が console.log を渡す)。 */
export type ProgressLog = (line: string) => void;
