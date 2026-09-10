# DutyRoster

**Türkçe** · [English](README.en.md)

Öğretmen nöbet çizelgesini, her öğretmenin uygun olduğu günlere ve aylık nöbet
hedefine göre adil biçimde hazırlayan, tamamen çevrimdışı çalışan bir masaüstü
uygulaması. Hazırlanan çizelgeyi Excel'e aktarır. Tauri, React ve SQLite ile
geliştirilmiştir.

## Hangi sorunu çözüyor?

25-30 öğretmenli bir okulda, ayın her günü için kimin nöbetçi olacağına karar
vermek elle yapıldığında uzun süren ve yorucu bir iştir. Öğretmenlerin aylık
nöbet hedefleri vardır; tercih ettikleri günler, uygun oldukları günler ve hiç
nöbet tutamayacakları günler birbirinden farklıdır. Bunu elle yapmak hem zaman
alır hem de dengesiz çizelgeler ortaya çıkarır; elektronik tabloda yapmak ise
kuralların gerçekten uygulandığını garanti etmez.

DutyRoster ayı bir kısıt problemi olarak ele alır ve çözer. Geçerli bir çizelge
kurulamıyorsa bunun nedenini sade bir dille söyler — örneğin belirli bir salı
günü için uygun işaretlenmiş hiç öğretmen bulunmadığını.

## Özellikler

- **Kadro yönetimi** — öğretmen ekleyin, düzenleyin, silin; her biri için aylık
  nöbet hedefi ve kıdem/öncelik ağırlığı belirleyin. Kadro büyüklüğünde bir
  sınır yoktur.
- **Öğretmen bazında uygunluk takvimi** — her tarihi "tercih edilen", "uygun"
  veya "izinli" olarak işaretleyin.
- **Excel/CSV ile kadro içe aktarma**, böylece kadroyu her yıl yeniden
  yazmanız gerekmez. Ad, hedef saat ve kıdem sütunlarını içeren bir tablo
  kullanabileceğiniz gibi, yalnızca isimlerden oluşan tek sütunlu bir liste de
  yükleyebilirsiniz; bu durumda hedef saat ve kıdem varsayılan değerlerle
  doldurulur.
- **Dört farklı planlama yöntemi**: nöbetleri eşit dağıtma, kıdeme göre
  ağırlıklandırma, belirli öğretmenleri belirli günlere sabitleme, kalan
  günleri rastgele doldurma.
- **Aylık hedeflere kesin uyum** — istediğinizde hiçbir öğretmene aylık nöbet
  hedefinden fazla görev verilmemesini sağlayabilirsiniz. Kadro yetmezse günler
  boş bırakılır; boş kalan günler hem çizelge hazırlandığında bildirilir hem de
  Excel'e aktarmadan önce onayınız istenir.
- **Esnek ay yapısı** — varsayılan olarak hafta içi günler planlanır; hafta
  sonu ve tatil günlerini tek tıkla çizelgeye dahil edebilir veya çıkarabilir,
  istediğiniz güne farklı sayıda nöbetçi atayabilirsiniz.
- **Taslakların korunması** — bir ay için yaptığınız ayarlar, o ay için henüz
  çizelge oluşturmamış olsanız bile kaydedilir; kaydedilmemiş değişiklikleriniz
  varken başka bir aya geçmeden önce uyarılırsınız.
- **Excel'e aktarma** — dosyanın nereye kaydedileceğini siz seçersiniz, dosya
  adı sürüm numarasıyla önerilir ve kayıttan sonra dosyayı veya bulunduğu
  klasörü açma seçeneği sunulur.
- **Anlaşılır hata açıklamaları** — çizelge kurulamadığında hangi tarihte ve
  neden takılındığı açıkça belirtilir.
- **Tamamen çevrimdışı.** Hesap yok, sunucu yok, veri toplama yok. Bütün
  veriler bilgisayarınızdaki yerel bir SQLite dosyasında saklanır.

## Kurulum

