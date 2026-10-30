# VFX BOOTH

グリーンバック+外付けカメラで人を切り抜き、奥・手前のレイヤーの間にはさんで写真にする、文化祭用のソフト(Mac)。
写真はどこにもアップロードされず、PC画面のQR(パラパラ切り替わる)をスマホが読み取って受け取る。

## 起動
`start.command`(Mac)か `start.bat`(Windows)をダブルクリック(ブラウザで http://localhost:8080 が開く)。止めるときはターミナルで Ctrl+C。
Web 版: https://aiueo5658-prog.github.io/vfx-booth-web/ (公開リポジトリ `vfx-booth-web`)。更新は commit してから `tools/deploy_web.sh`。
初回は「開発元を確認できません」と出たら、右クリック → 開く。

## 当日の流れ
1. **準備**: 映像の緑をクリック(または「自動で取る」)
2. **撮影**: 立ち位置の枠にゲストが入ったら、シャッター(スペースキーでも可)
3. **送信**: スマホでQR①(受信ページ)を読む → 「読み取りスタート」→ QR②にカメラを向ける

読めない時: 送信画面で速さを「ゆっくり」/ PCの画面を明るく / スマホを30cmほど離す。
最終手段: 画像アイコンで完成画像を大きく出し、スマホで撮ってもらう。

## 構成
| ファイル | 役割 |
|---|---|
| `index.html` `app.js` `app.css` | PC側アプリ(準備/撮影/送信の3画面) |
| `receive.html` | スマホ側の受信ページ(QR②を読み取って画像に戻す) |
| `common.js` | QR分割(噴水符号: 取りこぼしに強い)・CRC・QR描画 |
| `m3.css` | 共通デザイン(apple.com の DESIGN.md 準拠。スマホ受信ページと共通) |
| `assets/` | シーン素材と `scenes.json`(戦隊の大爆発・中二病の詠唱・地下牢・怪獣から逃げろ・魔王の玉座) |
| `fx.js` | 動く演出(爆発・色つきの煙・火の粉・霧・魔法陣・光の輪・呪文・瓦礫・炎・光のゆらぎ・光の筋) |
| `vendor/` | qrcode-generator(MIT) / jsQR(Apache-2.0) / ZBar-wasm(LGPL-2.1+) |
| `config.js` | 受信ページの公開URL |
| `server.py` | LAN内だけで使う補助サーバー(通常は不要) |

## 受信ページの公開
スマホは会場のWi-Fiに入らず、自分の回線で公開ページを開く。ページ本体は静的ファイルだけで、写真は一切通らない。

- 公開先: https://aiueo5658-prog.github.io/vfx-booth-receiver/ (リポジトリ `vfx-booth-receiver`、GitHub Pages)
- `receive.html` `common.js` `m3.css` `vendor/` を変えたら `tools/deploy_receiver.sh` で公開版に反映する(`site/` は公開用コピー。このリポジトリには含めない)。

## シーンの作り方
`assets/scenes.json` がシーン定義。`layers` は奥→手前の順で、`{"person": true}` の位置に人が入る。シーンが空のときは、暗い背景に人だけが出る。
画像は1280x720。透過PNG/WebPなら前景にできる。`blend:"lighter"` で光を加算合成。
`{"fx": "explosion", ...}` のように書くと、その位置に `fx.js` の動く演出が入る(人物の前にも後ろにも置ける)。シャッターの瞬間に演出が弾けて、`burstDelay` ミリ秒後に撮る。
各シーンの `fx` で人物まわりの処理を付けられる:`shadow`(足元の接地影)、`rim`(輪郭に乗せる光)、`shade`(体に落ちる縞の影。牢屋の格子)。

背景は Blender で作る(`Desktop/Claude用/vfx_scenes/booth_scenes.blend`、シーンごとに Blender のシーンが分かれている)。奥(`*_back`)は人物なしの全体、手前(`*_front`)はカメラの描画距離を人物の手前で切ったマスクで奥を切り抜いたもの。

ブースのカメラは正面・水平・人物が中央・全身で固定。背景はそれに合わせて作る(Blender なら 35mm、人物の約4.4m手前、床から1.2m、水平)。

## ライセンス
フォントは Google Fonts の Roboto / Noto Sans JP(読めないときは端末の書体)。ZBar は `vendor/zbar-LICENSE.txt`(LGPL-2.1+)を参照。
