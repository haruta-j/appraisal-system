@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================
echo  YouTube アップロード ^& 映り込みチェック システム
echo ============================================
echo.

rem ---- 既に起動済みなら、そのままブラウザだけ開いて終了 ----
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient).Connect('localhost',3000); exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo 既にサーバーが起動しているようです。ブラウザを開きます。
  start "" http://localhost:3000
  echo このウィンドウは閉じて構いません。
  pause
  exit /b 0
)

rem ---- Node.js の確認・自動インストール ----
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。インストールを試みます...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo winget が使えないため自動インストールできません。
    echo 以下からNode.js LTS版を手動でインストールしてから、再度このファイルをダブルクリックしてください。
    echo https://nodejs.org/
    pause
    exit /b 1
  )
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  call :RefreshPath
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js のインストール後もコマンドが見つかりません。
    echo お手数ですが、一度このウィンドウを閉じてから再度ダブルクリックしてください。
    pause
    exit /b 1
  )
)
echo [OK] Node.js が見つかりました。

rem ---- ffmpeg の確認・自動インストール ----
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo ffmpeg が見つかりません。インストールを試みます...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo winget が使えないため自動インストールできません。
    echo 以下からffmpegを手動でインストールし、PATHに追加してから再度このファイルをダブルクリックしてください。
    echo https://www.gyan.dev/ffmpeg/builds/
    pause
    exit /b 1
  )
  winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
  call :RefreshPath
  where ffmpeg >nul 2>nul
  if errorlevel 1 (
    echo ffmpeg のインストール後もコマンドが見つかりません。
    echo お手数ですが、一度このウィンドウを閉じてから再度ダブルクリックしてください。
    pause
    exit /b 1
  )
)
echo [OK] ffmpeg が見つかりました。

rem ---- 依存パッケージのインストール ----
if not exist "node_modules" (
  echo 初回セットアップ: 依存パッケージをインストールしています(数分かかる場合があります)...
  call npm install
  if errorlevel 1 (
    echo 依存パッケージのインストールに失敗しました。
    pause
    exit /b 1
  )
)

rem ---- 顔検出モデルの準備 ----
if not exist "models\face-api\ssd_mobilenetv1_model.bin" (
  echo 初回セットアップ: 検出モデルを準備しています...
  call npm run download-models
  if errorlevel 1 (
    echo 検出モデルの準備に失敗しました。
    pause
    exit /b 1
  )
)

rem ---- .env の準備 (YouTubeアップロードに必要) ----
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo [注意] .env を新規作成しました。YouTubeへのアップロードを使うには、
  echo        .env を開いて GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定してください。
  echo        素材の確認・編集だけであれば、設定なしでも操作できます。
  echo.
)

echo セットアップ完了。サーバーを起動します...
echo (このウィンドウを閉じるとサーバーが停止します)
echo.

rem ---- 数秒後にブラウザを自動で開く ----
start "" cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:3000"

call npm run dev

pause
exit /b 0

:RefreshPath
rem winget等でインストール直後、同じウィンドウ内でもPATHを再読込する
for /f "usebackq tokens=2,*" %%A in (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul`) do set "SysPath=%%B"
for /f "usebackq tokens=2,*" %%A in (`reg query "HKCU\Environment" /v Path 2^>nul`) do set "UserPath=%%B"
set "PATH=%SysPath%;%UserPath%"
exit /b 0
