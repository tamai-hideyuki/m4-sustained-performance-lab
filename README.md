# M4 Sustained Performance Lab

MacBook Pro（M4 Pro）と MacBook Air（M4）の「電力制御込みの実測性能（持続性能）」を比較するためのベンチマークツール。

同一リポジトリを両マシンで実行し、**瞬間火力（Burst）** と **持続火力（Sustained）** の差を数値で可視化します。

## セットアップ

```bash
git clone <this-repo>
cd m4-sustained-performance-lab
npm install
```

**必要環境:**
- macOS（Apple Silicon）
- Node.js 20 LTS 以上
- `powermetrics` コマンド（macOS 標準搭載、sudo 必要）

## 使い方

### 基本コマンド

マシン名を環境変数 `MACHINE` で指定して実行します。

```bash
# 短時間ベンチ（60秒） - まずはこれで動作確認
MACHINE=pro npm run bench:short

# 中時間ベンチ（5分）
MACHINE=pro npm run bench:mid

# 長時間ベンチ（10分）
MACHINE=pro npm run bench:long
```

Air側でも同じコマンドを実行します:

```bash
MACHINE=air npm run bench:short
```

### オプション

npm scripts を経由せず直接実行する場合、各種パラメータを指定できます:

```bash
npm run build
node dist/scripts/run_bench.js --duration 120 --workers 8 --interval 500 --machine pro --warmup 10
```

| オプション | デフォルト | 説明 |
|-----------|-----------|------|
| `--duration` | 60 | 負荷時間（秒） |
| `--workers` | CPU論理コア数 | worker_threads の並列数 |
| `--interval` | 1000 | powermetrics サンプリング間隔（ms） |
| `--machine` | `$MACHINE` or `unknown` | マシン識別名 |
| `--warmup` | 5 | 統計計算から除外するウォームアップサンプル数 |

### 比較レポート

両マシンの結果が揃ったら、比較レポートを生成できます:

```bash
# 最新結果同士のペア比較
npm run compare

# 全結果の横断比較（持続時間別の劣化分析付き）
npm run compare:all
```

デフォルトでは `pro` と `air` の最新結果を比較します。マシン名を変更する場合:

```bash
npm run build && node dist/scripts/compare.js --a pro --b air
```

比較時に duration や workers が異なる場合は警告が表示されます。

## 計測の仕組み

### 並列実行

ベンチマーク実行中、以下の2つのプロセスが並行して動作します:

1. **powermetrics** — 電力・周波数・レジデンシー・サーマルデータを 1秒ごとにサンプリング
2. **CPU ストレス** — 全コアで worker_threads を使った busy loop（決定的 xorshift128+ PRNG による再現性のある数値演算）

### ウォームアップ除外

計測開始直後の数サンプルはCPU が定常状態に達していないため、統計計算（avg, stddev 等）から除外されます。デフォルトは 5 サンプル（`--warmup` で変更可能）。時系列データには全サンプルが保持されるため、立ち上がり挙動も確認できます。

### Worker 中間報告

各ワーカーは 10 秒ごとに中間イテレーション数を報告します。これにより、スロットリングによるスループット劣化の時間推移が `summary.json` の `stress.throughputTimeseries` として記録されます。

## 出力ファイル

実行結果は `results/<machine>/<timestamp>/` に保存されます:

```
results/
  pro/
    20260218_143022/
      run.json              # 実行条件メタ情報
      raw_powermetrics.txt  # powermetrics 生ログ
      summary.json          # パース済みサマリ（統計量 + 時系列データ）
      notes.md              # メモ欄（手動記入用）
    latest -> 20260218_143022  # 最新結果へのシンボリックリンク
  air/
    ...
```

### summary.json の内容

