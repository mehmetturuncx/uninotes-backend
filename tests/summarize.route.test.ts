import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';

// Mock summarizeText
export const summarizeTextMock = vi.fn();
vi.mock('../src/services/ai/gemini.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/ai/gemini.service')>();
  return {
    ...actual,
    summarizeText: summarizeTextMock
  };
});

let app: any;
let db: any;

describe('Document Summarization API: POST /documents/:id/summarize', () => {
  beforeAll(async () => {
    app = (await import('../src/app')).default;
    db = (await import('../src/prisma/db')).db;
  });

  beforeEach(async () => {
    await db.orm.public.Document.where({}).delete();
    await db.orm.public.User.where({}).delete();
    await db.orm.public.InviteCode.where({}).delete();
    vi.clearAllMocks();
  });

  const getAuthToken = async (email: string, code: string) => {
    await db.orm.public.InviteCode.create({ code });
    const res = await request(app)
      .post('/auth/register')
      .send({ email, password: 'password123', inviteCode: code });
    return { token: res.body.token, user: res.body.user };
  };

  it('Token olmadan istek atıldığında 401 Unauthorized dönmeli', async () => {
    const response = await request(app).post('/documents/any-id/summarize');
    expect(response.status).toBe(401);
  });

  it('Var olmayan döküman ID si için 404 Not Found dönmeli', async () => {
    const { token } = await getAuthToken('sum1@uni.edu', 'SUM_CODE1');

    const response = await request(app)
      .post('/documents/non-existent-id/summarize')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });

  it('Önbellekte özet yoksa (Cache Miss): summarizeText çağrılmalı, veritabanına kaydedilmeli ve cached: false dönmeli', async () => {
    const { token, user } = await getAuthToken('sum2@uni.edu', 'SUM_CODE2');

    const doc = await db.orm.public.Document.create({
      title: 'Ders Notu 1.pdf',
      hash: 'hash-sum-1',
      size: 500,
      mimeType: 'application/pdf',
      userId: user.id,
      status: 'COMPLETED',
      textContent: 'Biyoloji dersinde hücre bölünmesi mitoz ve mayoz olmak üzere ikiye ayrılır.'
    });

    summarizeTextMock.mockResolvedValueOnce('## Biyoloji Özeti\n- Mitoz: Vücut hücreleri\n- Mayoz: Üreme hücreleri');

    const response = await request(app)
      .post(`/documents/${doc.id}/summarize`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      summary: '## Biyoloji Özeti\n- Mitoz: Vücut hücreleri\n- Mayoz: Üreme hücreleri',
      cached: false
    });

    // summarizeText fonksiyonunun dökümanın metniyle çağrıldığını doğrula
    expect(summarizeTextMock).toHaveBeenCalledTimes(1);
    expect(summarizeTextMock).toHaveBeenCalledWith(doc.textContent);

    // Veritabanında dökümanın summary alanının güncellendiğini doğrula
    const updatedDoc = await db.orm.public.Document.where({ id: doc.id }).first();
    expect(updatedDoc?.summary).toBe('## Biyoloji Özeti\n- Mitoz: Vücut hücreleri\n- Mayoz: Üreme hücreleri');
  });

  it('Önbellekte özet zaten varsa (Cache Hit): summarizeText çağrılmadan doğrudan DB deki özet ve cached: true dönmeli', async () => {
    const { token, user } = await getAuthToken('sum3@uni.edu', 'SUM_CODE3');

    const existingSummary = '## Önceden Kaydedilmiş Kimya Özeti\n- Periyodik tablo';
    const doc = await db.orm.public.Document.create({
      title: 'Kimya Notu.pdf',
      hash: 'hash-sum-2',
      size: 600,
      mimeType: 'application/pdf',
      userId: user.id,
      status: 'COMPLETED',
      textContent: 'Kimyasal bağlar kovalent ve iyonik bağlar olarak incelenir.',
      summary: existingSummary
    });

    const response = await request(app)
      .post(`/documents/${doc.id}/summarize`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      summary: existingSummary,
      cached: true
    });

    // Cache hit durumunda AI kesinlikle çağrılmamalı (0 maliyet)
    expect(summarizeTextMock).not.toHaveBeenCalled();
  });

  describe('Uç Durumlar (Ticket 03 Edge Cases)', () => {
    it('Döküman durumu COMPLETED değilse (örn: PENDING veya PROCESSING) 400 Bad Request dönmeli', async () => {
      const { token, user } = await getAuthToken('sum_pending@uni.edu', 'SUM_CODE_PEND');

      const doc = await db.orm.public.Document.create({
        title: 'Bekleyen Not.pdf',
        hash: 'hash-sum-pending',
        size: 500,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'PROCESSING',
        textContent: 'Henüz OCR devam ediyor...'
      });

      const response = await request(app)
        .post(`/documents/${doc.id}/summarize`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('message');
      expect(summarizeTextMock).not.toHaveBeenCalled();
    });

    it('Dökümanın textContent alanı boş veya 20 karakterden kısaysa 400 Bad Request dönmeli', async () => {
      const { token, user } = await getAuthToken('sum_short@uni.edu', 'SUM_CODE_SHORT');

      const doc = await db.orm.public.Document.create({
        title: 'Kisa Metin.pdf',
        hash: 'hash-sum-short',
        size: 500,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'COMPLETED',
        textContent: 'Kısa not' // < 20 karakter
      });

      const response = await request(app)
        .post(`/documents/${doc.id}/summarize`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('message');
      expect(summarizeTextMock).not.toHaveBeenCalled();
    });

    it('summarizeText API kesintisinde hata fırlatırsa 500 dönmeli ve veritabanı dökümanı bozulmamalı', async () => {
      const { token, user } = await getAuthToken('sum_err@uni.edu', 'SUM_CODE_ERR');

      const doc = await db.orm.public.Document.create({
        title: 'Hata Notu.pdf',
        hash: 'hash-sum-err',
        size: 500,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'COMPLETED',
        textContent: 'Bu döküman özetlenirken yapay zeka servisinde beklenmedik bir kesinti oluşacak.'
      });

      summarizeTextMock.mockRejectedValueOnce(new Error('Gemini API 503 Service Unavailable'));

      const response = await request(app)
        .post(`/documents/${doc.id}/summarize`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(500);

      // Veritabanındaki döküman sağlam kalmalı (summary null olarak kalmalı, veri silinmemeli)
      const docInDb = await db.orm.public.Document.where({ id: doc.id }).first();
      expect(docInDb).toBeDefined();
      expect(docInDb?.summary).toBeNull();
    });

    it('Döküman durumu FAILED ise 400 Bad Request ve başarısızlık mesajı dönmeli', async () => {
      const { token, user } = await getAuthToken('sum_failed@uni.edu', 'SUM_CODE_FAIL');

      const doc = await db.orm.public.Document.create({
        title: 'Bozuk Not.pdf',
        hash: 'hash-sum-failed',
        size: 500,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'FAILED',
        textContent: null
      });

      const response = await request(app)
        .post(`/documents/${doc.id}/summarize`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: 'Document processing failed. Cannot summarize.'
      });
      expect(summarizeTextMock).not.toHaveBeenCalled();
    });

    it('Arasında boşluklar olsa bile boşluksuz karakter sayısı 20 den azsa 400 Bad Request dönmeli', async () => {
      const { token, user } = await getAuthToken('sum_spaces@uni.edu', 'SUM_CODE_SPACES');

      const doc = await db.orm.public.Document.create({
        title: 'Bosluklu Not.pdf',
        hash: 'hash-sum-spaces',
        size: 500,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'COMPLETED',
        textContent: 'a  b  c  d  e  f  g  h' // 22 karakter ama sadece 8 harf
      });

      const response = await request(app)
        .post(`/documents/${doc.id}/summarize`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: 'Document has insufficient text to summarize.'
      });
      expect(summarizeTextMock).not.toHaveBeenCalled();
    });

    it('summarizeText boş metin dönerse 500 dönmeli ve DB ye boş summary kaydedilmemeli', async () => {
      const { token, user } = await getAuthToken('sum_empty@uni.edu', 'SUM_CODE_EMPTY');

      const doc = await db.orm.public.Document.create({
        title: 'Gecerli Not.pdf',
        hash: 'hash-sum-empty-gen',
        size: 500,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'COMPLETED',
        textContent: 'Geçerli uzunlukta bir ders notu metni ama AI boş döndü.'
      });

      summarizeTextMock.mockResolvedValueOnce('');

      const response = await request(app)
        .post(`/documents/${doc.id}/summarize`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(500);
      const docInDb = await db.orm.public.Document.where({ id: doc.id }).first();
      expect(docInDb?.summary).toBeNull();
    });
  });

  describe('Frontend & Yük Uç Senaryoları (Production Edge Cases)', () => {
    it('Frontend butona çift tıklama (Concurrent Requests): Eş zamanlı iki istekte sistem kilitlenmemeli ve ikisi de 200 dönmeli', async () => {
      const { token, user } = await getAuthToken('sum_concurrent@uni.edu', 'SUM_CODE_CONC');

      const doc = await db.orm.public.Document.create({
        title: 'Concurrent Notu.pdf',
        hash: 'hash-sum-concurrent',
        size: 800,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'COMPLETED',
        textContent: 'Bu ders notuna kullanıcı frontend üzerinden peş peşe iki kez tıklar.'
      });

      summarizeTextMock.mockResolvedValue('## Eşzamanlı Özet Sonucu');

      // Butona çift tıklama simülasyonu (aynı anda iki paralel HTTP isteği)
      const [res1, res2] = await Promise.all([
        request(app).post(`/documents/${doc.id}/summarize`).set('Authorization', `Bearer ${token}`),
        request(app).post(`/documents/${doc.id}/summarize`).set('Authorization', `Bearer ${token}`)
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body.summary).toBe('## Eşzamanlı Özet Sonucu');
      expect(res2.body.summary).toBe('## Eşzamanlı Özet Sonucu');
    });

    it('Ortak Kasa Mantığı: Notu yükleyen A kullanıcısı olsa bile B kullanıcısı özetletebilmeli ve C kullanıcısı cached alabilmeli', async () => {
      const { user: userA } = await getAuthToken('studentA@uni.edu', 'CODE_STU_A');
      const { token: tokenB } = await getAuthToken('studentB@uni.edu', 'CODE_STU_B');
      const { token: tokenC } = await getAuthToken('studentC@uni.edu', 'CODE_STU_C');

      // Öğrenci A notu yükler
      const doc = await db.orm.public.Document.create({
        title: 'Ortak Kasa Notu.pdf',
        hash: 'hash-shared-vault',
        size: 1000,
        mimeType: 'application/pdf',
        userId: userA.id,
        status: 'COMPLETED',
        textContent: 'Üniversite ortak kütüphanesindeki herkesin erişebildiği ders notu metni.'
      });

      summarizeTextMock.mockResolvedValueOnce('## Ortak Kasa Özeti');

      // Öğrenci B özetleme ister (Cache Miss -> DB ye kaydeder)
      const resB = await request(app)
        .post(`/documents/${doc.id}/summarize`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(resB.status).toBe(200);
      expect(resB.body.cached).toBe(false);

      // Öğrenci C aynı nota tıklar (Cache Hit -> 0 maliyetle DB den anında alır)
      const resC = await request(app)
        .post(`/documents/${doc.id}/summarize`)
        .set('Authorization', `Bearer ${tokenC}`);

      expect(resC.status).toBe(200);
      expect(resC.body.cached).toBe(true);
      expect(resC.body.summary).toBe('## Ortak Kasa Özeti');
    });

    it('XSS ve Özel Karakterler içeren not metni güvenle özetlenebilmeli ve DB ye kaydedilebilmeli', async () => {
      const { token, user } = await getAuthToken('sum_xss@uni.edu', 'SUM_CODE_XSS');

      const complexContent = 'Web Güvenliği dersi: <script>alert("xss")</script> && "SELECT * FROM users;" -- \' OR 1=1';
      const doc = await db.orm.public.Document.create({
        title: 'Guvenlik Notu.pdf',
        hash: 'hash-sum-xss',
        size: 500,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'COMPLETED',
        textContent: complexContent
      });

      summarizeTextMock.mockResolvedValueOnce('## Güvenlik Özeti\n- XSS ve SQLi prensipleri');

      const response = await request(app)
        .post(`/documents/${doc.id}/summarize`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(summarizeTextMock).toHaveBeenCalledWith(complexContent);
      
      const updated = await db.orm.public.Document.where({ id: doc.id }).first();
      expect(updated?.summary).toBe('## Güvenlik Özeti\n- XSS ve SQLi prensipleri');
    });

    it('Aşırı uzun / yoğun ders notunda (50.000+ karakter) sistem çökmeden özetleyebilmeli', async () => {
      const { token, user } = await getAuthToken('sum_huge@uni.edu', 'SUM_CODE_HUGE');

      // 50.000 karakterlik devasa ders notu simülasyonu
      const hugeText = 'Fizik 101 Mekanik ve Termodinamik Prensipleri Notu. '.repeat(1000);

      const doc = await db.orm.public.Document.create({
        title: 'Devasa Kitap Notu.pdf',
        hash: 'hash-sum-huge',
        size: 50000,
        mimeType: 'application/pdf',
        userId: user.id,
        status: 'COMPLETED',
        textContent: hugeText
      });

      summarizeTextMock.mockResolvedValueOnce('## Devasa Notun Kompakt Özeti');

      const response = await request(app)
        .post(`/documents/${doc.id}/summarize`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.summary).toBe('## Devasa Notun Kompakt Özeti');
      expect(summarizeTextMock).toHaveBeenCalledWith(hugeText);
    });

    it('Frontend URL enjeksiyonu veya geçersiz ID parametresinde çökmeden 404 dönmeli', async () => {
      const { token } = await getAuthToken('sum_param@uni.edu', 'SUM_CODE_PARAM');

      const maliciousIds = [
        '../../etc/passwd',
        "' OR '1'='1",
        '<script>alert(1)</script>'
      ];

      for (const badId of maliciousIds) {
        const response = await request(app)
          .post(`/documents/${encodeURIComponent(badId)}/summarize`)
          .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(404);
      }
    });

    describe('Rate Limiting (Ticket 01)', () => {
      it('Aynı kullanıcı 10 dakika içinde en fazla 5 özetleme yapabilmeli, 6. istekte 429 dönmeli ve diğer kullanıcı etkilenmemeli', async () => {
        const { token: tokenA, user: userA } = await getAuthToken('rl_user_a@uni.edu', 'RL_CODE_A');
        const { token: tokenB, user: userB } = await getAuthToken('rl_user_b@uni.edu', 'RL_CODE_B');

        summarizeTextMock.mockResolvedValue('## Test Özeti');

        // User A için 6 farklı işlenmiş belge oluştur
        const docsA = [];
        for (let i = 1; i <= 6; i++) {
          const doc = await db.orm.public.Document.create({
            title: `Not A ${i}.pdf`,
            hash: `hash-rl-a-${i}`,
            size: 200,
            mimeType: 'application/pdf',
            userId: userA.id,
            status: 'COMPLETED',
            textContent: `Bu doküman ${i} numaralı geçerli bir ders notu içeriğidir en az yirmi karakter.`
          });
          docsA.push(doc);
        }

        // User B için 1 belge oluştur
        const docB = await db.orm.public.Document.create({
          title: 'Not B.pdf',
          hash: 'hash-rl-b-1',
          size: 200,
          mimeType: 'application/pdf',
          userId: userB.id,
          status: 'COMPLETED',
          textContent: 'User B için geçerli bir ders notu içeriğidir en az yirmi karakter.'
        });

        // 1-5. istekler User A için başarılı olmalı (200 OK)
        for (let i = 0; i < 5; i++) {
          const res = await request(app)
            .post(`/documents/${docsA[i].id}/summarize`)
            .set('Authorization', `Bearer ${tokenA}`);

          expect(res.status).toBe(200);
        }

        // 6. istek User A için rate limit'e takılmalı (429 Too Many Requests)
        const res6 = await request(app)
          .post(`/documents/${docsA[5].id}/summarize`)
          .set('Authorization', `Bearer ${tokenA}`);

        expect(res6.status).toBe(429);
        expect(res6.body).toHaveProperty('message');
        expect(res6.body.message).toMatch(/çok fazla|too many/i);

        // Farklı bir kullanıcı (User B) sınırlandırılmamalı (User-scoped isolation)
        const resUserB = await request(app)
          .post(`/documents/${docB.id}/summarize`)
          .set('Authorization', `Bearer ${tokenB}`);

        expect(resUserB.status).toBe(200);
      });

      it('Önbellekte zaten özeti olan dokümanlar (cached) rate limit kotasını tüketmemeli ve limit dolduğunda bile 200 dönmeli (Ticket 02)', async () => {
        const { token, user } = await getAuthToken('rl_cached@uni.edu', 'RL_CODE_CACHED');

        summarizeTextMock.mockResolvedValue('## Taze Özet');

        // 1. Önceden özeti çıkarılmış bir doküman oluştur (summary dolu)
        const cachedDoc = await db.orm.public.Document.create({
          title: 'Zaten Ozetlenmis Not.pdf',
          hash: 'hash-rl-cached-0',
          size: 300,
          mimeType: 'application/pdf',
          userId: user.id,
          status: 'COMPLETED',
          textContent: 'Bu notun özeti önceden çıkarılmıştır en az yirmi karakter.',
          summary: '## Mevcut Önbellek Özeti'
        });

        // 2. Henüz özeti OLMAYAN 5 taze doküman oluştur
        const freshDocs = [];
        for (let i = 1; i <= 5; i++) {
          const doc = await db.orm.public.Document.create({
            title: `Taze Not ${i}.pdf`,
            hash: `hash-rl-fresh-${i}`,
            size: 200,
            mimeType: 'application/pdf',
            userId: user.id,
            status: 'COMPLETED',
            textContent: `Taze doküman ${i} içeriğidir ve en az yirmi karakterden oluşur.`
          });
          freshDocs.push(doc);
        }

        // 3. Kullanıcı 10 kez cached dokümana istek atsın (kotayı tüketmemeli!)
        for (let i = 0; i < 10; i++) {
          const cachedRes = await request(app)
            .post(`/documents/${cachedDoc.id}/summarize`)
            .set('Authorization', `Bearer ${token}`);

          expect(cachedRes.status).toBe(200);
          expect(cachedRes.body.cached).toBe(true);
          expect(cachedRes.body.summary).toBe('## Mevcut Önbellek Özeti');
        }

        // 4. Şimdi 5 taze dokümanı özetlesin (tüm 5 hakkını kullansın)
        for (let i = 0; i < 5; i++) {
          const freshRes = await request(app)
            .post(`/documents/${freshDocs[i].id}/summarize`)
            .set('Authorization', `Bearer ${token}`);

          expect(freshRes.status).toBe(200);
          expect(freshRes.body.cached).toBe(false);
        }

        // 5. 6. taze doküman oluştur ve özetlemeyi dene -> 429 Too Many Requests almalı!
        const extraDoc = await db.orm.public.Document.create({
          title: 'Fazla Not.pdf',
          hash: 'hash-rl-fresh-extra',
          size: 200,
          mimeType: 'application/pdf',
          userId: user.id,
          status: 'COMPLETED',
          textContent: 'Fazla doküman içeriğidir ve en az yirmi karakterden oluşur.'
        });

        const blockedRes = await request(app)
          .post(`/documents/${extraDoc.id}/summarize`)
          .set('Authorization', `Bearer ${token}`);

        expect(blockedRes.status).toBe(429);

        // 6. Kullanıcının taze özet kotası dolmuş olmasına rağmen, cached dokümana hala erişebilmeli!
        const stillAccessibleRes = await request(app)
          .post(`/documents/${cachedDoc.id}/summarize`)
          .set('Authorization', `Bearer ${token}`);

        expect(stillAccessibleRes.status).toBe(200);
        expect(stillAccessibleRes.body.cached).toBe(true);
        expect(stillAccessibleRes.body.summary).toBe('## Mevcut Önbellek Özeti');
      });
    });
  });
});
