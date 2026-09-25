# 📚 UniNotes — Backend

Üniversite öğrencileri için **davetiyeli, yazım toleranslı arama destekli, hibrit OCR/Vision işlemeli, yapay zeka özetlemeli, hiyerarşik klasörleme mimarili ve yönetici (admin) kontrollü** ortak ders notu arşivi.

Frontend bu API'ye bağlanır → öğrenciler PDF/fotoğraf yükler → sistem arka planda metni çıkarır → yapay zeka ile özetler → klasörlerle organize edilir → herkes tüm notlar arasında yazım toleranslı arama yapabilir → yöneticiler davet kodlarını üretir ve kilitli içeriklere müdahale edebilir.

---

## ✨ Özellikler

| Özellik | Nasıl Çalışıyor? |
| :--- | :--- |
| **Yönetici (Admin) & Bootstrapping** | Sisteme kaydolan ilk kullanıcı otomatik olarak yönetici (`isAdmin: true`) haklarını alır. Sonraki kayıtlar normal öğrenci olarak atanır. Admin yetkisi JWT payload'unda taşınır ve `adminMiddleware` ile korunur. |
| **Yönetici Davet Kodu Yönetimi** | Yöneticiler tekil veya toplu (`{ count: 1..100 }`) 6 haneli rastgele büyük harf hex formatında davet kodları üretebilir (`POST /admin/invites`) ve tüm kodların kullanım durumlarını listeleyebilir (`GET /admin/invites`). |
| **Admin Müdahale ve Güvenli Zorunlu Silme (Force Override)** | Adminler başkalarına ait dokümanları kilitleyebilir, taşıyabilir veya silebilir. Kilitli belge içeren bir klasör silinmek istendiğinde güvenlik gereği admin dahil herkes engellenir; ancak admin `DELETE /folders/:id?force=true` gönderirse kilit koruması atlanarak tüm alt ağaç atomik olarak silinir. |
| **Hibrit Metin Çıkarma (OCR & Vision)** | PDF'ler ve görseller (JPG, PNG, WebP) BullMQ kuyruğuna atılır. Görseller önce `tesseract.js` ile taranır, kalite kapısını (`isOcrQualityAcceptable`) geçemezse Gemini 3.6 Flash Vision modeline fallback yapar. PDF'ler ise önce dijital metin katmanı için ayrıştırılır; taranmış, el yazılı veya bozuk PDF'ler kalite kapısını (`isPdfAcceptable`) geçemezse doğrudan Gemini Vision multimodal analizine yönlendirilir. |
| **Yapay Zeka Destekli Özetleme** | Google Gemini 3.6 Flash entegrasyonu ile ders notları akademik asistan üslubuyla maddeler halinde özetlenir (`POST /documents/:id/summarize`). Üretilen özetler veritabanında önbelleğe alınır, tekrar eden isteklerde maliyetsiz ve anlık döner. |
| **Kullanıcı Bazlı Rate Limiting** | AI özetleme endpoint'i kullanıcı ID (`req.user.id`) bazında 10 dakikada en fazla 5 istek ile sınırlandırılmıştır (`429 Too Many Requests`). Önbellekteki (`cached: true`) dokümanlar bu kotayı tüketmez ve limit dolsa dahi erişilebilir. |
| **Hiyerarşik Klasör Yönetimi** | Kök dizin veya sonsuz derinlikte iç içe klasör yapısı. Döngüsel bağımlılık koruması (cycle detection) sayesinde bir klasör kendisinin veya alt klasörlerinin içine taşınamaz. |
| **Atomik Transaction & Kademeli (Cascade) Silme** | Bir klasör silindiğinde PostgreSQL **Recursive CTE** sorgusuyla o klasör ve alt ağacı bulunur. `BEGIN` / `COMMIT` / `ROLLBACK` transaction güvencesiyle veritabanı temizlenir. Veritabanı başarıyla commit edildikten sonra S3/R2 üzerindeki fiziksel dosyalar güvenle silinir. |
| **Doküman Kilitleme** | Dosya sahipleri veya adminler notları kilitleyebilir (`PATCH /documents/:id/lock`). Kilitli dokümanlar yetkisiz kullanıcılar tarafından silinemez ve taşınamaz. |
| **Yazım Toleranslı Arama** | PostgreSQL `pg_trgm` + `unaccent` eklentileriyle `WORD_SIMILARITY` tabanlı fuzzy search. `matematk` → `matematik`, `seker` → `şeker` gibi yazım hataları ve Türkçe karakter varyasyonları bulunur. |
| **Ortak Arşiv** | Tüm kullanıcılar tüm notları görebilir ve arayabilir. Silme yetkisi dosya sahibinde veya yöneticidedir. |
| **Dosya Deduplication** | SHA-256 hash kontrolü ile aynı dosyanın tekrar yüklenmesi engellenir (`409 Conflict`). |
| **Backend Proxy Stream** | Dosyalar Cloudflare R2'den backend üzerinden sunulur; `r2.dev` domain engellemelerinden etkilenmez. |
| **Merkezi AppError Mimarisi** | Express 5 uyumlu merkezi `AppError` ve global error middleware yapısı. Tüm controller operasyonel hataları standart `{ message }` JSON formatında döner; 500 hatalarında hassas veriler maskelenir ve terminalde loglanır. |

---

## 🏗️ Mimari

