# 📚 UniNotes — Backend

Üniversite öğrencileri için **davetiyeli, yazım toleranslı arama destekli, hibrit OCR/Vision işlemeli, yapay zeka özetlemeli ve hiyerarşik klasörleme mimarili** ortak ders notu arşivi.

Frontend bu API'ye bağlanır → öğrenciler PDF/fotoğraf yükler → sistem arka planda metni çıkarır → yapay zeka ile özetler → klasörlerle organize edilir → herkes tüm notlar arasında yazım toleranslı arama yapabilir.

---

## ✨ Özellikler

| Özellik | Nasıl Çalışıyor? |
| :--- | :--- |
| **Davet Kodlu Kayıt** | Sadece yöneticinin ürettiği tek kullanımlık hex kodlarıyla üye olunabilir. Brute-force koruması aktif (`express-rate-limit`). |
| **Hibrit Metin Çıkarma (OCR & Vision)** | PDF'ler ve görseller (JPG, PNG, WebP) BullMQ kuyruğuna atılır. Görseller önce `tesseract.js` ile taranır, kalite kapısını (`isOcrQualityAcceptable`) geçemezse Gemini 3.6 Flash Vision modeline fallback yapar. PDF'ler ise önce dijital metin katmanı için ayrıştırılır; taranmış, el yazılı veya bozuk PDF'ler kalite kapısını (`isPdfAcceptable`) geçemezse doğrudan Gemini Vision multimodal analizine yönlendirilir. |
| **Yapay Zeka Destekli Özetleme** | Google Gemini 3.6 Flash entegrasyonu ile ders notları akademik asistan üslubuyla maddeler halinde özetlenir (`POST /documents/:id/summarize`). Üretilen özetler veritabanında önbelleğe alınır, tekrar eden isteklerde maliyetsiz ve anlık döner. |
| **Kullanıcı Bazlı Rate Limiting** | AI özetleme endpoint'i kullanıcı ID (`req.user.id`) bazında 10 dakikada en fazla 5 istek ile sınırlandırılmıştır (`429 Too Many Requests`). Önbellekteki (`cached: true`) dokümanlar bu kotayı tüketmez ve limit dolsa dahi erişilebilir. |
| **Hiyerarşik Klasör Yönetimi** | Kök dizin veya sonsuz derinlikte iç içe klasör yapısı. Döngüsel bağımlılık koruması (cycle detection) sayesinde bir klasör kendisinin veya alt klasörlerinin içine taşınamaz. |
| **Kademeli (Cascade) Silme & Kilit Koruması** | Bir klasör silindiğinde PostgreSQL **Recursive CTE** sorgusuyla o klasör ve keyfi derinlikteki tüm alt klasörleri/dosyaları tek transaction'da temizlenir. Eğer alt ağaçta kilitli (`isLocked: true`) tek bir doküman bile varsa işlem atomik olarak iptal edilir. R2 üzerindeki fiziksel dosyalar da eşzamanlı silinir. |
| **Doküman Kilitleme** | Dosya sahipleri notlarını kilitleyebilir (`PATCH /documents/:id/lock`). Kilitli dokümanlar silinemez ve başkaları tarafından taşınamaz. |
| **Yazım Toleranslı Arama** | PostgreSQL `pg_trgm` + `unaccent` eklentileriyle `WORD_SIMILARITY` tabanlı fuzzy search. `matematk` → `matematik`, `seker` → `şeker` gibi yazım hataları ve Türkçe karakter varyasyonları bulunur. |
| **Ortak Arşiv** | Tüm kullanıcılar tüm notları görebilir ve arayabilir. Silme yetkisi yalnızca dosya sahibindedir. |
| **Dosya Deduplication** | SHA-256 hash kontrolü ile aynı dosyanın tekrar yüklenmesi engellenir (`409 Conflict`). |
| **Backend Proxy Stream** | Dosyalar Cloudflare R2'den backend üzerinden sunulur; `r2.dev` domain engellemelerinden etkilenmez. |
| **Global Hata Yönetimi** | Express 5 uyumlu merkezi `AppError` ve error middleware yapısı. Operasyonel 4xx hatalarında temiz JSON yanıtlar dönerken, 500 hatalarında hassas veriler maskelenir ve terminalde loglanır. |

