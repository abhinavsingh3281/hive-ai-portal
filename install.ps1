#Requires -Version 5.1
<#
.SYNOPSIS
    AISC installer for Windows — installs all prerequisites and starts the app.
.DESCRIPTION
    Installs Node.js, pnpm, starts PostgreSQL via Docker, configures the
    environment, runs database migrations, and launches the dev server.
    Requires administrator privileges (will prompt for UAC elevation).
#>

# ── Re-launch as Administrator if not already ────────────────────────────────
if (-NOT ([Security.Principal.WindowsPrincipal]
          [Security.Principal.WindowsIdentity]::GetCurrent()
         ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Requesting administrator privileges..." -ForegroundColor Yellow
    Start-Process powershell.exe `
        "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" `
        -Verb RunAs
    exit
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Banner ────────────────────────────────────────────────────────────────────
Clear-Host
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║        AISC — Autonomous AI Software Company     ║" -ForegroundColor Cyan
Write-Host "  ║              Windows Installer                   ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Consent ───────────────────────────────────────────────────────────────────
Write-Host "  This installer will:" -ForegroundColor White
Write-Host "    1. Install Node.js 22 LTS (via winget) if not present"
Write-Host "    2. Install pnpm (via npm) if not present"
Write-Host "    3. Pull and start a PostgreSQL 16 Docker container (port 5432)"
Write-Host "    4. Create .env from .env.example (if .env does not exist)"
Write-Host "    5. Install npm dependencies (pnpm install)"
Write-Host "    6. Run database migrations"
Write-Host "    7. Start the development servers (server + UI)"
Write-Host ""
Write-Host "  Requirements: Docker Desktop must already be installed and running."
Write-Host "  Docs: https://docs.docker.com/get-docker/"
Write-Host ""
$consent = Read-Host "  Proceed with installation? [Y/N]"
if ($consent -notmatch "^[Yy]$") {
    Write-Host "`n  Installation cancelled." -ForegroundColor Yellow
    exit 0
}
Write-Host ""

# ── Helper ───────────────────────────────────────────────────────────────────
function Step($msg) {
    Write-Host "  >> $msg" -ForegroundColor Cyan
}
function Ok($msg) {
    Write-Host "     OK  $msg" -ForegroundColor Green
}
function Warn($msg) {
    Write-Host "  [!] $msg" -ForegroundColor Yellow
}
function Fail($msg) {
    Write-Host "`n  [ERROR] $msg" -ForegroundColor Red
    Write-Host "  Installation failed. Fix the error above and re-run install.ps1." -ForegroundColor Red
    Read-Host "`n  Press Enter to close"
    exit 1
}

# ── Refresh PATH in current session ──────────────────────────────────────────
function RefreshPath {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
}

# ── 1. Node.js ────────────────────────────────────────────────────────────────
Step "Checking Node.js..."
try {
    $nodeVer = (node --version 2>$null)
    $nodeMajor = [int]($nodeVer -replace 'v(\d+).*','$1')
    if ($nodeMajor -ge 20) {
        Ok "Node.js $nodeVer already installed"
    } else {
        Warn "Node.js $nodeVer found but version 20+ required — upgrading"
        throw
    }
} catch {
    Step "Installing Node.js 22 LTS via winget..."
    try {
        winget install --id OpenJS.NodeJS.LTS --version "22.*" --silent --accept-source-agreements --accept-package-agreements
        RefreshPath
        Ok "Node.js installed"
    } catch {
        Fail "winget failed to install Node.js. Install manually from https://nodejs.org and re-run this script."
    }
}

# ── 2. pnpm ───────────────────────────────────────────────────────────────────
Step "Checking pnpm..."
try {
    $pnpmVer = (pnpm --version 2>$null)
    Ok "pnpm $pnpmVer already installed"
} catch {
    Step "Installing pnpm..."
    npm install -g pnpm | Out-Null
    RefreshPath
    Ok "pnpm installed"
}

# ── 3. Docker ─────────────────────────────────────────────────────────────────
Step "Checking Docker..."
try {
    docker info 2>$null | Out-Null
    Ok "Docker is running"
} catch {
    Fail "Docker is not running. Start Docker Desktop and re-run this script."
}

# ── 4. PostgreSQL container ───────────────────────────────────────────────────
Step "Setting up PostgreSQL container..."
$existing = docker ps -a --filter "name=aisc-postgres" --format "{{.Names}}" 2>$null
if ($existing -eq "aisc-postgres") {
    $running = docker ps --filter "name=aisc-postgres" --format "{{.Names}}" 2>$null
    if ($running -eq "aisc-postgres") {
        Ok "aisc-postgres container already running"
    } else {
        docker start aisc-postgres | Out-Null
        Ok "aisc-postgres container started"
    }
} else {
    docker run -d `
        --name aisc-postgres `
        -p 5432:5432 `
        -e POSTGRES_DB=aisc `
        -e POSTGRES_USER=postgres `
        -e POSTGRES_PASSWORD=postgres `
        postgres:16 | Out-Null
    Ok "aisc-postgres container created and started"
}

# Wait for Postgres to be ready
Step "Waiting for PostgreSQL to be ready..."
$attempts = 0
while ($attempts -lt 20) {
    $ready = docker exec aisc-postgres pg_isready -U postgres 2>$null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 2
    $attempts++
}
if ($attempts -ge 20) {
    Fail "PostgreSQL did not become ready in time. Check Docker logs: docker logs aisc-postgres"
}
Ok "PostgreSQL is ready"

# ── 5. .env ───────────────────────────────────────────────────────────────────
Step "Configuring environment..."
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-Not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    # Set required values
    (Get-Content ".env") `
        -replace "DATABASE_URL=.*", "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aisc" `
        -replace "JWT_SECRET=.*", "JWT_SECRET=$(New-Guid)" |
        Set-Content ".env"
    Ok ".env created from .env.example"
} else {
    Ok ".env already exists — skipping (edit it manually if needed)"
}

# Ensure DATABASE_URL has credentials
$envContent = Get-Content ".env" -Raw
if ($envContent -notmatch "DATABASE_URL=postgresql://\w+:\w+@") {
    Warn "DATABASE_URL in .env may be missing credentials. Expected format:"
    Warn "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aisc"
}

# ── 6. pnpm install ───────────────────────────────────────────────────────────
Step "Installing dependencies (pnpm install)..."
pnpm install
if ($LASTEXITCODE -ne 0) { Fail "pnpm install failed" }
Ok "Dependencies installed"

# ── 7. Migrations ─────────────────────────────────────────────────────────────
Step "Running database migrations..."
$dbUrl = (Get-Content ".env" | Where-Object { $_ -match "^DATABASE_URL=" }) -replace "DATABASE_URL=", ""
$env:DATABASE_URL = $dbUrl
pnpm db:migrate
if ($LASTEXITCODE -ne 0) { Fail "Database migrations failed" }
Ok "Migrations applied"

# ── 8. Launch ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║              Installation complete!              ║" -ForegroundColor Green
Write-Host "  ╠══════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║  Dashboard  →  http://localhost:5173             ║" -ForegroundColor Green
Write-Host "  ║  API server →  http://localhost:3100             ║" -ForegroundColor Green
Write-Host "  ║  API docs   →  http://localhost:3100/docs        ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Starting dev servers..." -ForegroundColor Cyan
Write-Host "  (Press Ctrl+C in this window to stop)" -ForegroundColor Gray
Write-Host ""

pnpm dev:all
