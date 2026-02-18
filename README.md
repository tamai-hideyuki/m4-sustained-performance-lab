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
node dist/scripts/run_bench.js --duration 120 --workers 8 --interval 500 --machine pro
```

| オプション | デフォルト | 説明 |
|-----------|-----------|------|
| `--duration` | 60 | 負荷時間（秒） |
| `--workers` | CPU論理コア数 | worker_threads の並列数 |
| `--interval` | 1000 | powermetrics サンプリング間隔（ms） |
| `--machine` | `$MACHINE` or `unknown` | マシン識別名 |

### 比較レポート

両マシンの結果が揃ったら、比較レポートを生成できます:

```bash
npm run compare
```

デフォルトでは `pro` と `air` の最新結果を比較します。マシン名を変更する場合:

```bash
npm run build && node dist/scripts/compare.js --a pro --b air
```

## 出力ファイル

実行結果は `results/<machine>/<timestamp>/` に保存されます:

```
results/
  pro/
    20260218_143022/
      run.json              # 実行条件メタ情報
      raw_powermetrics.txt  # powermetrics 生ログ
      summary.json          # パース済みサマリ
      notes.md              # メモ欄（手動記入用）
    latest -> 20260218_143022  # 最新結果へのシンボリックリンク
  air/
    ...
```

### summary.json の内容

```json
{
  "cpuPower":      { "avg": 12345.67, "max": 15000, "min": 8000, "samples": 58 },
  "gpuPower":      { "avg": 100.5,    "max": 200,   "min": 50,   "samples": 58 },
  "combinedPower": { "avg": 12446.17, "max": 15200, "min": 8050, "samples": 58 },
  "pClusterFreq":  { "avg": 3800.0,   "max": 4050,  "min": 3200, "samples": 58 },
  "eClusterFreq":  { "avg": 2064.0,   "max": 2064,  "min": 2064, "samples": 58 },
  "pClusterActiveResidency": { "avg": 95.2, ... },
  "eClusterActiveResidency": { "avg": 40.1, ... },
  "pClusterIdleResidency":   { "avg": 4.8,  ... },
  "eClusterIdleResidency":   { "avg": 59.9, ... },
  "totalSamples": 58,
  "durationMs": 58000,
  "stress": {
    "workers": 12,
    "totalIterations": 1234567890,
    "elapsedMs": 60012,
    "iterationsPerSecond": 20571234,
    "perWorker": [...]
  }
}
```

### 読み方のポイント

| メトリクス | 意味 |
|-----------|------|
| **CPU Power avg** | 平均消費電力。高い = よりパワーを使えている |
| **CPU Power max vs min** | 差が大きい = サーマルスロットリングの可能性 |
| **P-Cluster Freq avg** | P-core の平均動作周波数。持続的に高ければ冷却が効いている |
| **P-Cluster Idle Residency** | P-core のアイドル率。高い = スロットリングで休止が多い |
| **Iterations/s** | CPU演算スループット。最終的な実効性能の指標 |

**Pro vs Air で見るべき差:**
- `bench:short` では両者の差が小さい（瞬間火力は同等）
- `bench:long` では Pro の方が高い値を維持する（放熱差が出る）
- Air は長時間で Freq / Power が下がり、Idle Residency が上がる傾向

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

## フォルダ構成

```
m4-sustained-performance-lab/
  package.json
  tsconfig.json
  .gitignore
  README.md
  scripts/
    run_bench.ts           # メインランナー
    cpu_stress.ts          # CPU負荷オーケストレーター
    cpu_stress_worker.ts   # Worker thread（busy loop）
    parse_powermetrics.ts  # powermetrics パーサー
    compare.ts             # 比較レポート生成
  results/                 # 計測結果（gitignored）
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
