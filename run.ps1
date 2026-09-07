Write-Host "=========================================" -ForegroundColor Green
Write-Host "Öğretmen Nöbet Çizelgesi Hazırlayıcı" -ForegroundColor Green
Write-Host "Sistem Kontrolü Başlatılıyor..." -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green

# Check Node.js
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "HATA: Node.js Sürümü Bulunamadı! Lütfen https://nodejs.org/ adresinden Node.js yükleyin." -ForegroundColor Red
    Exit
}
Write-Host "✓ Node.js Sürümü: $(node -v)" -ForegroundColor Cyan

# Check Rust / Cargo
$cargoPath = "$env:USERPROFILE\.cargo\bin"
if (!(Get-Command cargo -ErrorAction SilentlyContinue) -and !(Test-Path "$cargoPath\cargo.exe")) {
    Write-Host "HATA: Rust / Cargo yüklü değil! Tauri Rust derleyicisine ihtiyaç duyar." -ForegroundColor Red
    Exit
}
Write-Host "✓ Rust / Cargo Sürümü Mevcut." -ForegroundColor Cyan

# Update path in session if needed
if (!(Get-Command cargo -ErrorAction SilentlyContinue)) {
    $env:PATH += ";$cargoPath"
}

# Install dependencies
Write-Host "Bağımlılıklar yükleniyor/kontrol ediliyor..." -ForegroundColor Cyan
npm install

# Launch tauri dev
Write-Host "Uygulama Geliştirici Modunda Başlatılıyor..." -ForegroundColor Green
npm run tauri dev
