# コメント読み上げ（React Native + Expo 版）

TikTok LIVE のコメントを読み上げる **ネイティブアプリ**（iOS/Android）の実装です。
Web/Capacitor 版とは別の、React Native + Expo による作り直し版です。

## 特徴
- **ネイティブ音声合成**（`expo-speech`）で日本語読み上げ
- **バックグラウンド維持**：`expo-av` の無音ループ再生 ＋ `UIBackgroundModes: audio`
  → TikTokを前面にしても裏で読み上げを狙う（※実機での確認が必要）
- ギフト/フォロー/シェアの読み上げ＋効果音（アプリ内蔵の音）
- 速さ・高さ・各種フィルタ・デモモード
- 設定は端末内（AsyncStorage）に保存

## 使う技術
| 目的 | ライブラリ |
|---|---|
| 音声合成 | `expo-speech` |
| 背面維持・効果音 | `expo-av` |
| コメント受信 | `socket.io-client`（中継サーバー経由） |
| 設定保存 | `@react-native-async-storage/async-storage` |
| スライダー | `@react-native-community/slider` |

## 開発（PCにNode必要）
```bash
cd mobile
npm install
# 実機/シミュレータで開発する場合（Mac必要）
npx expo run:ios
```
> Expo Go では背面音声などネイティブ機能が制限されるため、`expo run:ios` か
> 下記のビルド済みIPA（開発ビルド）で確認してください。

## 無料でIPAをビルド → SideStore で導入（Mac不要）
1. GitHub の **Actions** → **「Build RN(Expo) iOS IPA」** を実行
2. 完了後 **Artifacts** から `tiktok-comment-tts-rn-ipa` をダウンロード → `app-unsigned.ipa`
3. Windows の **SideStore** で無料Apple IDインストール（手順は ../IOS-APP.md 参照）

## 注意
- **バックグラウンド読み上げは実機での微調整が必要**な場合があります。
  `expo-speech` は公式には背面継続を保証しないため、無音オーディオ＋音声セッション設定で
  背面維持を狙っています。もし背面で止まる場合は、より堅牢な `react-native-tts` ＋
  `react-native-track-player` への差し替えを検討します。
- 初回ビルドは Expo/RN のバージョン整合で失敗することがあります。その場合は
  `package.json` のバージョンを Expo SDK に合わせて調整してください
  （`npx expo install --fix` 相当）。
- ビルド失敗時はワークフローのログを共有してください。修正します。
