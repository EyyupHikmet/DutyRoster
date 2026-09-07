/**
 * WCAG 2.1 Color Contrast Checker Utility
 * Usage: node scripts/check_contrast.js <hexColor1> <hexColor2>
 * Example: node scripts/check_contrast.js #0f6266 #fbfbf9
 */

function hexToRgb(hex) {
  // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function getRelativeLuminance(r, g, b) {
  const [R, G, B] = [r, g, b].map(c => {
    const sRGB = c / 255;
    return sRGB <= 0.03928 
      ? sRGB / 12.92 
      : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function getContrastRatio(l1, l2) {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("\n❌ Hata: Lütfen iki adet HEX renk kodu girin!");
    console.log("Kullanım: node scripts/check_contrast.js <renk1> <renk2>");
    console.log("Örnek: node scripts/check_contrast.js #0f6266 #fbfbf9\n");
    process.exit(1);
  }

  const hex1 = args[0];
  const hex2 = args[1];

  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);

  if (!rgb1 || !rgb2) {
    console.error("❌ Hata: Geçersiz HEX renk kodu formatı! (Örn: #0f6266)");
    process.exit(1);
  }

  const l1 = getRelativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getRelativeLuminance(rgb2.r, rgb2.g, rgb2.b);

  const ratio = getContrastRatio(l1, l2);

  console.log("\n=========================================");
  console.log("       WCAG RENK KONTRAST RAPORU         ");
  console.log("=========================================");
  console.log(`Renk 1 (HEX): ${hex1} -> RGB(${rgb1.r}, ${rgb1.g}, ${rgb1.b}) [Luminance: ${l1.toFixed(4)}]`);
  console.log(`Renk 2 (HEX): ${hex2} -> RGB(${rgb2.r}, ${rgb2.g}, ${rgb2.b}) [Luminance: ${l2.toFixed(4)}]`);
  console.log("-----------------------------------------");
  console.log(`KONTRAST ORANI: ${ratio.toFixed(2)}:1`);
  console.log("-----------------------------------------");

  // WCAG Compliance evaluations
  const aaNormal = ratio >= 4.5;
  const aaLarge = ratio >= 3.0;
  const aaaNormal = ratio >= 7.0;
  const aaaLarge = ratio >= 4.5;

  console.log(`WCAG AA (Normal Metin - En az 4.5:1):  ${aaNormal ? "✅ UYGUN" : "❌ BAŞARISIZ"}`);
  console.log(`WCAG AA (Büyük Metin  - En az 3.0:1):  ${aaLarge ? "✅ UYGUN" : "❌ BAŞARISIZ"}`);
  console.log(`WCAG AAA (Normal Metin - En az 7.0:1): ${aaaNormal ? "✅ UYGUN" : "❌ BAŞARISIZ"}`);
  console.log(`WCAG AAA (Büyük Metin  - En az 4.5:1): ${aaaLarge ? "✅ UYGUN" : "❌ BAŞARISIZ"}`);
  console.log("=========================================\n");
}

main();