Platformunuza uygun kurulum dosyasını
[Releases](https://github.com/EyyupHikmet/DutyRoster/releases) sayfasından
indirebilirsiniz:

- **Windows** — `.msi` veya `-setup.exe` dosyalarından biri yeterlidir; ikisi
  de aynı uygulamayı kurar.
- **macOS** — `.dmg` dosyası. Hem Apple Silicon hem de Intel Mac'lerde
  doğrudan çalışan evrensel (universal) bir derlemedir.

İki kurulum dosyası da dijital olarak imzalanmamıştır (bu, projenin henüz
sahip olmadığı ücretli bir sertifika gerektirir); bu yüzden her iki platformda
da uygulamayı ilk çalıştırdığınızda bir uyarı görürsünüz. Bu beklenen bir
durumdur — nasıl devam edeceğiniz ve isterseniz indirdiğiniz dosyayı nasıl
doğrulayabileceğiniz aşağıda anlatılıyor.

### "Windows bilgisayarınızı korudu" uyarısı

Kurulum dosyasını ilk çalıştırdığınızda Windows bu uyarıyı gösterir. Bazen
*"Microsoft Defender SmartScreen tanınmayan bir uygulamanın başlatılmasını
engelledi"* biçiminde de çıkabilir.

**Devam etmek için: _Ek bilgi_ → _Yine de çalıştır_.**

Bunun nedeni, kurulum dosyasının dijital olarak imzalanmamış olması; yani
Windows yayıncıyı tanımıyor. Bu bir virüs uyarısı değildir ve dosyada bir şey
bulunduğu anlamına gelmez — imzalanmamış her küçük proje, içeriği ne olursa
olsun bu mesajı alır.

### "DutyRoster dosyası bozuk, açılamıyor" uyarısı (macOS)

macOS bu uyarıyı (veya benzer bir metnini) gösterir, çünkü uygulama Apple
tarafından notarize edilmemiştir. Mesaj endişe verici görünse de dosyada
gerçekten bir sorun yoktur — macOS, internetten indirilen imzasız bir
uygulamayı çalıştırmayı reddediyor, hepsi bu.

**Bunu bir kereliğine Terminal'den düzeltmek için:**

```bash
xattr -cr /Applications/DutyRoster.app
```

Ardından uygulamayı normal şekilde açabilirsiniz. Bunun yerine daha yumuşak
bir *"Apple bunu doğrulayamadı..."* diyaloğu görürseniz, uygulamaya sağ
tıklayın (veya Control tuşuyla tıklayın), **Aç**'ı seçin ve açılan diyalogda
tekrar **Aç**'ı onaylayın — bu durumda Terminal'e gerek yoktur.

### İndirdiğiniz dosyayı doğrulama

Her sürümde bir `SHA256SUMS-windows.txt` ve bir `SHA256SUMS-macos.txt` dosyası
bulunur. İndirdiğinizi ilgili olanla karşılaştırın:

```powershell
# Windows (PowerShell)
Get-FileHash .\DutyRoster_0.3.0_x64-setup.exe -Algorithm SHA256
```

```bash
# macOS (Terminal)
shasum -a 256 DutyRoster_0.3.0_universal.dmg
```

Çıkan özet değeri ilgili `SHA256SUMS-*.txt` dosyasındaki satırla aynıysa,
indirdiğiniz dosya GitHub'ın etiketlenmiş kaynaktan derlediği dosyanın birebir
aynısıdır.

Uygulamayı kendiniz derlemek isterseniz aşağıdaki adımları izleyebilirsiniz.

## Kaynaktan derleme

**Gereksinimler**

| | |
|---|---|
| Node.js | 20 veya üzeri |
| Rust araç zinciri | kararlı sürüm, [rustup](https://rustup.rs) ile |
| WebView2 çalışma zamanı | yalnızca Windows; Windows 11'de hâlihazırda kuruludur |
| Xcode Command Line Tools | yalnızca macOS — `xcode-select --install` |

Uygulama kodunun neredeyse tamamı TypeScript olmasına rağmen Rust araç zinciri
gereklidir: Tauri, arayüzün çevresine yerel bir Rust katmanı derler.

```bash
npm install
npm run tauri dev     # uygulamayı çalıştırır
npm run tauri build   # kurulum dosyası üretir
```

Windows'ta `run.cmd` dosyasına çift tıklamanız da yeterlidir; gereksinimleri
kontrol edip uygulamayı başlatır. macOS ve Linux'ta aynı işi `run.sh` yapar.

> **Tek başına `npm run dev` yeterli değildir.** Bu komut arayüzü sıradan bir
> tarayıcıda çalıştırır; Tauri köprüsü bulunmadığı için veritabanı, dosya
> pencereleri ve Excel'e aktarma çalışmaz. Veri veya dosya işlemlerine dokunan
> her şeyin `npm run tauri dev` ile denenmesi gerekir.

Geliştirme Windows üzerinde yapıldı; artık macOS üzerinde de derlenip
çalıştırıldı ve test edildi. Tauri Linux'u da destekliyor ve kodda platforma
özel bir bölüm yok, ancak Linux henüz denenmedi — geri bildirimleriniz
memnuniyetle karşılanır.

## Testler

```bash
npm test              # vitest, kapsam raporuyla
npx tsc --noEmit      # tür denetimi
```

Testler çizelge motorunu, veri saklama katmanını, Excel yardımcılarını ve React
bileşenlerini kapsar. Tauri eklenti katmanı taklit edildiği için testler
masaüstü oturumu olmadan da çalışır.

## Nasıl çalışıyor?

Tasarım, veritabanı şeması ve çizelge motorunun çalışma biçimi için
[ARCHITECTURE.md](ARCHITECTURE.md); önemli teknik kararların gerekçeleri için
[docs/decisions/](docs/decisions/) dosyalarına bakabilirsiniz.

Bu belgeler İngilizcedir. Projede arayüz Türkçe, kod ve teknik belgeler ise
İngilizcedir; böylece Türkçe bilmeyen geliştiriciler de projeye katkıda
bulunabilir.

## Bu proje nasıl geliştirildi?

Bu depodaki kodun büyük bölümü, insan yönlendirmesi altında çalışan yapay zekâ
ajanları tarafından yazıldı. Her iş parçası kabul edilmeden önce bir kişi
tarafından tanımlandı, gözden geçirildi ve test edildi;
[docs/decisions/](docs/decisions/) altındaki tasarım kararları insan
kararlarıdır; uygulama yalnızca test verileriyle değil, gerçek bir okulun
kadrosuyla da çalıştırıldı.

Bu bilgi, ne kurduğunuzu ve neye katkıda bulunduğunuzu bilmeniz için burada.
Lisansı ya da projenin sürdürülmesini değiştirmez — sorunlar (issues) ve katkı
istekleri (pull request) bir kişi tarafından okunup yanıtlanır.

## Katkıda bulunma

Katkılara açıktır — [CONTRIBUTING.md](CONTRIBUTING.md) (İngilizce). Şu anda en
değerli katkı, uygulamaya çoklu dil desteği ekleyerek Türkçe dışındaki
dillerde de kullanılabilmesini sağlamaktır.

## Lisans

[MIT](LICENSE).
