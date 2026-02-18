# CLAUDE.md

このファイルは Claude Code がリポジトリを扱う際のガイドです。

## プロジェクト概要

Apple Silicon Mac（M4 Pro vs M4）の持続性能を比較するベンチマークツール。
powermetrics + CPU ストレス負荷を並行実行し、電力・周波数・スロットリングを計測する。

## ビルド・実行

```bash
npm install          # 初回のみ
npm run build        # TypeScript -> dist/ にコンパイル

# ベンチマーク実行（MACHINE 環境変数必須）
MACHINE=pro npm run bench:short   # 60秒
MACHINE=pro npm run bench:mid     # 5分
MACHINE=pro npm run bench:long    # 10分

# 比較レポート
npm run compare          # pro vs air（最新同士）
npm run compare:all      # 全結果の横断比較
```

## 技術スタック

- TypeScript (strict mode) / Node.js 20 LTS
- CommonJS modules（target: ES2022）
- 外部依存なし（devDependencies のみ: typescript, @types/node）
- macOS powermetrics コマンド（sudo 必要）

## ディレクトリ構造

```
scripts/
  run_bench.ts           # メインランナー（CLI引数パース、全体オーケストレーション）
  cpu_stress.ts          # Worker thread 管理、進捗コールバック
  cpu_stress_worker.ts   # 各ワーカーの busy loop（xorshift128+ PRNG）
  parse_powermetrics.ts  # powermetrics 生ログのパーサー（統計計算含む）
  compare.ts             # 2マシンのペア比較レポート
  compare_all.ts         # 全結果の横断比較・劣化分析
results/                 # 計測結果（.gitignore 対象外、git で管理）
dist/                    # コンパイル済み JS（gitignored）
```

## コーディング規約

- TypeScript strict mode を使用
- インターフェースは各ファイルのトップに定義
- パース系は正規表現ベース、`extractNumber` / `extractAllNumbers` ヘルパーを使う
- 統計量は `computeStats` に集約（avg, max, min, median, stddev, p5, p95）
- CLI 引数は `--key value` 形式、環境変数 `MACHINE` でマシン名を指定

## 重要な設計判断

- **ウォームアップ除外**: デフォルト 5 サンプルを統計から除外（`--warmup`で変更可能）。時系列データには全サンプルを保持
- **決定的 PRNG**: `Math.random()` ではなく xorshift128+ を使用し再現性を確保
- **時系列データ**: `summary.json` 内の `timeseries` 配列にパース済みサンプルを保持
- **サーマルデータ**: powermetrics のサンプラーに `thermal` を含め、thermal pressure level を取得
- **Worker 中間報告**: 10秒ごとに IPS を報告し `stress.throughputTimeseries` として保存

## テスト

現時点ではユニットテストなし。動作確認は実際のベンチマーク実行で行う。
`parse_powermetrics.ts` は CLI モードで単体実行可能:

```bash
node dist/scripts/parse_powermetrics.js results/pro/latest/raw_powermetrics.txt
```
