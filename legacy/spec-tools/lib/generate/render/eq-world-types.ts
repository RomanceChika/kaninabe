/**
 * 一致の証明の設計図の型の**再輸出**のうち、**単発の操作**の節(束 ①-d 手 2)。
 *
 * **形の正はハーネスが 1 か所で持つ**(`@kaninabe/runtime/testing/equivalence/types`)—— 値はこの生成物が
 * 書き出し、形はパッケージから再輸出する。2 か所で宣言していたあいだ、片方だけを直した日に黙って
 * 食い違う形が残っていた(設計メモ §9-12)。実行する側(生成テスト・アダプタ・見張りテスト)は今まで
 * どおりこの生成物から型を引ける。
 *
 * 保存点の節は `eq-save-world-types.ts` にある(行・実行者・軸の形は共通で、ここが再輸出する)。
 */

import { RUNTIME_TESTING_EQ_TYPES_MODULE } from './runtime-modules.js';

/** 単発の操作の節の型の再輸出。 */
export const EQ_TYPES: readonly string[] = [
  'export type {',
  '  EqActor,',
  '  EqAxis,',
  '  EqAxisValue,',
  '  EqFoldedGuard,',
  '  EqOperation,',
  '  EqPlacement,',
  '  EqRecorded,',
  '  EqRecordedColumn,',
  '  EqRoleArray,',
  '  EqValue,',
  '  EqWorld,',
  '  EqWorldRow,',
  `} from '${RUNTIME_TESTING_EQ_TYPES_MODULE}';`,
];
