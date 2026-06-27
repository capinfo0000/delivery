# iPhoneアプリ化（無料）ガイド

このアプリを **iPhoneのネイティブアプリ**にして、**TikTokを見ながら裏で読み上げ**できるようにする手順です。
**Mac不要・Apple Developer（年¥15,000）不要**の無料ルートです。

## 全体の流れ

```
① GitHub Actions（無料macビルド環境）で IPA を生成   ← Mac不要
② Windows PC に SideStore をセットアップ（初回1回だけ）
③ 無料Apple ID で iPhone に IPA をインストール        ← 年¥15,000不要
④ アプリ内で「読み上げ開始」→ TikTokを前面にしても裏で読み上げ
```

> 💡 2025年12月18日施行の「スマホ新法」により、日本のiPhoneでもApp Store外からの
> アプリ導入が正式に認められています。

---

## ① IPA をビルドする（GitHub Actions）

1. このリポジトリの **Actions** タブを開く
2. 左の **「Build iOS IPA (unsigned, for SideStore)」** を選択
3. **Run workflow** → ブランチ `claude/tiktok-comment-tts-eye7ai` を選んで実行
4. 5〜15分で完了。実行結果の下部 **Artifacts** から **`tiktok-comment-tts-ipa`** をダウンロード
5. zipを解凍すると **`app-unsigned.ipa`** が入っています

> このIPAは「署名なし」です。署名は次のSideStoreが、あなたの無料Apple IDで自動的に行います。

## ② Windows に SideStore をセットアップ（初回のみ）

公式手順に沿って進めてください：[SideStore 公式サイト](https://sidestore.io/) / [GitHub](https://github.com/SideStore/SideStore)

ざっくり：
1. WindowsにiTunes（またはApple Devices）とiCloud（Apple公式版）を入れる
2. SideStoreのインストーラ（AltServer系）でiPhoneとペアリング
3. iPhoneに SideStore アプリが入る → **無料のApple ID** でサインイン
4. 設定後はWiFiで自動更新されるので、以降はPC常時接続は不要

## ③ iPhone にインストール

1. ①の **`app-unsigned.ipa`** をiPhoneに送る（iCloud Drive / メール / ファイルアプリ等）
2. SideStore アプリで **「＋」→ そのIPAを選択** してインストール
3. ホーム画面に「コメント読み上げ」アプリが追加される

> ⚠️ 無料Apple IDの制約：アプリは**7日ごとに再署名が必要**（SideStoreがWiFiで自動更新）。
> 同時に入れられる自作アプリは3つまで。

## ④ 使う

1. アプリを開く →「🔊 読み上げを開始」をタップ
2. 配信者名を入れて「接続」
3. **iPhoneでTikTokを開く** → このアプリは裏で読み上げを継続します

> 🎧 配信中に同じiPhoneで使う場合、読み上げ音が配信マイクに入らないよう
> **イヤホン推奨**です。

---

## 注意・既知の課題（要・実機調整）

- **バックグラウンド読み上げ**は、ネイティブTTS（`category: playback`）＋無音オーディオによる
  背面維持＋`UIBackgroundModes: audio`（CIで自動付与）で実装しています。
  iOSのバージョンや状況によっては**実機での微調整が必要**な場合があります。
  もし背面で止まる場合は、まず「別端末で読み上げ」（Web版）が確実な代替です。
- ビルドに使う Capacitor / プラグインのバージョンは `package.json` で管理しています。
  ビルドが失敗する場合はバージョンの整合を調整してください。
- TikTok の仕様変更により、コメント取得（中継サーバー）側が影響を受けることがあります。

## 開発メモ

- Web資産（`index.html` / `app.js` ほか）が「正」。`npm run copy:web` で `www/` に複製し、
  Capacitor がそれをネイティブに取り込みます。
- ネイティブ実行時は `app.js` が自動で **ネイティブTTS** に切替（ブラウザでは従来のWeb TTS）。
- ローカルにMacがある場合は `npm install && npm run ios:add && npx cap open ios` でXcodeを開けます。
