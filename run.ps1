# myaniform 서비스 런처 (Windows PowerShell)
# ComfyUI + FastAPI 백엔드 백그라운드 기동
# 사용: pwsh -File run.ps1  (또는 .\run.ps1)
#
# 프로세스 종료: Stop-Process -Name python

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT

if (-not (Test-Path ".venv")) {
    Write-Host "ERR: .venv 없음. 먼저 .\setup.ps1 실행"
    exit 1
}

# venv 활성화
& ".\.venv\Scripts\Activate.ps1"

# logs 디렉토리
New-Item -ItemType Directory -Force -Path "logs" | Out-Null

# 기존 프로세스 종료 (ComfyUI + uvicorn)
Write-Host "[0/2] 기존 프로세스 종료"
Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" | ForEach-Object {
    $cmdline = $_.CommandLine
    if ($cmdline -and ($cmdline -match "ComfyUI\\main\.py" -or $cmdline -match "uvicorn backend\.main:app")) {
        Write-Host "  kill PID=$($_.ProcessId) — $($cmdline.Substring(0, [Math]::Min($cmdline.Length, 80)))"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Seconds 1

# ComfyUI 기동
Write-Host "[1/2] ComfyUI (:8188) 기동 — normalvram + cache-none + smart-memory off (누적 OOM 방지)"
$comfyArgs = @(
    "ComfyUI\main.py",
    "--port", "8188",
    "--normalvram",
    "--cache-none",
    "--disable-smart-memory",
    "--reserve-vram", "0.5"
)
$comfyProc = Start-Process -FilePath "python" `
    -ArgumentList $comfyArgs `
    -RedirectStandardOutput "logs\comfyui.log" `
    -RedirectStandardError "logs\comfyui.err.log" `
    -PassThru -WindowStyle Hidden
Write-Host "  PID=$($comfyProc.Id)  로그: logs\comfyui.log"

# 백엔드 기동
Write-Host "[2/2] FastAPI 백엔드 (:8000) 기동"
$backendArgs = @("-m", "uvicorn", "backend.main:app", "--port", "8000")
$backendProc = Start-Process -FilePath "python" `
    -ArgumentList $backendArgs `
    -RedirectStandardOutput "logs\backend.log" `
    -RedirectStandardError "logs\backend.err.log" `
    -PassThru -WindowStyle Hidden
Write-Host "  PID=$($backendProc.Id)  로그: logs\backend.log"

Write-Host ""
Write-Host "대기 중 (15초)..."
Start-Sleep -Seconds 15

Write-Host ""
try {
    $null = Invoke-WebRequest -Uri "http://127.0.0.1:8188/system_stats" -UseBasicParsing -TimeoutSec 3
    Write-Host "  ✔ ComfyUI OK"
} catch {
    Write-Host "  ✗ ComfyUI 실패 — Get-Content logs\comfyui.log -Tail 50"
}
try {
    $null = Invoke-WebRequest -Uri "http://127.0.0.1:8000/docs" -UseBasicParsing -TimeoutSec 3
    Write-Host "  ✔ 백엔드 OK"
} catch {
    Write-Host "  ✗ 백엔드 실패 — Get-Content logs\backend.log -Tail 50"
}
Write-Host ""
Write-Host "프런트: cd frontend; npm run dev"