```json
{
  "cpuPower": {
    "avg": 12345.67,
    "max": 15000,
    "min": 8000,
    "median": 12500.0,
    "stddev": 1234.56,
    "p5": 9000.0,
    "p95": 14500.0,
    "samples": 55
  },
  "pClusterFreq": { "avg": 3800.0, "median": 3850.0, "stddev": 120.5, "..." : "..." },
  "totalSamples": 60,
  "warmupSamplesExcluded": 5,
  "durationMs": 60000,
  "timeseries": [
    {
      "index": 0,
      "elapsedMs": 1012,
      "cpuPower": 1669,
      "pClusterFreq": 4218.0,
      "thermalPressure": "Nominal",
      "...": "..."
    }
  ],
  "stress": {
    "workers": 12,
    "totalIterations": 1234567890,
    "elapsedMs": 60012,
    "iterationsPerSecond": 20571234,
    "perWorker": [...],
    "throughputTimeseries": [
      { "elapsedSec": 10, "aggregateIps": 20000000 },
      { "elapsedSec": 20, "aggregateIps": 19500000 }
    ]
  }
}
```

### 読み方のポイント

| メトリクス | 意味 |
|-----------|------|
| **CPU Power avg** | 平均消費電力。高い = よりパワーを使えている |
| **CPU Power stddev** | 電力のばらつき。大きい = スロットリングによる変動が激しい |
| **CPU Power p5 / p95** | 電力の下位5% / 上位95%。外れ値を除いた実効範囲 |
| **P-Cluster Freq median** | P-core 周波数の中央値。avg より外れ値に頑健 |
| **P-Cluster Freq stddev** | 周波数のばらつき。小さい = 安定した持続性能 |
| **P-Cluster Idle Residency** | P-core のアイドル率。高い = スロットリングで休止が多い |
| **Iterations/s** | CPU演算スループット。最終的な実効性能の指標 |
| **thermalPressure** | サーマルプレッシャー（Nominal / Moderate / Heavy / Trapping / Sleeping） |
| **throughputTimeseries** | 時間経過に伴うスループット変化。劣化タイミングの特定に |

**Pro vs Air で見るべき差:**
- `bench:short` では両者の差が小さい（瞬間火力は同等）
- `bench:long` では Pro の方が高い値を維持する（放熱差が出る）
- Air は長時間で Freq / Power が下がり、Idle Residency が上がる傾向
- `stddev` を比較すると、Air の方がばらつきが大きい（スロットリングの影響）

## 注意事項

### sudo について

`powermetrics` は root 権限が必要です。実行時にパスワード入力を求められます。

事前に `sudo -v` でキャッシュしておくとスムーズです:

```bash
sudo -v && MACHINE=pro npm run bench:short
```

### 熱に関する注意

- 長時間ベンチ中はマシンが高温になります
- **ファンレスの MacBook Air は特に注意**してください
- 机にベタ置きせず、通気を確保してください
- 連続実行は避け、間に冷却時間を設けてください

### 会社PC

会社所有のPCで実行する場合は、所属組織のポリシーに従ってください。

### 再現性のために

- 両マシンで同一の Node.js バージョンを使用してください
- バックグラウンドアプリを可能な限り閉じてください
- 電源接続状態を統一してください（両方接続 or 両方バッテリー）
- 室温が極端に異ならない環境で実行してください
- `--warmup` を適切に設定し、立ち上がりノイズを除外してください

## フォルダ構成

```
m4-sustained-performance-lab/
  package.json
  tsconfig.json
  .gitignore
  CLAUDE.md              # Claude Code 向けガイド
  README.md
  scripts/
    run_bench.ts           # メインランナー
    cpu_stress.ts          # CPU負荷オーケストレーター（進捗コールバック対応）
    cpu_stress_worker.ts   # Worker thread（xorshift128+ による決定的ワークロード）
    parse_powermetrics.ts  # powermetrics パーサー（統計量・時系列・ウォームアップ除外）
    compare.ts             # ペア比較レポート（バリデーション付き）
    compare_all.ts         # 全結果横断比較・劣化分析
  results/                 # 計測結果（git 管理）
  dist/                    # コンパイル済みJS（gitignored）
```

## 開発

```bash
npm run build    # TypeScript コンパイル
```

`parse_powermetrics.ts` は単体でも使えます:

```bash
node dist/scripts/parse_powermetrics.js results/pro/latest/raw_powermetrics.txt
```