```
src/
├── app.ts                       # Express uygulaması, CORS, global error middleware
├── server.ts                    # HTTP sunucusu + OCR Worker başlatma
├── errors/
│   └── AppError.ts              # Özel HTTP hata sınıfı (statusCode, message)
├── middlewares/
│   ├── auth.middleware.ts       # JWT doğrulama (Bearer token, req.user payload)
│   ├── admin.middleware.ts      # Yönetici koruma guard'ı (403 Forbidden)
│   └── rateLimiter.ts           # Brute-force & AI Kota Limitleyicileri (register, login, summarize)
├── routes/
│   ├── admin.routes.ts          # POST /admin/invites, GET /admin/invites
│   ├── auth.routes.ts           # POST /auth/register, POST /auth/login
│   ├── document.routes.ts       # Yükleme, arama, kilitleme, özetleme, stream ve silme
│   └── folder.routes.ts         # Klasör oluşturma, listeleme, taşıma (cycle guard) ve cascade silme (CTE + Tx)
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
| **Framework** | Express.js v5 (Async Native Error Handling + AppError) |
| **ORM** | Prisma v8 (Early Access) |
| **Veritabanı** | PostgreSQL (Supabase) + `pg_trgm` + `unaccent` + Recursive CTE + Transactions |
| **Kuyruk** | Redis (Upstash) + BullMQ |
| **Yapay Zeka (AI)** | Google Gemini 3.6 Flash (`@google/genai`) |
| **Depolama** | Cloudflare R2 (S3 uyumlu) |
| **Auth & RBAC** | JWT + bcryptjs + Admin Bootstrapping |
| **Rate Limiting** | express-rate-limit (User-scoped & IP fallback) |
| **Test** | Vitest (Testcontainers + Docker) — 117 Test |
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
| `POST` | `/auth/register` | Davet kodu ile kayıt (İlk kullanıcı otomatik admin olur) | ✗ |
| `POST` | `/auth/login` | E-posta / şifre ile giriş (Token'da isAdmin bilgisi taşınır) | ✗ |

### 🛡️ Yönetici Paneli (Admin)
| Method | Endpoint | Açıklama | Auth |
| :--- | :--- | :--- | :---: |
| `POST` | `/admin/invites` | Tekil veya toplu (`{ count: 1..100 }`) 6 haneli hex davet kodu üret | Admin |
| `GET` | `/admin/invites` | Tüm davet kodlarını oluşturulma tarihi sıralı listele | Admin |

### 📂 Klasör Yönetimi (Folders)
| Method | Endpoint | Açıklama | Auth |
| :--- | :--- | :--- | :---: |
| `POST` | `/folders` | Yeni klasör oluştur (`name`, opsiyonel `parentId`) | ✓ |
| `GET` | `/folders` | Tüm klasörleri düz liste olarak getir | ✓ |
| `PATCH` | `/folders/:id` | Klasörü yeniden adlandır veya taşı (döngü korumalı) | ✓ |
| `DELETE` | `/folders/:id` | Klasörü ve alt içeriğini kademeli sil (Admin için opsiyonel `?force=true`) | ✓ |

### 📄 Doküman Yönetimi (Documents)
| Method | Endpoint | Açıklama | Auth |
| :--- | :--- | :--- | :---: |
| `GET` | `/documents` | Notları listele (opsiyonel `?folderId=uuid` veya `?folderId=root`) | ✓ |
| `POST` | `/documents/upload` | PDF veya fotoğraf yükle (max 20MB, opsiyonel `folderId`) | ✓ |
| `GET` | `/documents/search?q=` | Yazım toleranslı arama (başlık ve OCR metni) | ✓ |
| `GET` | `/documents/:id/file` | Dosyayı tarayıcıda aç (proxy stream) | ✗ |
| `POST` | `/documents/:id/summarize` | AI ile özetle (Max 5/10dk, önbellek muafiyeti) | ✓ |
| `PATCH` | `/documents/:id/lock` | Belgeyi kilitle / kilidini aç (Sahibi veya Admin) | ✓ |
| `PATCH` | `/documents/:id/folder` | Belgenin klasörünü değiştir (Kilitli belgeleri sahibi veya Admin taşıyabilir) | ✓ |
| `DELETE` | `/documents/:id` | Dosyayı kalıcı sil (Dosya sahibi veya Admin) | ✓ |

---

## 🔒 Güvenlik & Güvenilirlik

- **JWT (1 saat ömür):** Tüm korumalı uçlarda `Authorization: Bearer <token>` zorunlu.
- **Yönetici Kontrolü (`adminMiddleware`):** `/admin` rotaları ve admin müdahale işlemleri strictly admin kontrolü altındadır (`403 Forbidden`).
- **Kullanıcı Bazlı Rate Limiting:**
  - Kayıt: 15 dk'da max 5 deneme.
  - Giriş: 15 dk'da max 10 deneme.
  - AI Özetleme: Kullanıcı başına 10 dk'da max 5 taze özetleme isteği.
- **Sahiplik & Kilit Koruması:**
  - `DELETE /documents/:id`: Yalnızca belge sahibi veya Admin silebilir (`403 Forbidden`).
  - `PATCH /documents/:id/folder`: Kilitli dokümanlar sahibi veya Admin haricinde taşınamaz (`403 Forbidden`).
  - `DELETE /folders/:id`: Alt ağaçta kilitli tek bir belge bile varsa klasör silme işlemi iptal edilir (`400 Bad Request`). Sadece Admin `?force=true` parametresiyle bu korumayı aşabilir.
- **Veritabanı Transaction Güvencesi:** Klasör silme işlemleri PostgreSQL Transaction (`BEGIN`/`COMMIT`/`ROLLBACK`) bloğu altında çalışır; fiziksel S3 silme işlemleri sadece veritabanı başarıyla commit edildikten sonra tetiklenir.
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
