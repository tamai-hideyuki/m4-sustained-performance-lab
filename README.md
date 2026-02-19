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

## 計測結果の分析（2026-02-20）

### テスト環境

| マシン | チップ | コア数（worker） | 冷却 |
|--------|-------|-----------------|------|
| MacBook Air | Apple M4 | 10 | ファンレス |
| MacBook Pro 14" | Apple M4 Pro | 12 | アクティブファン |
| MacBook Pro 14" | Apple M3 Pro | 12 | アクティブファン |

各マシンで 60秒 / 5分 / 10分 の3パターンを実行。

### 全体比較

```
                       AIR 60s    AIR 5min   AIR 10min    PRO 60s    PRO 5min   PRO 10min   M3 60s     M3 5min    M3 10min
CPU Power avg (mW)     18,678     12,828     11,434       40,714     35,299     33,576      29,172     29,784     29,481
CPU Power stddev (mW)   2,247      1,480      2,795        5,087      3,478      2,010       1,116        487        351
P-Cluster Freq (MHz)    3,094      2,448      2,316        3,642      3,462      3,372       3,576      3,576      3,576
Iterations/s (M)        1,396      1,219      1,153        2,274      2,201      2,184       2,803      2,790      2,731
```

### 持続性能の劣化（60秒 → 10分）

| メトリクス | M4 Air | M4 Pro | M3 Pro |
|-----------|--------|--------|--------|
| CPU Power avg | **-38.8%** | -17.5% | +1.1% |
| P-Cluster Freq | **-25.1%** | -7.4% | -0.0% |
| Iterations/s | **-17.4%** | -4.0% | -2.6% |

### 主要な発見

#### 1. M3 Pro が最も高いスループットを記録

60秒ベンチでの Iterations/s:

- **M3 Pro: 28.0億/s**
- M4 Pro: 22.7億/s
- M4 Air: 14.0億/s（10コア）

M3 Pro は M4 Pro に対して約 **23% 高い演算スループット** を示した。同じ12ワーカーでの比較なので、コアあたりの純粋な整数・浮動小数点演算性能で M3 Pro が上回っている。これは xorshift + 三角関数という本ベンチマークの特性（分岐予測やメモリ帯域に依存しない純演算）による可能性がある。

#### 2. M3 Pro の圧倒的な安定性

M3 Pro は **10分間クロックが一切変動しない**（stddev = 0〜1 MHz）。消費電力も 29W 台で推移し、stddev はわずか 351 mW（10分時）。サーマルスロットリングが実質的に発生していない。

対して M4 Pro は最大 4.3 GHz から 3.4 GHz まで低下（-7.4%）、M4 Air は 3.1 GHz → 2.3 GHz（-25.1%）と大幅に下がる。

#### 3. M4 Pro は高消費電力・高発熱

M4 Pro は 60秒時に **40.7W** を消費し、3台中最大。M3 Pro の 29.2W と比べて約 40% 多い電力を使いながら、スループットでは下回る。M4 世代でアーキテクチャ的な方向性が変わった可能性がある。

#### 4. M4 Air のファンレス限界

ファンレス設計の M4 Air は、持続負荷において最も大きな劣化を示す：
- 消費電力が **38.8% 低下**（＝OS が電力を絞っている）
- クロック周波数が **25.1% 低下**
- 結果としてスループットが **17.4% 低下**

ただし60秒の瞬間性能では P-Cluster 3,094 MHz を達成しており、短時間のバースト処理には十分な性能がある。

#### 5. 安定性の指標としての stddev

CPU Power stddev は持続性能の安定性を示す良い指標となる：

| マシン | 60秒 | 5分 | 10分 |
|--------|------|-----|------|
| M4 Air | 2,247 mW | 1,480 mW | 2,795 mW |
| M4 Pro | 5,087 mW | 3,478 mW | 2,010 mW |
| M3 Pro | 1,116 mW | 487 mW | **351 mW** |

M3 Pro の stddev が圧倒的に小さく、電力制御がスムーズに行われていることを示す。M4 Air の10分時 stddev が5分時より増加しているのは、サーマルリミットぎりぎりでの電力制御の振動を示唆する。

### まとめ

| 観点 | 最優秀 | 備考 |
|------|--------|------|
| 瞬間スループット | **M3 Pro** | 28.0億 IPS |
| 持続スループット | **M3 Pro** | 10分後も -2.6% に留まる |
| 安定性（stddev） | **M3 Pro** | クロック変動ゼロ |
| 消費電力効率 | **M3 Pro** | 29W で最高性能 |
| 瞬間→持続の劣化 | M4 Air が最大 | ファンレスの宿命 |

本ベンチマーク（CPU 純演算負荷）においては、M3 Pro が性能・安定性・電力効率のすべてで M4 Pro を上回る結果となった。M4 世代は電力消費が増加しつつもスロットリングが発生しやすく、持続性能では不利に働いている。

> **注意:** この結果は xorshift + 三角関数による CPU 純演算ベンチマークに限定したものです。メモリ帯域、GPU 性能、Neural Engine、メディアエンジン等を含む総合性能とは異なります。

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