---

## 🏗️ Mimari

```
src/
├── app.ts                       # Express uygulaması, CORS, global error middleware
├── server.ts                    # HTTP sunucusu + OCR Worker başlatma
├── errors/
│   └── AppError.ts              # Özel HTTP hata sınıfı (statusCode, message)
├── middlewares/
│   ├── auth.middleware.ts       # JWT doğrulama (Bearer token)
│   └── rateLimiter.ts           # Brute-force & AI Kota Limitleyicileri (register, login, summarize)
├── routes/
│   ├── auth.routes.ts           # POST /auth/register, POST /auth/login
│   ├── document.routes.ts       # Yükleme, arama, kilitleme, özetleme, stream ve silme
│   └── folder.routes.ts         # Klasör oluşturma, listeleme, taşıma (cycle guard) ve cascade silme (CTE)
├── schemas/
│   └── auth.schema.ts           # Zod doğrulama şemaları
├── services/
│   ├── s3.service.ts            # Cloudflare R2 (S3 uyumlu) upload/delete/get
│   ├── ai/                      # Merkezi AI altyapısı (Vision OCR & Summarization)
│   │   ├── gemini.client.ts     # GoogleGenAI Client (gemini-3.6-flash)
│   │   └── gemini.service.ts    # extractTextFromImage, summarizeText
│   └── ocr/                     # OCR Motorları ve Heuristic Kalite Kapısı
│       ├── ocr.types.ts
│       ├── qualityGate.ts
│       ├── tesseract.provider.ts
│       └── gemini.provider.ts
├── prisma/
│   ├── contract.prisma          # Veritabanı şeması (User, Document, Folder, InviteCode)
│   ├── db.ts                    # Prisma v8 client + pg Connection Pool
│   └── seed.ts                  # Başlangıç davet kodları üretimi
└── worker/
    └── ocr.worker.ts            # BullMQ Worker — Hibrit PDF ve görsel metin çıkarma
```

---

## 🛠️ Tech Stack

| Katman | Teknoloji |
| :--- | :--- |
| **Runtime** | Node.js + TypeScript |
| **Framework** | Express.js v5 (Async Native Error Handling) |
| **ORM** | Prisma v8 (Early Access) |
| **Veritabanı** | PostgreSQL (Supabase) + `pg_trgm` + `unaccent` + Recursive CTE |
| **Kuyruk** | Redis (Upstash) + BullMQ |
| **Yapay Zeka (AI)** | Google Gemini 3.6 Flash (`@google/genai`) |
| **Depolama** | Cloudflare R2 (S3 uyumlu) |
| **Auth** | JWT + bcryptjs |
| **Rate Limiting** | express-rate-limit (User-scoped & IP fallback) |
| **Test** | Vitest (Testcontainers + Docker) — 97 Test |
| **Hosting** | Render / Railway |

---

## 🚀 Kurulum

### 1. Klonla ve bağımlılıkları kur
```bash
git clone https://github.com/mehmetturuncx/uninotes-backend.git
cd uninotes-backend
npm install
```

### 2. Ortam değişkenlerini ayarla
```bash
cp .env.example .env
# .env dosyasını aç ve bilgileri doldur
```

### 3. Veritabanını hazırla
```bash
npm run contract:emit
npx prisma db init
```

### 4. Davet kodlarını üret
```bash
npm run seed
# Konsola 5 adet tek kullanımlık davet kodu düşecektir
```

### 5. Çalıştır
```bash
npm run start
# Sunucu http://localhost:3000 adresinde ayağa kalkar
```

---

## 📡 API Uç Noktaları

