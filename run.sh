#!/bin/bash
# Teacher Duty Scheduler - Startup Script

echo "========================================="
echo "Öğretmen Nöbet Çizelgesi Hazırlayıcı"
echo "Sistem Kontrolü Başlatılıyor..."
echo "========================================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "HATA: Node.js yüklü değil! Lütfen yükleyin: https://nodejs.org/"
    exit 1
fi
echo "✓ Node.js Sürümü: $(node -v)"

# Check Rust / Cargo
if ! command -v cargo &> /dev/null && ! [ -f "$HOME/.cargo/bin/cargo" ]; then
    echo "HATA: Rust / Cargo yüklü değil! Lütfen yükleyin."
    exit 1
fi
echo "✓ Rust / Cargo Mevcut."

# Append Cargo to PATH if needed
if ! command -v cargo &> /dev/null; then
    export PATH="$PATH:$HOME/.cargo/bin"
fi

# Ensure dependencies
echo "Bağımlılıklar kontrol ediliyor..."
npm install

# Start app in hot-reload development mode
echo "Uygulama başlatılıyor (Geliştirici Modu)..."
npm run tauri dev
