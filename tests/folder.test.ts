import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';

let app: any;
let db: any;

describe('Folder Management API: POST /folders', () => {
  beforeAll(async () => {
    app = (await import('../src/app')).default;
    db = (await import('../src/prisma/db')).db;
  });

  beforeEach(async () => {
    const { getPool } = await import('../src/prisma/db');
    const pool = getPool();
    await pool.query('TRUNCATE TABLE "folder", "document", "user", "inviteCode" CASCADE;');
  });

  const getAuthToken = async (email: string, code: string) => {
    await db.orm.public.InviteCode.create({ code });
    const res = await request(app)
      .post('/auth/register')
      .send({ email, password: 'password123', inviteCode: code });
    return { token: res.body.token, user: res.body.user };
  };

  it('Giriş yapmış bir kullanıcı geçerli bir isimle kök dizinde klasör oluşturabilmeli', async () => {
    const { token } = await getAuthToken('student_folder@uni.edu', 'INVITE-FOLDER-1');

    const response = await request(app)
      .post('/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ders Notları' });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('folder');
    expect(response.body.folder).toHaveProperty('id');
    expect(response.body.folder.name).toBe('Ders Notları');
    expect(response.body.folder.parentId).toBeNull();
  });

  it('Token olmadan istek atıldığında 401 Unauthorized dönmeli', async () => {
    const response = await request(app)
      .post('/folders')
      .send({ name: 'Ders Notları' });

    expect(response.status).toBe(401);
  });

  it('Klasör adı boş veya sadece boşluklardan oluşuyorsa 400 Bad Request dönmeli', async () => {
    const { token } = await getAuthToken('student_folder2@uni.edu', 'INVITE-FOLDER-2');

    const response = await request(app)
      .post('/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ' });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('message');
  });

  it('Var olan bir klasörün altına alt klasör (nested subfolder) oluşturabilmeli', async () => {
    const { token } = await getAuthToken('student_folder3@uni.edu', 'INVITE-FOLDER-3');

    // 1. Ana klasörü oluştur
    const parentRes = await request(app)
      .post('/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Mühendislik' });

    const parentId = parentRes.body.folder.id;

    // 2. Alt klasörü oluştur
    const subRes = await request(app)
      .post('/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bilgisayar', parentId });

    expect(subRes.status).toBe(201);
    expect(subRes.body.folder.name).toBe('Bilgisayar');
    expect(subRes.body.folder.parentId).toBe(parentId);
  });

  it('Var olmayan bir parentId ile alt klasör oluşturulmaya çalışıldığında 404 Not Found dönmeli', async () => {
    const { token } = await getAuthToken('student_folder4@uni.edu', 'INVITE-FOLDER-4');

    const response = await request(app)
      .post('/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Yapay Zeka', parentId: 'non-existent-folder-uuid' });

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message');
  });

  describe('GET /folders', () => {
    it('Token olmadan istek atıldığında 401 Unauthorized dönmeli', async () => {
      const response = await request(app).get('/folders');
      expect(response.status).toBe(401);
    });

    it('Tüm klasörleri düz bir liste olarak döndürmeli', async () => {
      const { token } = await getAuthToken('student_list@uni.edu', 'INVITE-FOLDER-5');

      // 1. İki klasör oluştur (biri kök, biri alt klasör)
      const parent = await db.orm.public.Folder.create({ name: 'Mühendislik', parentId: null });
      await db.orm.public.Folder.create({ name: 'Bilgisayar', parentId: parent.id });

      // 2. Klasörleri listele
      const response = await request(app)
        .get('/folders')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('folders');
      expect(Array.isArray(response.body.folders)).toBe(true);
      expect(response.body.folders.length).toBe(2);

      const folderNames = response.body.folders.map((f: any) => f.name);
      expect(folderNames).toContain('Mühendislik');
      expect(folderNames).toContain('Bilgisayar');
    });
  });

  describe('PATCH /folders/:id', () => {
    it('Token olmadan istek atıldığında 401 Unauthorized dönmeli', async () => {
      const response = await request(app)
        .patch('/folders/00000000-0000-0000-0000-000000000000')
        .send({ name: 'Yeni Ad' });

      expect(response.status).toBe(401);
    });

    it('Var olmayan bir klasör güncellenmeye çalışıldığında 404 Not Found dönmeli', async () => {
      const { token } = await getAuthToken('f_404@uni.edu', 'INV-F404');
      const response = await request(app)
        .patch('/folders/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Yeni Ad' });

      expect(response.status).toBe(404);
    });

    it('Klasör adı başarıyla güncellenebilmeli (rename)', async () => {
      const { token } = await getAuthToken('f_rename@uni.edu', 'INV-FRENAME');
      const folder = await db.orm.public.Folder.create({ name: 'Eski İsim', parentId: null });

      const response = await request(app)
        .patch(`/folders/${folder.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Güncel İsim' });

      expect(response.status).toBe(200);
      expect(response.body.folder.name).toBe('Güncel İsim');

      const updated = await db.orm.public.Folder.where({ id: folder.id }).first();
      expect(updated?.name).toBe('Güncel İsim');
    });

    it('Geçersiz veya boş klasör adı verildiğinde 400 Bad Request dönmeli', async () => {
      const { token } = await getAuthToken('f_inv_name@uni.edu', 'INV-FINVNAME');
      const folder = await db.orm.public.Folder.create({ name: 'Ders', parentId: null });

      const response = await request(app)
        .patch(`/folders/${folder.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '   ' });

      expect(response.status).toBe(400);
    });

    it('Klasör başka bir klasörün altına taşınabilmeli (valid parentId)', async () => {
      const { token } = await getAuthToken('f_move@uni.edu', 'INV-FMOVE');
      const folderA = await db.orm.public.Folder.create({ name: 'Fakülte', parentId: null });
      const folderB = await db.orm.public.Folder.create({ name: 'Bölüm', parentId: null });

      const response = await request(app)
        .patch(`/folders/${folderB.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ parentId: folderA.id });

      expect(response.status).toBe(200);
      expect(response.body.folder.parentId).toBe(folderA.id);

      const updated = await db.orm.public.Folder.where({ id: folderB.id }).first();
      expect(updated?.parentId).toBe(folderA.id);
    });

    it('Klasör kök dizine taşınabilmeli (parentId: null)', async () => {
      const { token } = await getAuthToken('f_move_root@uni.edu', 'INV-FMROOT');
      const folderA = await db.orm.public.Folder.create({ name: 'Ana', parentId: null });
      const folderB = await db.orm.public.Folder.create({ name: 'Alt', parentId: folderA.id });

      const response = await request(app)
        .patch(`/folders/${folderB.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ parentId: null });

      expect(response.status).toBe(200);
      expect(response.body.folder.parentId).toBeNull();

      const updated = await db.orm.public.Folder.where({ id: folderB.id }).first();
      expect(updated?.parentId).toBeNull();
    });

    it('Var olmayan bir parentId ile taşınmak istendiğinde 404 Not Found dönmeli', async () => {
      const { token } = await getAuthToken('f_move_404@uni.edu', 'INV-FMP404');
      const folder = await db.orm.public.Folder.create({ name: 'Test', parentId: null });

      const response = await request(app)
        .patch(`/folders/${folder.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ parentId: '00000000-0000-0000-0000-000000000000' });

      expect(response.status).toBe(404);
    });

    it('Döngü Koruması 1: Bir klasör kendisinin altına taşınmaya çalışıldığında 400 Bad Request dönmeli', async () => {
      const { token } = await getAuthToken('f_cycle_self@uni.edu', 'INV-FCYCLE1');
      const folder = await db.orm.public.Folder.create({ name: 'Kendisi', parentId: null });

      const response = await request(app)
        .patch(`/folders/${folder.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ parentId: folder.id });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/cannot move.*itself.*descendant/i);
    });

    it('Döngü Koruması 2: Bir klasör kendi doğrudan alt klasörünün altına taşınmaya çalışıldığında 400 Bad Request dönmeli', async () => {
      const { token } = await getAuthToken('f_cycle_direct@uni.edu', 'INV-FCYCLE2');
      const folderA = await db.orm.public.Folder.create({ name: 'Üst Klasör', parentId: null });
      const folderB = await db.orm.public.Folder.create({ name: 'Alt Klasör', parentId: folderA.id });

      const response = await request(app)
        .patch(`/folders/${folderA.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ parentId: folderB.id });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/cannot move.*itself.*descendant/i);
    });

    it('Döngü Koruması 3: Çok seviyeli döngüsel taşıma (A -> B -> C iken A yı C nin altına taşımak) engellenmeli', async () => {
      const { token } = await getAuthToken('f_cycle_deep@uni.edu', 'INV-FCYCLE3');
      const folderA = await db.orm.public.Folder.create({ name: 'Düzey 1', parentId: null });
      const folderB = await db.orm.public.Folder.create({ name: 'Düzey 2', parentId: folderA.id });
      const folderC = await db.orm.public.Folder.create({ name: 'Düzey 3', parentId: folderB.id });

      const response = await request(app)
        .patch(`/folders/${folderA.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ parentId: folderC.id });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/cannot move.*itself.*descendant/i);
    });
  });
});