### 🔑 Kimlik Doğrulama (Auth)
| Method | Endpoint | Açıklama | Auth |
| :--- | :--- | :--- | :---: |
| `POST` | `/auth/register` | Davet kodu ile kayıt (Max 5/15dk) | ✗ |
| `POST` | `/auth/login` | E-posta / şifre ile giriş (Max 10/15dk) | ✗ |

### 📂 Klasör Yönetimi (Folders)
| Method | Endpoint | Açıklama | Auth |
| :--- | :--- | :--- | :---: |
| `POST` | `/folders` | Yeni klasör oluştur (`name`, opsiyonel `parentId`) | ✓ |
| `GET` | `/folders` | Tüm klasörleri düz liste olarak getir | ✓ |
| `PATCH` | `/folders/:id` | Klasörü yeniden adlandır veya taşı (döngü korumalı) | ✓ |
| `DELETE` | `/folders/:id` | Klasörü ve alt içeriğini kademeli sil (Recursive CTE) | ✓ |

### 📄 Doküman Yönetimi (Documents)
| Method | Endpoint | Açıklama | Auth |
| :--- | :--- | :--- | :---: |
| `GET` | `/documents` | Notları listele (opsiyonel `?folderId=uuid` veya `?folderId=root`) | ✓ |
| `POST` | `/documents/upload` | PDF veya fotoğraf yükle (max 20MB, opsiyonel `folderId`) | ✓ |
| `GET` | `/documents/search?q=` | Yazım toleranslı arama (başlık ve OCR metni) | ✓ |
| `GET` | `/documents/:id/file` | Dosyayı tarayıcıda aç (proxy stream) | ✗ |
| `POST` | `/documents/:id/summarize` | AI ile özetle (Max 5/10dk, önbellek muafiyeti) | ✓ |
| `PATCH` | `/documents/:id/lock` | Belgeyi kilitle / kilidini aç (`isLocked: boolean`) | ✓ |
| `PATCH` | `/documents/:id/folder` | Belgenin klasörünü değiştir (`folderId: uuid | null`) | ✓ |
| `DELETE` | `/documents/:id` | Dosyayı kalıcı sil (sadece yükleyen kullanıcı) | ✓ |

---

## 🔒 Güvenlik & Güvenilirlik

- **JWT (1 saat ömür):** Tüm korumalı uçlarda `Authorization: Bearer <token>` zorunlu.
- **Kullanıcı Bazlı Rate Limiting:**
  - Kayıt: 15 dk'da max 5 başarısız deneme.
  - Giriş: 15 dk'da max 10 başarısız deneme.
  - AI Özetleme: Kullanıcı başına 10 dk'da max 5 taze özetleme isteği.
- **Sahiplik & Kilit Koruması:**
  - `DELETE /documents/:id`: Yalnızca belge sahibi silebilir (`403 Forbidden`).
  - `PATCH /documents/:id/folder`: Kilitli dokümanlar başkası tarafından taşınamaz (`403 Forbidden`).
  - `DELETE /folders/:id`: Alt ağaçta kilitli tek bir belge bile varsa klasör silme işlemi iptal edilir (`400 Bad Request`).
- **Döngüsel Bağımlılık Koruması (Cycle Detection):** Bir klasörün kendisinin veya alt klasörlerinin altına taşınması engellenir.
- **Hash Deduplication:** Aynı dosyanın tekrar yüklenmesi SHA-256 ile engellenir (`409 Conflict`).
- **Connection Leak Koruması:** Transaction ve pool client bağlantılarında `try/finally { client.release(); }` garantisi.

---

## 👥 Ekip

| Rol | Kim |
| :--- | :--- |
| **Backend** | [@mehmetturuncx](https://github.com/mehmetturuncx) |
| **Frontend** | [@enesKAYA16](https://github.com/EnesKAYA16) |

---

*Mentorship & Pair-Programming ile Antigravity Agent (Google) tarafından TDD süreçleri izlenerek geliştirilmiştir.*
