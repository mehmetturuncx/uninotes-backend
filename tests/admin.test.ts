import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/services/s3.service', () => ({
  uploadFile: vi.fn().mockResolvedValue('https://mock-s3-bucket.s3.amazonaws.com/test-doc.pdf'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getFile: vi.fn().mockResolvedValue(Buffer.from('dummy'))
}));

let app: any;
let db: any;

describe('Admin System: Ticket 01 (Schema, Bootstrapping & Middleware)', () => {
  beforeAll(async () => {
    app = (await import('../src/app')).default;
    db = (await import('../src/prisma/db')).db;
  });

  beforeEach(async () => {
    const { getPool } = await import('../src/prisma/db');
    await getPool().query('TRUNCATE TABLE "folder", "document", "user", "inviteCode" CASCADE;');
  });

  const createInvite = async (code: string) => {
    return await db.orm.public.InviteCode.create({ code });
  };

  it('Veritabanında hiç kullanıcı yokken ilk kaydolan kullanıcı otomatik olarak admin (isAdmin = true) olmalı', async () => {
    await createInvite('INV-ADMIN-1');

    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'first_user_admin@uni.edu',
        password: 'password123',
        inviteCode: 'INV-ADMIN-1'
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('isAdmin', true);

    // Veritabanı doğrulaması
    const userInDb = await db.orm.public.User.where({ email: 'first_user_admin@uni.edu' }).first();
    expect(userInDb?.isAdmin).toBe(true);

    // JWT token payload doğrulaması
    const secret = process.env.JWT_SECRET || 'default_secret';
    const decoded = jwt.verify(res.body.token, secret) as any;
    expect(decoded).toHaveProperty('isAdmin', true);
  });

  it('Sistemde kullanıcı varken kaydolan sonraki kullanıcılar normal kullanıcı (isAdmin = false) olmalı', async () => {
    await createInvite('INV-ADMIN-1');
    await createInvite('INV-USER-2');

    // İlk kullanıcı (Admin)
    await request(app)
      .post('/auth/register')
      .send({
        email: 'admin_user@uni.edu',
        password: 'password123',
        inviteCode: 'INV-ADMIN-1'
      });

    // İkinci kullanıcı (Normal Öğrenci)
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'regular_user@uni.edu',
        password: 'password123',
        inviteCode: 'INV-USER-2'
      });

    expect(res.status).toBe(201);
    expect(res.body.user).toHaveProperty('isAdmin', false);

    const userInDb = await db.orm.public.User.where({ email: 'regular_user@uni.edu' }).first();
    expect(userInDb?.isAdmin).toBe(false);

    const secret = process.env.JWT_SECRET || 'default_secret';
    const decoded = jwt.verify(res.body.token, secret) as any;
    expect(decoded).toHaveProperty('isAdmin', false);
  });

  it('Login olan kullanıcının token payloadında güncel isAdmin bilgisi yer almalı', async () => {
    await createInvite('INV-LOGIN-1');

    // İlk kullanıcı (Admin) kaydoluyor
    await request(app)
      .post('/auth/register')
      .send({
        email: 'login_admin@uni.edu',
        password: 'password123',
        inviteCode: 'INV-LOGIN-1'
      });

    // Login isteği
    const loginRes = await request(app)
      .post('/auth/login')
      .send({
        email: 'login_admin@uni.edu',
        password: 'password123'
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user).toHaveProperty('isAdmin', true);

    const secret = process.env.JWT_SECRET || 'default_secret';
    const decoded = jwt.verify(loginRes.body.token, secret) as any;
    expect(decoded).toHaveProperty('isAdmin', true);
  });

  describe('adminMiddleware birim ve arayüz doğrulaması', () => {
    it('adminMiddleware, isAdmin olmayan veya false olan istekleri 403 Forbidden ile durdurmalı', async () => {
      const { adminMiddleware } = await import('../src/middlewares/admin.middleware');

      const req: any = { user: { id: 'u1', email: 'test@uni.edu', isAdmin: false } };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };
      const next = vi.fn();

      adminMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/forbidden|admin/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('adminMiddleware, isAdmin = true olan isteklerde next() çağırarak geçişe izin vermeli', async () => {
      const { adminMiddleware } = await import('../src/middlewares/admin.middleware');

      const req: any = { user: { id: 'admin1', email: 'admin@uni.edu', isAdmin: true } };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };
      const next = vi.fn();

      adminMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('Admin System: Ticket 02 (Invite Code Management API)', () => {
    let adminToken: string;
    let userToken: string;

    beforeEach(async () => {
      // 1. Initial admin registration
      await createInvite('INIT-ADMIN');
      const adminRes = await request(app)
        .post('/auth/register')
        .send({ email: 'admin@uni.edu', password: 'password123', inviteCode: 'INIT-ADMIN' });
      adminToken = adminRes.body.token;

      // 2. Regular user registration
      await createInvite('INIT-USER');
      const userRes = await request(app)
        .post('/auth/register')
        .send({ email: 'user@uni.edu', password: 'password123', inviteCode: 'INIT-USER' });
      userToken = userRes.body.token;
    });

    it('Yetkisiz istekler (token yoksa) 401 Unauthorized dönmeli', async () => {
      const postRes = await request(app).post('/admin/invites').send();
      expect(postRes.status).toBe(401);

      const getRes = await request(app).get('/admin/invites');
      expect(getRes.status).toBe(401);
    });

    it('Normal öğrenci (isAdmin = false) /admin/invites endpointlerine erişmeye çalıştığında 403 Forbidden dönmeli', async () => {
      const postRes = await request(app)
        .post('/admin/invites')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ count: 1 });
      expect(postRes.status).toBe(403);
      expect(postRes.body.message).toMatch(/forbidden|admin/i);

      const getRes = await request(app)
        .get('/admin/invites')
        .set('Authorization', `Bearer ${userToken}`);
      expect(getRes.status).toBe(403);
      expect(getRes.body.message).toMatch(/forbidden|admin/i);
    });

    it('Admin tekil davet kodu üretebilmeli (varsayılan count=1, 6 haneli büyük harf hex formatında)', async () => {
      const res = await request(app)
        .post('/admin/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('invites');
      expect(Array.isArray(res.body.invites)).toBe(true);
      expect(res.body.invites).toHaveLength(1);

      const invite = res.body.invites[0];
      expect(invite.code).toMatch(/^[0-9A-F]{6}$/);
      expect(invite.isUsed).toBe(false);

      // Veritabanı kontrolü
      const dbCode = await db.orm.public.InviteCode.where({ code: invite.code }).first();
      expect(dbCode).toBeTruthy();
      expect(dbCode?.isUsed).toBe(false);
    });

    it('Admin toplu (batch) davet kodu üretebilmeli ({ count: 3 })', async () => {
      const res = await request(app)
        .post('/admin/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ count: 3 });

      expect(res.status).toBe(201);
      expect(res.body.invites).toHaveLength(3);

      const codes = res.body.invites.map((inv: any) => inv.code);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(3);

      for (const code of codes) {
        expect(code).toMatch(/^[0-9A-F]{6}$/);
        const dbCode = await db.orm.public.InviteCode.where({ code }).first();
        expect(dbCode).toBeTruthy();
      }
    });

    it('Geçersiz count değerlerinde ({ count: 0 }, { count: -5 }, { count: 101 }) 400 Bad Request dönmeli', async () => {
      const resZero = await request(app)
        .post('/admin/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ count: 0 });
      expect(resZero.status).toBe(400);

      const resNegative = await request(app)
        .post('/admin/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ count: -5 });
      expect(resNegative.status).toBe(400);

      const resTooLarge = await request(app)
        .post('/admin/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ count: 101 });
      expect(resTooLarge.status).toBe(400);
    });

    it('Admin tüm davet kodlarını listelediğinde (GET /admin/invites) durumlarıyla birlikte en yeniden en eskiye sıralı gelmeli', async () => {
      // Toplu kod üret
      await request(app)
        .post('/admin/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ count: 2 });

      const res = await request(app)
        .get('/admin/invites')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('invites');
      expect(Array.isArray(res.body.invites)).toBe(true);
      expect(res.body.invites.length).toBeGreaterThanOrEqual(4);

      const firstItem = res.body.invites[0];
      expect(firstItem).toHaveProperty('id');
      expect(firstItem).toHaveProperty('code');
      expect(firstItem).toHaveProperty('isUsed');
      expect(firstItem).toHaveProperty('createdAt');
    });
  });

  describe('Admin System: Ticket 03 (Admin Override & Force Cascade Delete)', () => {
    let adminToken: string;
    let adminUser: any;
    let studentToken: string;
    let studentUser: any;

    beforeEach(async () => {
      // 1. Register Admin
      await createInvite('ADMIN-T3-INV');
      const adminRes = await request(app)
        .post('/auth/register')
        .send({ email: 'admint3@uni.edu', password: 'password123', inviteCode: 'ADMIN-T3-INV' });
      adminToken = adminRes.body.token;
      adminUser = adminRes.body.user;

      // 2. Register Student
      await createInvite('STUDENT-T3-INV');
      const studentRes = await request(app)
        .post('/auth/register')
        .send({ email: 'studentt3@uni.edu', password: 'password123', inviteCode: 'STUDENT-T3-INV' });
      studentToken = studentRes.body.token;
      studentUser = studentRes.body.user;
    });

    const createTestDoc = async (userId: string, folderId: string | null = null, isLocked: boolean = false) => {
      return await db.orm.public.Document.create({
        title: 'Sample Note',
        hash: 'hash-' + Math.random().toString(36).substring(2),
        size: 1024,
        mimeType: 'application/pdf',
        userId,
        folderId,
        isLocked,
        status: 'COMPLETED'
      });
    };

    it('Admin başka bir kullanıcının dökümanını kilitleyebilmeli ve kilidini açabilmeli (PATCH /documents/:id/lock)', async () => {
      const doc = await createTestDoc(studentUser.id, null, false);

      // Admin kilitleme isteği
      const lockRes = await request(app)
        .patch(`/documents/${doc.id}/lock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isLocked: true });

      expect(lockRes.status).toBe(200);
      expect(lockRes.body.document.isLocked).toBe(true);

      const docInDb = await db.orm.public.Document.where({ id: doc.id }).first();
      expect(docInDb?.isLocked).toBe(true);

      // Admin kilit açma isteği
      const unlockRes = await request(app)
        .patch(`/documents/${doc.id}/lock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isLocked: false });

      expect(unlockRes.status).toBe(200);
      expect(unlockRes.body.document.isLocked).toBe(false);
    });

    it('Normal öğrenci başka bir kullanıcının dökümanını kilitlemeye çalıştığında 403 Forbidden dönmeli', async () => {
      const doc = await createTestDoc(adminUser.id, null, false);

      const res = await request(app)
        .patch(`/documents/${doc.id}/lock`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ isLocked: true });

      expect(res.status).toBe(403);
    });

    it('Admin başka bir kullanıcının dökümanını silebilmeli (DELETE /documents/:id)', async () => {
      const doc = await createTestDoc(studentUser.id, null, false);

      const res = await request(app)
        .delete(`/documents/${doc.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      const docInDb = await db.orm.public.Document.where({ id: doc.id }).first();
      expect(docInDb).toBeNull();
    });

    it('Normal öğrenci başka bir kullanıcının dökümanını silmeye çalıştığında 403 Forbidden dönmeli', async () => {
      const doc = await createTestDoc(adminUser.id, null, false);

      const res = await request(app)
        .delete(`/documents/${doc.id}`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });

    it('İçinde kilitli belge olan klasör silinmek istendiğinde force=true yoksa admin dahil 400 dönmeli (Safety Default)', async () => {
      const folder = await db.orm.public.Folder.create({ name: 'Dersler', parentId: null });
      await createTestDoc(studentUser.id, folder.id, true);

      // Admin force olmadan silmeye çalışıyor
      const adminRes = await request(app)
        .delete(`/folders/${folder.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(adminRes.status).toBe(400);
      expect(adminRes.body.message).toMatch(/locked document/i);

      // Öğrenci force olmadan silmeye çalışıyor
      const studentRes = await request(app)
        .delete(`/folders/${folder.id}`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(studentRes.status).toBe(400);
      expect(studentRes.body.message).toMatch(/locked document/i);
    });

    it('Normal öğrenci force=true parametresi gönderse bile kilitli belge korumasını aşamamalı ve 400 dönmeli', async () => {
      const folder = await db.orm.public.Folder.create({ name: 'Gizli Klasör', parentId: null });
      await createTestDoc(studentUser.id, folder.id, true);

      const res = await request(app)
        .delete(`/folders/${folder.id}?force=true`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/locked document/i);

      // Klasörün ve belgenin hala veritabanında olduğu doğrulanır
      const folderInDb = await db.orm.public.Folder.where({ id: folder.id }).first();
      expect(folderInDb).toBeTruthy();
    });

    it('Admin ?force=true ile kilitli belge korumasını aşarak klasörü ve içindekileri cascade silebilmeli (DELETE /folders/:id?force=true)', async () => {
      const parentFolder = await db.orm.public.Folder.create({ name: 'Ana Klasör', parentId: null });
      const subFolder = await db.orm.public.Folder.create({ name: 'Alt Klasör', parentId: parentFolder.id });
      const lockedDoc = await createTestDoc(studentUser.id, subFolder.id, true);

      const res = await request(app)
        .delete(`/folders/${parentFolder.id}?force=true`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      // Klasörler ve kilitli döküman silinmiş olmalı
      const parentInDb = await db.orm.public.Folder.where({ id: parentFolder.id }).first();
      const subInDb = await db.orm.public.Folder.where({ id: subFolder.id }).first();
      const docInDb = await db.orm.public.Document.where({ id: lockedDoc.id }).first();

      expect(parentInDb).toBeNull();
      expect(subInDb).toBeNull();
      expect(docInDb).toBeNull();
    });

    it('Admin kilitli bir dökümanı başka bir klasöre taşıyabilmeli (PATCH /documents/:id/folder)', async () => {
      const targetFolder = await db.orm.public.Folder.create({ name: 'Hedef Klasör', parentId: null });
      const lockedDoc = await createTestDoc(studentUser.id, null, true);

      const res = await request(app)
        .patch(`/documents/${lockedDoc.id}/folder`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ folderId: targetFolder.id });

      expect(res.status).toBe(200);
      expect(res.body.document.folderId).toBe(targetFolder.id);

      const docInDb = await db.orm.public.Document.where({ id: lockedDoc.id }).first();
      expect(docInDb?.folderId).toBe(targetFolder.id);
    });

    it('Normal öğrenci başkasının kilitli dökümanını başka bir klasöre taşımaya çalıştığında 403 Forbidden dönmeli', async () => {
      const targetFolder = await db.orm.public.Folder.create({ name: 'Hedef Klasör 2', parentId: null });
      const lockedDoc = await createTestDoc(adminUser.id, null, true);

      const res = await request(app)
        .patch(`/documents/${lockedDoc.id}/folder`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ folderId: targetFolder.id });

      expect(res.status).toBe(403);
    });
  });
});
