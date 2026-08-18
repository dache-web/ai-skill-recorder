# AI Skill Recorder

Windows版Chrome / Edgeで、PC画面とマイク音声を録画する第1工程完成版です。

会社PCのChrome・Edgeによる最終受け入れテストは合格済みです。

## 会社PCでの公開テスト

公開URL：<https://dache-web.github.io/ai-skill-recorder/>

会社PCではNode.js、npm、pnpm、Git、VS Codeなどの開発ツールは不要です。Windows版ChromeまたはEdgeで公開URLを開くだけでテストできます。

公開ページはGitHub PagesからHTML、CSS、JavaScriptを受信しますが、録画した画面・マイク音声・WebM・Blob・利用者ファイルをGitHubや外部サーバーへ送信しません。録画はブラウザのメモリ内だけで処理され、「PCへ保存」を押した場合だけ利用者のPCへ保存されます。

## 現在できること

- ブラウザ標準の画面共有画面から、画面・ウィンドウ・タブを選択
- PC画面とマイク音声をWebM形式で録画
- 録画経過時間とマイク状態の表示
- アプリまたはブラウザの共有停止操作による録画終了
- 録画停止後のアプリ内再生
- 利用者が選んだPC内の場所への保存
- 録画後の動画を見ながら、重要ポイント・動画で残したい区間・不要区間を指定
- ポイント時点のPNG、解析用JSON、AI解析用の一定間隔PNGをブラウザ内で生成
- 元WebMは編集・上書き・再エンコードせず、原本のままPCへ保存

STEP2-1の解析準備はすべてブラウザ内で行います。AI API、文字起こし、外部アップロードはまだ使用しません。ポイントPNGを主データとし、2秒・5秒・10秒間隔の静止画はAI解析用の補助データとして最大30枚に制限されます。

録画データを外部へ送信したり、プロジェクトフォルダへ自動保存したりしません。

## 開発環境での起動

```bash
pnpm install
pnpm dev
```

表示されたローカルURLをWindows版ChromeまたはEdgeで開きます。画面録画APIは安全な接続でのみ動作するため、開発時は `localhost` を使用してください。

## テストとビルド

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

実際の画面共有、マイク、保存ダイアログは自動テストだけでは確認できません。[手動テスト手順](docs/manual-test.md)に従い、ChromeとEdgeの両方で確認してください。

## セキュリティ

- 録画・録音ファイル、ローカルデータ、環境変数、秘密鍵は `.gitignore` の対象です。
- 録画ファイルをGitHubへ追加しないでください。
- 実際の会社情報、顧客情報、パスワードをテスト録画へ含めないでください。
- 第1工程では外部APIやクラウドを使用しません。
- CSPの`connect-src 'none'`により、公開アプリからの外部通信をブラウザ側でも禁止します。

## GitHub Pagesへの公開

`main`へpushすると、GitHub Actionsが依存関係の固定インストール、自動テスト、ESLint、TypeScript型検査、Viteビルドを順番に実行します。すべて成功した場合だけ`dist`をGitHub Pagesへ公開します。

公開を停止する場合は、GitHubのリポジトリ設定にあるPagesを無効にします。コードを公開対応前へ戻す場合は、checkpoint `44c2fdd`を基準に安全なrevertを行います。
