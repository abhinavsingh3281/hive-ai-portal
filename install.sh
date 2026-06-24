#!/usr/bin/env bash
# AISC installer for macOS / Linux
# Installs all prerequisites and starts the app.
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'

step()  { echo -e "\n${CYAN}  >> $*${RESET}"; }
ok()    { echo -e "${GREEN}     OK  $*${RESET}"; }
warn()  { echo -e "${YELLOW}  [!] $*${RESET}"; }
fail()  { echo -e "\n${RED}  [ERROR] $*${RESET}"; echo -e "${RED}  Fix the error above and re-run ./install.sh${RESET}"; exit 1; }

# ── Banner ────────────────────────────────────────────────────────────────────
clear
echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}  ║        AISC — Autonomous AI Software Company     ║${RESET}"
echo -e "${CYAN}  ║           macOS / Linux Installer                ║${RESET}"
echo -e "${CYAN}  ╚══════════════════════════════════════════════════╝${RESET}"
echo ""

# ── Consent ───────────────────────────────────────────────────────────────────
echo "  This installer will:"
echo "    1. Install Homebrew (macOS only, if not present)"
echo "    2. Install Node.js 22 LTS if not present"
echo "    3. Install pnpm if not present"
echo "    4. Pull and start a PostgreSQL 16 Docker container (port 5432)"
echo "    5. Create .env from .env.example (if .env does not exist)"
echo "    6. Install npm dependencies (pnpm install)"
echo "    7. Run database migrations"
echo "    8. Start the development servers (server + UI)"
echo ""
echo "  Requirements: Docker Desktop must already be installed and running."
echo "  Docs: https://docs.docker.com/get-docker/"
echo ""
echo -e "  Some steps require ${YELLOW}sudo${RESET} (you will be prompted by the OS)."
echo ""
read -rp "  Proceed with installation? [Y/N]: " consent
if [[ ! "$consent" =~ ^[Yy]$ ]]; then
    echo ""
    echo "  Installation cancelled."
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Detect OS ─────────────────────────────────────────────────────────────────
OS="$(uname -s)"

# ── 1. Homebrew (macOS only) ──────────────────────────────────────────────────
if [[ "$OS" == "Darwin" ]]; then
    step "Checking Homebrew..."
    if command -v brew &>/dev/null; then
        ok "Homebrew already installed"
    else
        step "Installing Homebrew (requires internet + sudo for Xcode tools)..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        # Add brew to PATH for Apple Silicon
        if [[ -f /opt/homebrew/bin/brew ]]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
        ok "Homebrew installed"
    fi
fi

# ── 2. Node.js ────────────────────────────────────────────────────────────────
step "Checking Node.js..."
if command -v node &>/dev/null; then
    NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
    if [[ "$NODE_MAJOR" -ge 20 ]]; then
        ok "Node.js $(node --version) already installed"
    else
        warn "Node.js $(node --version) found but version 20+ required — upgrading"
        if [[ "$OS" == "Darwin" ]]; then
            brew install node@22 && brew link --overwrite node@22
        else
            fail "Node.js 20+ required. Install from https://nodejs.org and re-run."
        fi
    fi
else
    step "Installing Node.js 22 LTS..."
    if [[ "$OS" == "Darwin" ]]; then
        brew install node@22
        brew link --overwrite node@22
    elif [[ "$OS" == "Linux" ]]; then
        # Use NodeSource for Debian/Ubuntu
        if command -v apt-get &>/dev/null; then
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command -v yum &>/dev/null; then
            curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
            sudo yum install -y nodejs
        else
            fail "Could not detect package manager. Install Node.js 20+ from https://nodejs.org and re-run."
        fi
    fi
    ok "Node.js $(node --version) installed"
fi

# ── 3. pnpm ───────────────────────────────────────────────────────────────────
step "Checking pnpm..."
if command -v pnpm &>/dev/null; then
    ok "pnpm $(pnpm --version) already installed"
else
    step "Installing pnpm..."
    npm install -g pnpm
    ok "pnpm $(pnpm --version) installed"
fi

# ── 4. Docker ─────────────────────────────────────────────────────────────────
step "Checking Docker..."
if ! command -v docker &>/dev/null; then
    fail "Docker is not installed. Install Docker Desktop from https://docs.docker.com/get-docker/ and re-run."
fi
if ! docker info &>/dev/null; then
    fail "Docker is not running. Start Docker Desktop and re-run this script."
fi
ok "Docker is running"

# ── 5. PostgreSQL container ───────────────────────────────────────────────────
step "Setting up PostgreSQL container..."
if docker ps -a --format "{{.Names}}" | grep -q "^aisc-postgres$"; then
    if docker ps --format "{{.Names}}" | grep -q "^aisc-postgres$"; then
        ok "aisc-postgres container already running"
    else
        docker start aisc-postgres
        ok "aisc-postgres container started"
    fi
else
    docker run -d \
        --name aisc-postgres \
        -p 5432:5432 \
        -e POSTGRES_DB=aisc \
        -e POSTGRES_USER=postgres \
        -e POSTGRES_PASSWORD=postgres \
        postgres:16
    ok "aisc-postgres container created and started"
fi

step "Waiting for PostgreSQL to be ready..."
attempts=0
until docker exec aisc-postgres pg_isready -U postgres &>/dev/null; do
    sleep 2
    attempts=$((attempts + 1))
    if [[ $attempts -ge 20 ]]; then
        fail "PostgreSQL did not become ready. Check logs: docker logs aisc-postgres"
    fi
done
ok "PostgreSQL is ready"

# ── 6. .env ───────────────────────────────────────────────────────────────────
step "Configuring environment..."
if [[ ! -f ".env" ]]; then
    cp .env.example .env
    # Set DATABASE_URL with credentials
    sed -i.bak "s|DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aisc|" .env
    # Set a random JWT secret
    JWT_VAL=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48 || true)
    sed -i.bak "s|JWT_SECRET=.*|JWT_SECRET=${JWT_VAL}|" .env
    rm -f .env.bak
    ok ".env created from .env.example"
else
    ok ".env already exists — skipping (edit it manually if needed)"
fi

# Warn if DATABASE_URL is missing credentials
if ! grep -qE "DATABASE_URL=postgresql://[^:]+:[^@]+@" .env; then
    warn "DATABASE_URL in .env may be missing credentials. Expected format:"
    warn "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aisc"
fi

# ── 7. pnpm install ───────────────────────────────────────────────────────────
step "Installing dependencies (pnpm install)..."
pnpm install
ok "Dependencies installed"

# ── 8. Migrations ─────────────────────────────────────────────────────────────
step "Running database migrations..."
export DATABASE_URL
DATABASE_URL=$(grep "^DATABASE_URL=" .env | cut -d= -f2-)
pnpm db:migrate
ok "Migrations applied"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}  ╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}  ║              Installation complete!              ║${RESET}"
echo -e "${GREEN}  ╠══════════════════════════════════════════════════╣${RESET}"
echo -e "${GREEN}  ║  Dashboard  →  http://localhost:5173             ║${RESET}"
echo -e "${GREEN}  ║  API server →  http://localhost:3100             ║${RESET}"
echo -e "${GREEN}  ║  API docs   →  http://localhost:3100/docs        ║${RESET}"
echo -e "${GREEN}  ╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "${CYAN}  Starting dev servers...${RESET}"
echo -e "  (Press Ctrl+C to stop)\n"

pnpm dev:all
