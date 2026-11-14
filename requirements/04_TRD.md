# 04 — Technical Requirements Document (TRD)

> **Produk:** M-Class Backend · **Versi:** 1.4 · **Tanggal:** 12 November 2026
> **Fungsi dokumen:** Cara membangun — arsitektur, stack, skema database, kontrak layanan AI, keamanan, deployment, dan **roadmap milestone**.
> Perilaku & API: lihat `03_FSD.md` (sumber kebenaran fungsional). Kontrak semantik UI, pesan, & format tampilan: lihat `05_DESIGN_SYSTEM.md`. Tujuan bisnis & risiko: `01_MRD.md`. Keputusan: `D-xx` (`00_README_HANDOFF.md`), `TD-xx` (dokumen ini).
> Label: `USULAN` = nilai awal yang boleh disesuaikan · `TBD-kalibrasi` = harus diukur saat pilot.
> **Versi library tidak dipatok di sini** — pasang versi stabil terbaru saat M0 dan kunci dengan lockfile.
> **Revisi v1.1:** (1) akun admin/guru **dikelola di database** (tanpa registrasi/aktivasi/lupa sandi); (2) verifikasi wajah **otomatis dengan satu ambang** — tanpa zona review & tanpa status validasi; (3) role **`admin`** ditambahkan (`admin`, `guru`, `siswa`); (4) **presensi pulang dihapus** (tanpa kolom `check_out_at`/`checkout_*`).
> **Revisi v1.2 (koreksi stack):** (0) **Tanpa Docker** — deployment langsung di host Linux (systemd + Nginx/Caddy), TD-17; (1) **Backend = Express + TypeScript + MySQL**, satu database; (2) **Flask tetap layanan AI internal** — tidak ada mesin wajah in-process di Node; (3) **Flutter tetap untuk mobile** — kontrak lewat **OpenAPI**, bukan paket TypeScript bersama; (4) **Web Vite/React dipertahankan**, migrasi ke TS opsional/bertahap memakai tipe dari paket kontrak `packages/contract`; (5) skema Prisma (15 tabel P0) = sumber kebenaran skema DB.
> **Revisi v1.3 (OAuth Mobile Murid):** Penambahan dukungan teknis **Google Sign-In (OAuth 2.0 / OIDC `id_token`) khusus siswa di aplikasi mobile (Flutter)** (TD-18): verifikasi `id_token` Google di Express, kolom `google_id` & `oauth_provider` pada tabel `users`, variabel lingkungan `GOOGLE_CLIENT_ID`, serta alur penautan NISN ke roster siswa.
> **Revisi v1.4 (Penyelarasan Design System & MRD):** (1) Penyelarasan DDL & layanan dengan kontrak semantik `05_DESIGN_SYSTEM.md` §7–§12 (termasuk `announcements.status` `draft`/`published`, pemetaan alias bilingual, label baku `"Alpa"` DS-03, serta penghapusan ketergantungan avatar eksternal `ui-avatars.com` DS-07); (2) pemetaan rekomendasi `DS-01`…`DS-08` dan `FC-01`…`FC-09` ke Milestone §14.

---

## 1. Ikhtisar Arsitektur

```mermaid
flowchart LR
  subgraph Clients
    W[Web Guru/Admin<br/>React + Vite · TS opsional]
    M[Mobile Siswa<br/>Flutter/Dart]
  end
  subgraph Server["Satu host Linux (systemd, tanpa Docker)"]
    N[Reverse proxy<br/>TLS]
    A[Express + TypeScript<br/>REST API + Jobs]
    F[Flask AI Service<br/>detect · embed · verify]
    D[(MySQL 8)]
    S[(Volume file privat<br/>foto & lampiran)]
  end
  E[SMTP<br/>email OTP]
  G[Google OAuth / JWKS<br/>verifikasi id_token]
  subgraph Repo["Monorepo (build-time)"]
    C[packages/contract<br/>Zod · tipe · waktu WIB]
  end
  C -.->|import| A
  C -.->|import tipe| W
  A -.->|OpenAPI hasil generate| M
  W -->|HTTPS /api| N
  M -->|HTTPS /api| N
  N --> A
  A -->|SQL| D
  A -->|HTTP internal + token| F
  A -->|file I/O| S
  A -->|SMTP| E
  A -->|Verify ID Token| G
```

**Prinsip:**
1. **Express adalah satu-satunya pintu masuk** ke data & AI (D-11). Flask tidak terekspos ke internet maupun klien.
2. **Keputusan bisnis ada di Express** (threshold, status, geofence). Flask hanya menghitung (deteksi/embedding/skor).
3. **Fail-closed:** jika AI tidak tersedia, presensi **tidak** diloloskan otomatis.
4. **Waktu server otoritatif** (bukan jam perangkat) untuk status hadir/terlambat.
5. **Konfigurasi, bukan hardcode** untuk jam, radius, threshold, dan nama sekolah (`school_settings`, DS-05).

### 1.1 Alur presensi (sequence)

```mermaid
sequenceDiagram
  participant App as Mobile
  participant API as Express
  participant AI as Flask
  participant DB as MySQL
  App->>API: POST /attendance/check-in (foto, lat, lng, akurasi, is_mocked)
  API->>DB: ambil sesi, siswa, template wajah, jadwal, geofence
  API->>API: cek hari sekolah, jendela waktu, duplikat, mock/akurasi, jarak
  alt di luar radius / jam / mock
    API->>DB: simpan attempt (ditolak)
    API-->>App: 422 + code + pesan tindakan (05_DESIGN_SYSTEM §8.3)
  else lolos pra-cek
    API->>AI: POST /v1/verify (foto + embedding referensi)
    AI-->>API: similarity, jumlah wajah, kualitas
    API->>API: keputusan wajah (cocok → catat / tidak cocok → tolak)
    API->>DB: transaksi: attempt + record final (+ notifikasi)
    API-->>App: 201 record, requires_late_reason?, message: "Absensi Masuk Berhasil!"
  end
```

> Pra-cek murah (waktu, jarak, duplikat) dijalankan **sebelum** memanggil AI agar hemat komputasi.

### 1.1b Alur Login Google OAuth Siswa di Mobile (sequence)

```mermaid
sequenceDiagram
  participant App as Mobile (Flutter)
  participant G as Google Sign-In SDK / OIDC
  participant API as Express
  participant DB as MySQL
  App->>G: Sign-in dengan akun Google
  G-->>App: id_token (JWT)
  App->>API: POST /api/auth/oauth/google { id_token }
  API->>G: Verifikasi signature, exp, aud (GOOGLE_CLIENT_ID), email_verified
  API->>DB: Cari user berdasarkan google_id (sub) atau email
  alt User ditemukan (role=siswa)
    API->>DB: Tautkan google_id (bila belum) + buat sesi mobile (auth_sessions)
    API-->>App: 200 { token, user }
  else User belum terdaftar & nisn belum dikirim
    API-->>App: 422 OAUTH_NISN_REQUIRED { email, name }
    App->>App: Tampilkan form input 10 digit NISN
    App->>API: POST /api/auth/oauth/google { id_token, nisn }
    API->>DB: Cek NISN di students (roster) belum diklaim → buat user(siswa) + tautkan roster + buat sesi
    API-->>App: 200 { token, user }
  end
```

---

### 1.2 Monorepo & Kontrak Bersama

| Komponen | Bahasa | Cara berbagi kontrak |
|----------|--------|----------------------|
| `packages/contract` | TypeScript murni (tanpa dependensi Node/DB/Express) | Sumber: skema **Zod**, tipe turunan, daftar kode error, enum semantik (`05_DESIGN_SYSTEM.md` §7), util waktu WIB & status terlambat |
| `apps/api` / `backend_mclass` (Express) | TypeScript | **Import langsung** paket `contract` / util domain |
| `apps/web` (Vite/React) | JS sekarang; **TS opsional bertahap** | Import tipe/skema dari `contract` hanya setelah file terkait dimigrasi ke TS |
| Mobile (Flutter) | Dart | **Tidak** memakai paket TS. Kontrak = **OpenAPI** yang di-generate dari skema Zod (`openapi/`); klien Dart ditulis tangan atau di-generate dari file OpenAPI |
| `mclass-ai` (Flask) | Python | Kontrak internal terpisah (§7.2); **tidak** terkait paket `contract` |

Aturan:
1. **Satu database** (MySQL 8) hanya diakses oleh Express. Flask & Flutter tidak pernah menyentuh DB.
2. **Skema DB:** `schema.prisma` / `src/database/schema.sql` adalah sumber kebenaran (15 tabel P0 + `device_tokens` P1). DDL §4.2 adalah referensi lengkap.
3. **Tidak ada mesin wajah in-process:** seluruh deteksi/embedding/verifikasi berjalan di Flask (§7). Node tidak memuat model ML.
4. `contract` tidak boleh mengimpor Prisma, Express, `fs`, atau API khusus Node, agar aman dibundel untuk web.
5. Perubahan endpoint = ubah skema Zod → regenerasi OpenAPI → catat di Change List FE (`00_README_HANDOFF.md` §8) & Design System (`05_DESIGN_SYSTEM.md` §7).

---

## 2. Stack Teknologi

| Lapisan | Pilihan | Alasan / Catatan |
|---------|---------|------------------|
| Runtime | Node.js (LTS aktif) + TypeScript (strict) | Sesuai keputusan Anda |
| Framework | Express (versi stabil terbaru) | Sesuai keputusan Anda |
| Validasi & kontrak | **Zod** / validator domain strict (tolak field tak dikenal) | Satu sumber untuk validasi + tipe + OpenAPI; pesan error Bahasa Indonesia sesuai `05_DESIGN_SYSTEM.md` §8 |
| Mobile | **Flutter (Dart)** — tetap (`google_sign_in` untuk OAuth murid) | Konsumsi API lewat OpenAPI (TD-13, TD-18) |
| Web | **React + Vite** — tetap; TS opsional | Tipe dari `contract` (TD-14) |
| Monorepo | pnpm workspaces (`USULAN`) | Berbagi `contract` antara `api` dan `web` |
| Database | **MySQL 8**, InnoDB, `utf8mb4` | Sesuai keputusan Anda |
| Akses data | **Prisma** / **`mysql2/promise`** (parameterized query) | TD-02; query terparameter wajib untuk mencegah SQL injection |
| Auth & OAuth | JWT (`jsonwebtoken` atau `jose`) + `auth_sessions` (`user_sessions`) + verifikasi Google OIDC (`google-auth-library` / Google `tokeninfo` & JWKS) | D-16, TD-18 |
| Hash sandi | `argon2` (argon2id) | D-17 |
| Upload | `multer` / multipart parser (memory, limit ketat) → validasi magic bytes → simpan | BR-70 |
| Gambar | `sharp` (rotasi EXIF, hapus metadata, resize) | |
| Email | `nodemailer` (SMTP) | OQ-06 |
| Job terjadwal | `node-cron` + `GET_LOCK` MySQL + tabel `job_runs` | TD-05 |
| Laporan | `exceljs` (xlsx, label baku **"Alpa"** DS-03), `pdfkit` (PDF) | D-14 |
| Keamanan HTTP | `helmet`, `cors` (allowlist), `express-rate-limit` | |
| Log | `pino` (JSON, redaksi field sensitif) + `pino-http` | |
| Dokumentasi API | OpenAPI dari skema Zod (mis. `zod-to-openapi`) | NFR-08 |
| Test | `vitest`/`jest` + `supertest` + MySQL nyata (instance MySQL terpisah khusus test) | |
| AI service | **Flask** + Gunicorn; model face recognition berbasis embedding | §7 |
| Proses & deployment | **Tanpa Docker.** `systemd` (atau PM2 untuk Express) menjalankan proses; Nginx/Caddy sebagai reverse proxy TLS | TD-17, OQ-07 |

### 2.1 Keputusan Teknis (TD)

| ID | Keputusan | Alasan |
|----|-----------|--------|
| TD-01 | Arsitektur **modular monolith** (satu proses API, modul per fitur) | Skala sekolah tunggal; microservice tidak perlu |
| TD-02 | Parameterized SQL / Prisma untuk CRUD & agregasi rekap | Tipe aman untuk CRUD; SQL eksplisit untuk laporan |
| TD-03 | Semua waktu disimpan UTC (`DATETIME(3)` / `DATETIME`); sesi DB `time_zone='+00:00'`; konversi ke WIB di lapisan domain (`Asia/Jakarta`) | D-19 |
| TD-04 | File disimpan di volume lokal privat; antarmuka `StorageProvider` agar bisa diganti S3-compatible | Sederhana sekarang, bisa dipindah |
| TD-05 | Job in-process dengan kunci `GET_LOCK` + `job_runs` (idempoten) | Aman bila >1 instance; tanpa Redis |
| TD-06 | Tanpa Redis/antrian di v1; rate limit & cache memakai memori proses | Skala kecil; tambah Redis bila multi-instance |
| TD-07 | Verifikasi wajah **sinkron** (request menunggu hasil AI) | Waktu respons target ≤ 5 dtk; UX sederhana |
| TD-08 | Embedding disimpan terenkripsi aplikasi (AES-256-GCM) di MySQL | Data biometrik; cegah baca langsung dari dump DB |
| TD-09 | URL file bertanda tangan HMAC berumur pendek / endpoint terproteksi; **tanpa layanan avatar pihak ketiga (`ui-avatars.com`, DS-07)** | Privasi data siswa & kompatibilitas `<img>` |
| TD-10 | Verifikasi wajah **satu ambang & otomatis**; tidak ada status/tabel validasi | D-28 |
| TD-11 | Akun admin/guru dikelola di DB; tidak ada kode registrasi/aktivasi staf | D-04 |
| TD-12 | **Satu backend TypeScript** (Express) + **satu database** MySQL; Flask hanya layanan internal | Koreksi v1.2 |
| TD-13 | Flutter tetap; kontrak mobile = **OpenAPI** hasil generate dari Zod, bukan paket TS | Dart tidak bisa memakai paket TS |
| TD-14 | Web Vite/React tetap; migrasi TS opsional & bertahap, memakai tipe/skema dari `packages/contract` | Tanpa rewrite besar |
| TD-15 | Util waktu WIB + keputusan status `hadir/terlambat` hidup di `packages/contract` / `src/utils/wib-time.ts` sebagai fungsi murni (tanpa I/O) | Dipakai ulang Express & web; satu implementasi |
| TD-16 | **Tidak ada face engine in-process** di Node; verifikasi wajah hanya via Flask (§7) | Koreksi v1.2 |
| TD-17 | **Deployment tanpa Docker:** proses langsung di host Linux (systemd/PM2) + Nginx/Caddy; Flask & MySQL hanya di localhost; versi runtime dikunci (lockfile, `.nvmrc`, `requirements.txt`) | Keputusan pemilik proyek; mengurangi kompleksitas operasional |
| TD-18 | **Google OAuth Mobile Siswa berbasis OIDC `id_token`:** Aplikasi Flutter melakukan Google Sign-In di sisi perangkat dan mengirimkan `id_token` ke `POST /api/auth/oauth/google`. Backend memverifikasi token secara kriptografis/ke Google (`iss`, `aud` cocok dengan `GOOGLE_CLIENT_ID`, `exp`, `email_verified=true`) lalu menukar dengan JWT sesi M-Class (`auth_sessions`/`user_sessions`) agar seluruh mekanisme pencabutan sesi dan otorisasi tetap seragam. | Aman untuk mobile native tanpa perlu menyimpan client secret di perangkat |

---

## 3. Lingkungan & Konfigurasi

### 3.1 Variabel lingkungan (Express)

| Variabel | Contoh / Default | Catatan |
|----------|------------------|---------|
| `NODE_ENV` | `production` | |
| `PORT` | `3000` | Sesuai proxy dev web |
| `DATABASE_URL` / `DB_HOST,DB_PORT,DB_USER,DB_PASSWORD,DB_NAME` | `mysql://user:pass@127.0.0.1:3306/mclass` | Wajib |
| `CORS_ORIGINS` | `https://web.domain.sch.id` | Daftar dipisah koma; **jangan `*`** di production |
| `JWT_SECRET` | ≥ 32 byte acak | Wajib, rahasia |
| `SESSION_TTL_WEB` / `SESSION_TTL_MOBILE` | `7d` / `30d` | `USULAN` |
| `GOOGLE_CLIENT_ID` | `xxx.apps.googleusercontent.com` | Daftar Client ID Google OAuth (Android/iOS/Web serverClientId, bisa dipisah koma) untuk memvalidasi klaim `aud`/`azp` pada `id_token` mobile siswa (TD-18) |
| `OTP_TTL`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN`, `OTP_MAX_SENDS_PER_HOUR`, `RESET_TOKEN_TTL` | `10m`, `5`, `60s`, `5`, `15m` | `USULAN` (BR-06/07) |
| `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM` | — | OQ-06 |
| `AI_BASE_URL` | `http://127.0.0.1:5000` | Hanya localhost; Flask di-bind ke 127.0.0.1 |
| `AI_INTERNAL_TOKEN` | acak ≥ 32 byte | Header `X-Internal-Token` |
| `AI_TIMEOUT_MS` | `5000` | `USULAN` |
| `FACE_MATCH_THRESHOLD` | `TBD-kalibrasi` | **Satu-satunya ambang** (D-28): ≥ ambang → langsung tercatat; < ambang → ditolak. Nilai dev sementara hanya untuk lokal |
| `ENROLL_MIN_SAMPLES` / `ENROLL_MAX_SAMPLES` | `3` / `5` | `USULAN` |
| `GPS_MAX_ACCURACY_M` | `TBD` (dev: 30) | BR-13 |
| `ATTEMPT_MAX_PER_DAY` | `10` | `USULAN` |
| `ALPA_DELAY_MIN` | `5` | BR-28 |
| `CLASS_ALERT_THRESHOLD` | `95` | `USULAN` BR-32 |
| `LEAVE_MAX_DAYS`, `LEAVE_MAX_BACKDATE_DAYS` | `14`, `3` | `USULAN` |
| `REPORT_MAX_RANGE_DAYS` | `92` | `USULAN` |
| `PHOTO_MAX_MB` | `3` | `USULAN` |
| `UPLOAD_DIR` | `/data/uploads` | Di luar web root |
| `FILE_URL_SECRET`, `FILE_URL_TTL` | acak, `600` (detik) | TD-09 |
| `EMBEDDING_ENC_KEY` | 32 byte (base64) | TD-08 |
| `ATTEMPT_PHOTO_RETENTION_DAYS` | `TBD` (usulan 90) | BR-71 |
| `LOG_LEVEL` | `info` | |

Validasi env **saat boot**; aplikasi **gagal start** bila variabel wajib hilang/tidak valid. Sediakan `.env.example` tanpa rahasia.

### 3.2 Lingkungan

| Env | Tujuan | Catatan |
|-----|--------|---------|
| `local` | Pengembangan | MySQL, Express, dan Flask dijalankan langsung (skrip `dev`); AI boleh memakai model ringan |
| `staging` | Uji integrasi FE/BE & uji lapangan | Data dummy/anonim; **bukan** foto siswa nyata kecuali ada persetujuan |
| `production` | Operasional sekolah | HTTPS wajib |

---

## 4. Model Data (MySQL 8)

### 4.1 Diagram relasi (ringkas)

```mermaid
erDiagram
  users ||--o| students : "tautan akun siswa"
  classes ||--o{ students : berisi
  users ||--o{ classes : "wali kelas"
  students ||--o{ face_templates : punya
  students ||--o{ attendance_records : punya
  students ||--o{ attendance_attempts : melakukan
  students ||--o{ leave_requests : mengajukan
  users ||--o{ auth_sessions : memiliki
  users ||--o{ notifications : menerima
  users ||--o{ announcements : membuat
  attendance_attempts ||--o| attendance_records : menghasilkan
  leave_requests ||--o{ attendance_records : memengaruhi
```

### 4.2 DDL

> **Sumber kebenaran skema = `schema.prisma` / `src/database/schema.sql`** (15 tabel P0 + `device_tokens` P1); DDL di bawah adalah referensi ekuivalen (TRD §1.2). Semua `DATETIME(3)` = UTC. `DATE` = tanggal kalender WIB (`attendance_date`, `start_date`, dst.). Engine InnoDB, charset `utf8mb4`, collation `utf8mb4_0900_ai_ci` / `utf8mb4_unicode_ci`.
> *(Catatan kompatibilitas implementasi saat ini di `src/database/schema.sql`: tabel roster siswa dinamai `student_roster` dan tabel sesi dinamai `user_sessions`; layanan `announcement.service.ts` mendukung kolom `category`/`type`, `publish_date`/`event_date`, `target_audience`/`audience`, serta `status ENUM('draft','published')`.)*

```sql
CREATE TABLE school_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  school_name VARCHAR(150) NOT NULL,
  latitude DECIMAL(9,6) NOT NULL,
  longitude DECIMAL(9,6) NOT NULL,
  radius_m SMALLINT UNSIGNED NOT NULL DEFAULT 50,
  timezone VARCHAR(40) NOT NULL DEFAULT 'Asia/Jakarta',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_single_row CHECK (id = 1)
) ENGINE=InnoDB;

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  role ENUM('admin','guru','siswa') NOT NULL,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NULL,                 -- NULL/hash acak bila siswa mendaftar via Google OAuth
  google_id VARCHAR(191) NULL,                     -- Google OIDC 'sub' (khusus siswa mobile OAuth)
  oauth_provider ENUM('local','google') NOT NULL DEFAULT 'local',
  phone VARCHAR(20) NULL,
  avatar_path VARCHAR(255) NULL,                   -- (atau photo_url)
  status ENUM('active','inactive') NOT NULL DEFAULT 'active', -- (atau is_active TINYINT(1))
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_google_id (google_id),
  KEY idx_users_role_status (role, status)
) ENGINE=InnoDB;

CREATE TABLE classes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  grade TINYINT UNSIGNED NOT NULL,                 -- 7, 8, 9 (atau grade_level)
  section VARCHAR(10) NOT NULL DEFAULT '',         -- '' bila tanpa paralel (A/B/...)
  name VARCHAR(40) NOT NULL,                       -- "Kelas 7"
  academic_year VARCHAR(9) NOT NULL DEFAULT '2026/2027',
  homeroom_teacher_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_class (grade, section, academic_year),
  CONSTRAINT fk_class_homeroom FOREIGN KEY (homeroom_teacher_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE students (                            -- (alias implementasi: student_roster)
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,                    -- NULL sampai siswa registrasi / login OAuth + klaim NISN
  nisn CHAR(10) NOT NULL,
  nis VARCHAR(20) NULL,
  name VARCHAR(150) NOT NULL,                      -- nama resmi dari roster (full_name)
  gender ENUM('L','P') NOT NULL DEFAULT 'L',
  birth_date DATE NULL,
  absence_number SMALLINT UNSIGNED NULL,           -- (attendance_number)
  class_id BIGINT UNSIGNED NOT NULL,
  phone VARCHAR(20) NULL,                          -- (whatsapp_number)
  address VARCHAR(255) NULL,
  guardian_name VARCHAR(150) NULL,
  guardian_phone VARCHAR(20) NULL,                 -- (parent_phone)
  biometric_consent_at DATETIME(3) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_students_nisn (nisn),
  UNIQUE KEY uq_students_user (user_id),
  KEY idx_students_class_active (class_id, is_active),
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_students_class FOREIGN KEY (class_id) REFERENCES classes(id)
) ENGINE=InnoDB;

CREATE TABLE auth_sessions (                       -- (alias implementasi: user_sessions)
  id CHAR(36) NOT NULL PRIMARY KEY,                -- jti (UUID)
  user_id BIGINT UNSIGNED NOT NULL,
  platform ENUM('web','android','ios','unknown') NOT NULL DEFAULT 'unknown',
  device_label VARCHAR(150) NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_active_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  KEY idx_sessions_user (user_id, revoked_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE password_resets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  otp_hash CHAR(64) NOT NULL,                      -- HMAC-SHA256 hex
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  reset_token_hash CHAR(64) NULL,
  reset_token_expires_at DATETIME(3) NULL,
  last_sent_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_pr_user_created (user_id, created_at),
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE face_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  embedding VARBINARY(8192) NOT NULL,              -- AES-256-GCM(iv|tag|float32[]), TD-08
  embedding_dim SMALLINT UNSIGNED NOT NULL,
  model_name VARCHAR(60) NOT NULL,
  model_version VARCHAR(30) NOT NULL,
  quality_score DECIMAL(5,4) NULL,
  photo_path VARCHAR(255) NULL,                    -- foto referensi (untuk tampilan hasil scan admin/guru)
  status ENUM('active','revoked') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_ft_student_status (student_id, status),
  CONSTRAINT fk_ft_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE attendance_schedules (
  id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  day_of_week TINYINT UNSIGNED NOT NULL,           -- 1=Senin ... 7=Minggu
  is_school_day TINYINT(1) NOT NULL DEFAULT 1,
  checkin_open TIME NULL,                          -- WIB
  late_after TIME NULL,                            -- WIB (contoh FE: 07:15)
  checkin_close TIME NULL,                         -- WIB
  UNIQUE KEY uq_schedule_day (day_of_week)
) ENGINE=InnoDB;

CREATE TABLE attendance_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  attempted_at DATETIME(3) NOT NULL,               -- waktu server
  client_captured_at DATETIME(3) NULL,
  latitude DECIMAL(9,6) NULL,
  longitude DECIMAL(9,6) NULL,
  accuracy_m DECIMAL(7,2) NULL,
  distance_m DECIMAL(8,2) NULL,
  within_radius TINYINT(1) NULL,
  is_mocked TINYINT(1) NOT NULL DEFAULT 0,
  photo_path VARCHAR(255) NULL,
  face_similarity DECIMAL(6,5) NULL,
  face_result ENUM('match','no_match','no_face','multiple_faces','low_quality','error') NULL,
  outcome ENUM('recorded','rejected_outside_radius','rejected_face',
               'rejected_time_window','rejected_mock_location','rejected_gps_accuracy',
               'rejected_already_recorded','rejected_not_enrolled','error') NOT NULL,
  record_id BIGINT UNSIGNED NULL,
  device VARCHAR(100) NULL,
  model_version VARCHAR(30) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_att_student_time (student_id, attempted_at),
  KEY idx_att_outcome_time (outcome, attempted_at),
  CONSTRAINT fk_att_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE attendance_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  attendance_date DATE NOT NULL,                   -- tanggal WIB
  status ENUM('hadir','terlambat','izin','sakit','alpa') NOT NULL,
  source ENUM('face_gps','leave','auto_alpa','manual') NOT NULL,
  check_in_at DATETIME(3) NULL,
  late_minutes SMALLINT UNSIGNED NULL,
  late_reason ENUM('macet','kendala_kendaraan','keperluan_keluarga','lainnya') NULL,
  late_note VARCHAR(120) NULL,
  attempt_id BIGINT UNSIGNED NULL,
  leave_request_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_record_student_date (student_id, attendance_date),
  KEY idx_rec_date_status (attendance_date, status),
  CONSTRAINT fk_rec_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE leave_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  category ENUM('sakit','keperluan','dispensasi') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  attachment_path VARCHAR(255) NOT NULL,
  attachment_mime VARCHAR(60) NOT NULL,
  status ENUM('menunggu','disetujui','ditolak','dibatalkan') NOT NULL DEFAULT 'menunggu',
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  review_note VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_leave_student_dates (student_id, start_date, end_date),
  KEY idx_leave_status_created (status, created_at),
  CONSTRAINT fk_leave_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_leave_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
) ENGINE=InnoDB;

CREATE TABLE announcements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  type ENUM('akademik','kegiatan','libur','penting','prestasi','info') NOT NULL, -- (atau category ENUM('academic','activity','holiday','important','achievement','info'))
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  event_date DATE NOT NULL,                        -- (atau publish_date)
  end_date DATE NULL,
  audience ENUM('semua','siswa','guru','wali') NOT NULL DEFAULT 'semua', -- (atau target_audience)
  class_id BIGINT UNSIGNED NULL,
  priority ENUM('rendah','normal','penting','urgent') NOT NULL DEFAULT 'normal', -- (atau low/normal/important/urgent)
  status ENUM('draft','published') NOT NULL DEFAULT 'published',
  created_by BIGINT UNSIGNED NULL,
  published_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_ann_dates (status, event_date, end_date),
  KEY idx_ann_type (type, deleted_at),
  CONSTRAINT fk_ann_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
  CONSTRAINT fk_ann_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(40) NOT NULL,
  title VARCHAR(150) NOT NULL,
  body VARCHAR(500) NOT NULL,
  data JSON NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_notif_user (user_id, read_at, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(40) NULL,
  entity_id VARCHAR(40) NULL,
  meta JSON NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_actor (actor_user_id, created_at),
  KEY idx_audit_action (action, created_at)
) ENGINE=InnoDB;

CREATE TABLE job_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_name VARCHAR(60) NOT NULL,
  run_date DATE NOT NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  affected INT UNSIGNED NULL,
  UNIQUE KEY uq_job_date (job_name, run_date)
) ENGINE=InnoDB;

-- P1 (push notification)
CREATE TABLE device_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  platform ENUM('android','ios') NOT NULL,
  token VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_device_token (token),
  CONSTRAINT fk_dev_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

### 4.3 Catatan model

- **`attendance_records`** satu baris per siswa per hari (unique). Record **final seketika** saat wajah cocok — tidak ada status menunggu validasi (BR-14).
- **Siswa tanpa record** = "belum hadir" (`belum_hadir` pada rekap web, `belum_presensi` pada beranda siswa mobile, sesuai `05_DESIGN_SYSTEM.md` §7.1) secara virtual (dihitung di query, bukan baris).
- **`attendance_attempts`** menyimpan *semua* percobaan → sumber daftar "di luar radius" & analitik penolakan.
- **Penghapusan siswa** (`ON DELETE CASCADE`) menghapus biometrik & riwayat — gunakan `is_active=0` untuk siswa lulus/pindah; hapus fisik hanya untuk permintaan penghapusan data.
- **Akun admin/guru tanpa registrasi:** dikelola langsung di tabel `users` (insert/update/delete) atau melalui CLI `src/database/cli-user.ts`. Contoh:
  ```sql
  INSERT INTO users (role, name, email, password_hash, status)
  VALUES ('admin', 'Pengelola Sekolah', 'admin@sekolah.sch.id', '<argon2id-hash>', 'active');
  -- nonaktifkan: UPDATE users SET status='inactive' WHERE email='...';
  -- hapus:       DELETE FROM users WHERE email='...';   -- sesi ikut terhapus (CASCADE)
  -- wali kelas:  UPDATE classes SET homeroom_teacher_id=<id guru> WHERE id=<id kelas>;
  ```
- **Google OAuth Siswa (`users.google_id` & `users.oauth_provider`):**
  - Siswa yang sudah pernah mendaftar manual (`oauth_provider='local'`) lalu login dengan Google OAuth menggunakan email yang sama akan otomatis menautkan `google_id` pada baris `users` miliknya.
  - Siswa yang langsung masuk dengan Google OAuth pertama kali dan menyerahkan NISN valid akan dibuatkan baris `users` (`oauth_provider='google'`, `google_id=<sub>`) dan ditautkan ke `students.user_id` (`student_roster.user_id`).
- **Seed minimal:** 1 baris `school_settings`, 3 baris `classes` (7, 8, 9), 7 baris `attendance_schedules`.

### 4.4 Query inti agregasi (acuan implementasi BR-30/31)

```sql
-- Hitungan per kelas untuk tanggal :d (WIB). Semua record adalah efektif (tanpa status validasi).
SELECT
  c.id AS class_id, c.name,
  COUNT(s.id)                                                              AS total_students,
  SUM(r.id IS NOT NULL AND r.status = 'hadir')     AS hadir,
  SUM(r.id IS NOT NULL AND r.status = 'terlambat') AS terlambat,
  SUM(r.id IS NOT NULL AND r.status = 'izin')      AS izin,
  SUM(r.id IS NOT NULL AND r.status = 'sakit')     AS sakit,
  SUM(r.id IS NOT NULL AND r.status = 'alpa')      AS alpa
FROM classes c
JOIN students s ON s.class_id = c.id AND s.is_active = 1
LEFT JOIN attendance_records r ON r.student_id = s.id AND r.attendance_date = :d
GROUP BY c.id, c.name
ORDER BY c.grade, c.section;
-- belum_hadir = total_students - (hadir + terlambat + izin + sakit + alpa)
```

Uji wajib: `hadir + terlambat + izin + sakit + alpa + belum_hadir = total_students` untuk setiap kelas & total.

---

## 5. Pengelolaan Waktu & Geo

| Fungsi | Spesifikasi |
|--------|-------------|
| `nowUtc()` | Satu-satunya sumber "sekarang" (bisa di-*inject* untuk test) |
| `toWibDate(instant)` | Tanggal kalender di `Asia/Jakarta` (`YYYY-MM-DD`) |
| `toWibMonth(instant)` | Bulan kalender di `Asia/Jakarta` (`YYYY-MM`) |
| `wibTimeOfDay(instant)` | `HH:mm:ss` WIB untuk dibandingkan dengan `TIME` jadwal |
| `haversineMeters(a, b)` | Jarak lingkaran besar (R = 6.371.000 m), hasil dibulatkan 1 desimal |
| Perbandingan radius | `distance ≤ radius_m` (sama dengan radius = sah) |
| Keputusan `terlambat` | Berdasarkan **waktu server**, bukan `captured_at` klien |

Fungsi waktu & status (`nowUtc` ter-*inject*, `toWibDate`, `toWibMonth`, `wibTimeOfDay`, keputusan `hadir/terlambat` + `late_minutes` per BR-15) berada di `packages/contract` / `src/utils/wib-time.ts` sebagai fungsi murni tanpa I/O (TD-15); Express memakainya langsung, web boleh memakainya setelah migrasi TS. `haversineMeters` tetap di `apps/api`.

Uji batas wajib: tepat `late_after`, 1 detik setelahnya, tepat `checkin_close`, tengah malam UTC vs WIB (tanggal WIB berbeda dari UTC antara 17:00–24:00 UTC).

---

## 6. Struktur Proyek

```text
mclass/                              # monorepo (pnpm workspaces) / backend_mclass
├─ requirements/                     # Dokumen spesifikasi lengkap (00 s.d. 05)
│  ├─ 00_README_HANDOFF.md
│  ├─ 01_MRD.md
│  ├─ 02_PRD.md
│  ├─ 03_FSD.md
│  ├─ 04_TRD.md
│  └─ 05_DESIGN_SYSTEM.md
├─ packages/
│  └─ contract/                      # TS murni; tanpa Node/DB/Express
│     ├─ src/schemas/                # Zod request/response per modul (sumber OpenAPI)
│     ├─ src/errors.ts               # kode error (FSD §6)
│     ├─ src/time.ts                 # nowUtc, toWibDate, wibTimeOfDay, status hadir/terlambat
│     ├─ src/index.ts
│     └─ test/
├─ apps/
│  ├─ api/ (atau root src/)          # Express + TypeScript
│  │  ├─ prisma/                     # schema.prisma, migrations, seed
│  │  ├─ src/
│  │  │  ├─ server.ts                # bootstrap, graceful shutdown
│  │  │  ├─ app.ts                   # susun middleware & routes
│  │  │  ├─ config/                  # database.ts, env.ts
│  │  │  ├─ controllers/             # auth, announcement, calendar, roster, ...
│  │  │  ├─ services/                # auth, announcement, calendar, roster, ...
│  │  │  ├─ routes/                  # auth, announcement, calendar, roster, ...
│  │  │  ├─ middleware/              # auth.middleware.ts, error.middleware.ts
│  │  │  ├─ database/                # schema.sql, migrate.ts, seed.ts, cli-user.ts
│  │  │  ├─ utils/                   # errors.ts, jwt.ts, password.ts, google-oauth.ts, wib-time.ts, avatar-upload.ts
│  │  │  ├─ integrations/            # ai.client.ts, mailer.ts
│  │  │  └─ jobs/                    # alpa.job.ts, cleanup.job.ts, scheduler.ts
│  │  └─ test/                       # integration & contract tests
│  └─ web/                           # Vite + React (TS opsional, bertahap)
├─ openapi/                          # hasil generate dari skema Zod
├─ deploy/                           # unit systemd (api, ai), nginx.conf/Caddyfile, skrip deploy
├─ .env.example
└─ package.json

mclass-ai/                           # repo/folder terpisah (Python/Flask)
├─ app/ (main.py, routes, face_engine.py, quality.py, schemas.py)
├─ tests/  ·  requirements.txt  ·  gunicorn.conf.py

mclass-mobile/                       # repo terpisah (Flutter/Dart); konsumsi openapi/
```

**Aturan lapis:** `routes → controller → service → repository/database`. Controller tipis; aturan bisnis hanya di `service`. Modul `face-scans/` bersifat read-only (FSD §5.7, D-28, DS-08).

---

## 7. Layanan AI (Flask)

### 7.1 Tanggung jawab

| Flask **melakukan** | Flask **tidak** melakukan |
|---------------------|---------------------------|
| Deteksi wajah, jumlah wajah, kotak wajah | Menyimpan foto atau embedding |
| Penilaian kualitas (buram, gelap, wajah terlalu kecil) | Keputusan hadir/tidak, threshold |
| Menghitung embedding (L2-normalized) | Akses database |
| Menghitung kemiripan kosinus terhadap daftar embedding referensi | Autentikasi pengguna |

> **Batas tegas (TD-16):** Flask adalah proses (service systemd) terpisah dengan virtualenv Python sendiri. Tidak ada library ML/face di `apps/api`; Express hanya memanggil Flask via HTTP internal.

### 7.2 Kontrak (internal)

Semua request membawa header `X-Internal-Token: <AI_INTERNAL_TOKEN>`. Hanya dapat dijangkau dari localhost: Gunicorn di-bind ke `127.0.0.1` dan port AI **tidak** dibuka di firewall.

| Endpoint | Request | Response 200 |
|----------|---------|--------------|
| `GET /health` | — | `{ "status": "ok", "model": { "name": "...", "version": "..." } }` |
| `POST /v1/detect` | multipart `image` | `{ "count": 1, "faces": [{ "bbox": [x,y,w,h], "score": 0.99 }], "quality": { ... } }` |
| `POST /v1/embed` | multipart `image` | `{ "count": 1, "quality": { ... }, "embedding": [float × dim], "dim": 512, "model": { "name", "version" } }` — `embedding` hanya jika `count == 1` dan kualitas lolos |
| `POST /v1/verify` | multipart `image` + field `references` (JSON: array embedding) | `{ "count": 1, "quality": { ... }, "similarities": [0.71, 0.66], "similarity_max": 0.71, "model": { ... } }` |

`quality` minimal memuat: `blur_score`, `brightness`, `face_area_ratio`, `passed` (boolean) + `reasons[]` (mis. `TOO_BLURRY`, `TOO_DARK`, `FACE_TOO_SMALL`).
Error AI: HTTP 4xx/5xx dengan `{ "error": { "code": "...", "message": "..." } }`. Express memetakan ke enum `face_result` (`05_DESIGN_SYSTEM.md` §7.2): `count == 0` → `NO_FACE` (`no_face`); `count > 1` → `MULTIPLE_FACES` (`multiple_faces`); `quality.passed == false` → `LOW_QUALITY` (`low_quality`); timeout/5xx → `AI_UNAVAILABLE` (`error`, 503).

### 7.3 Pemilihan model

| Aspek | Keputusan |
|-------|-----------|
| Pendekatan | Embedding wajah + **kemiripan kosinus** (bukan klasifikasi per orang) agar siswa baru tidak perlu *training* ulang |
| Kandidat | Keluarga model ArcFace via pustaka InsightFace; alternatif: pustaka `face_recognition` (dlib). **Pilih setelah benchmark kecil pada data pilot (izin ada)**; ukur FAR/FRR, latensi CPU |
| Versi model | Disimpan di `face_templates.model_name/version` dan `attendance_attempts.model_version` |
| Ganti model | Embedding model lama **tidak kompatibel** → butuh enrollment ulang (rencanakan sebelum ganti) |
| Threshold | Satu nilai `FACE_MATCH_THRESHOLD` ditetapkan dari kurva evaluasi pilot (`TBD-kalibrasi`); karena tidak ada peninjauan manual, kalibrasi langsung menentukan false-accept vs false-reject. Catat dasar penetapannya di repo |

### 7.4 Operasional AI

- Gunicorn dengan sedikit worker; model dimuat saat startup (*warm*); `health` memverifikasi model siap.
- Batas ukuran upload sama dengan `PHOTO_MAX_MB`; gambar tidak ditulis ke disk (proses di memori).
- Log tanpa konten gambar/embedding.
- Timeout Express→Flask `AI_TIMEOUT_MS`; **tanpa retry otomatis** pada `/verify` (hindari ganda); satu retry boleh pada `/health`.

### 7.5 Penyimpanan embedding

Embedding → `float32` little-endian → enkripsi AES-256-GCM (`iv(12) | tag(16) | ciphertext`) dengan `EMBEDDING_ENC_KEY` → kolom `face_templates.embedding`. Dekripsi hanya di memori proses Express saat verifikasi. Rotasi kunci: dokumentasikan prosedur re-enkripsi.

---

## 8. Job Terjadwal

| Job | Jadwal | Fungsi |
|-----|--------|--------|
| `alpa` | Tick tiap menit; berjalan jika `now ≥ checkin_close + ALPA_DELAY_MIN` untuk hari sekolah & belum ada `job_runs(alpa, tanggal)` selesai | BR-28/29 |
| `alpa-catchup` | Saat boot | Jalankan untuk hari-hari sekolah terlewat sejak run terakhir (maks N hari) |
| `cleanup-attempts` | Harian (malam) | Hapus foto attempt lebih tua dari `ATTEMPT_PHOTO_RETENTION_DAYS` (baris attempt dipertahankan, `photo_path` dikosongkan) |
| `cleanup-auth` | Harian | Hapus sesi kedaluwarsa & `password_resets` lama |

Semua job: ambil `GET_LOCK('mclass_job_<nama>', 0)`; lanjut hanya jika berhasil; tulis `job_runs`; operasi idempoten.

---

## 9. Keamanan

### 9.1 Autentikasi, OAuth Mobile, & Sesi
- JWT HS256 (rahasia ≥ 256-bit); klaim: `sub`, `role`, `jti`, `iat`, `exp`. Setiap request terautentikasi memeriksa `auth_sessions` (`user_sessions`) (jti ada, belum dicabut, belum kedaluwarsa) dan akun aktif; perbarui `last_active_at` (maks 1×/menit). `role` ∈ `admin|guru|siswa`; guard `requireRole(...)` / `authorizeRoles(...)` bersifat eksplisit per endpoint (admin diberi akses pada endpoint staf & endpoint khusus admin). Akun yang dihapus/dinonaktifkan di DB langsung gagal pada pemeriksaan sesi.
- **Verifikasi Google OAuth (`POST /api/auth/oauth/google`):**
  - Server **tidak pernah** mempercayai `email` atau `google_id` mentah dari body klien; klien wajib mengirim `id_token` yang ditandatangani Google.
  - Server memverifikasi `id_token` terhadap Google (`iss ∈ {'accounts.google.com', 'https://accounts.google.com'}`, `exp > now`, `email_verified == true`, serta `aud` sesuai `GOOGLE_CLIENT_ID` yang dikonfigurasi).
  - Hanya mengizinkan `role = 'siswa'`. Jika email milik akun `admin`/`guru`, tolak dengan 403 `ROLE_NOT_ALLOWED`.
- Pesan error login generik (`"Login gagal! Email atau kata sandi salah."`, BR-03, `05_DESIGN_SYSTEM.md` §8.2); *timing* disamakan (jalankan hash pembanding palsu bila user tidak ada).
- Logout & ganti sandi mencabut sesi (BR-05).

### 9.2 Rate limiting (`USULAN`)

| Endpoint | Batas |
|----------|-------|
| Login & OAuth (per IP + identity) | 5–10 percobaan / 5 menit, lalu 429 (backoff) |
| `forgot-password` | Per email & per IP; cooldown 60 dtk; maks 5/jam |
| `verify-otp` | Maks 5 salah per OTP (BR-06) |
| `attendance/check-in` | Maks `ATTEMPT_MAX_PER_DAY`/hari/siswa + 10/menit/IP |
| Upload umum | 30/menit/pengguna |
| Global | 300/menit/IP |

### 9.3 Validasi & injeksi
- Semua input divalidasi ketat (tolak field tak dikenal → cegah *mass assignment*).
- Query terparameter (`mysql2` `?` placeholders / Prisma); tidak ada konkatenasi string SQL.
- Output tidak pernah menyertakan `password_hash`, `otp_hash`, embedding, path file internal.

### 9.4 Header & CORS
- `helmet` default; HSTS di proxy. CORS hanya `CORS_ORIGINS` (mobile native tidak butuh CORS).
- `Content-Type` ketat; batas ukuran body JSON terukur.

### 9.5 File
- Nama file acak (UUID) + folder per jenis; **tidak** pernah memakai nama dari klien; cegah *path traversal*.
- Verifikasi *magic bytes* (JPG/PNG/WebP untuk avatar ≤ 2 MB; PDF/JPG/PNG untuk lampiran izin ≤ 5 MB); proses ulang gambar dengan `sharp` (buang metadata/EXIF GPS).
- **URL bertanda tangan:** `GET /api/files/<jenis>/<id>?exp=<unix>&sig=<HMAC-SHA256(jenis|id|exp)>`; kedaluwarsa `FILE_URL_TTL`; perbandingan *constant-time*. Pembuat URL memastikan pemanggil berhak atas file itu **saat URL dibuat**.
- Lampiran izin & foto presensi hanya terlihat oleh: pemilik (siswa) dan staf (`admin`/`guru`).

### 9.6 Data pribadi & biometrik (`01_MRD.md` R-01 & `05_DESIGN_SYSTEM.md` DS-07)

| Kontrol | Implementasi |
|---------|--------------|
| Persetujuan | `students.biometric_consent_at` wajib sebelum enrollment (BR-20) |
| Minimisasi | Simpan embedding + 1 foto referensi; foto attempt dihapus sesuai retensi |
| Enkripsi | Embedding AES-GCM (TD-08); disk/backup terenkripsi |
| Akses | Hanya staf (`admin`/`guru`) untuk melihat foto hasil scan (read-only); akses tercatat (FSD §7) |
| Tanpa bocoran pihak ketiga | Hapus pemanggilan `ui-avatars.com` pada FE (DS-07); gunakan foto dari API atau inisial lokal |
| Hak penghapusan | Prosedur operasional: hapus `face_templates` + file terkait atas permintaan |
| Logging | Tanpa sandi, token, OTP, embedding, isi foto, koordinat presisi di log umum |
| Hukum | UU PDP No. 27/2022 memperlakukan data biometrik sebagai data pribadi spesifik, dan data anak butuh perhatian khusus — **konsultasikan dengan pihak sekolah/penasihat hukum** (OQ-09); dokumen ini bukan nasihat hukum |

### 9.7 Anti-kecurangan presensi

| Ancaman | Mitigasi v1 | Lanjutan |
|---------|-------------|----------|
| Lokasi palsu | `is_mocked`, ambang akurasi, log attempt | Deteksi anomali kecepatan/lompatan |
| Titip absen (orang lain) | Verifikasi wajah otomatis (satu ambang, dikalibrasi) + log scan yang dapat ditinjau admin/guru | Liveness; peninjauan sampel berkala |
| Foto dari foto/layar | Wajib kamera langsung (klien), pemeriksaan kualitas, log scan untuk tinjauan pasca-kejadian | **Liveness — sangat disarankan naik ke P1** |
| Replay request | Waktu server otoritatif; satu record/hari; token sesi | Nonce per presensi |
| Brute force wajah | Batas attempt/hari | — |
| Klien dimodifikasi | Server tak mempercayai status dari klien | Play Integrity (di luar v1) |

> **Risiko residu v1:** presensi wajah **otomatis tanpa peninjauan manual** — false-accept (foto/layar bagus, orang mirip) maupun false-reject (siswa sah ditolak) langsung memengaruhi rekap. Mitigasi: kalibrasi ambang dengan data pilot, multi-sampel enrollment, log scan yang dapat ditinjau admin/guru, dan keputusan OQ-10 (penanganan false-reject). Dicatat sebagai R-02/R-03 (`01_MRD.md`).

### 9.8 Operasional
- Rahasia hanya via env/secret store; tidak ada di repo. `npm audit`/Dependabot terjadwal.
- Pengguna DB aplikasi berprivilege minimum (bukan root); backup terenkripsi.
- Respons 500 tidak membocorkan detail internal; `requestId` dikembalikan di header untuk korelasi log.

---

## 10. Performa & Kapasitas

| Aspek | Rencana |
|-------|---------|
| Skala awal | ~30 siswa pilot; desain nyaman hingga beberapa ratus siswa/1 sekolah |
| Beban puncak | Gelombang presensi sekitar jendela masuk: banyak check-in dalam beberapa menit → AI menjadi bottleneck |
| Mitigasi AI | Pra-cek sebelum AI; worker AI > 1; pantau latensi; batas ukuran gambar & resize di klien |
| Polling dashboard | Interval 30 dtk × sedikit guru → ringan; cache memori 5 dtk untuk `dashboard/summary` (opsional) |
| Indeks | Sesuai DDL §4.2; tinjau `EXPLAIN` untuk query rekap |
| Pagination | Wajib untuk daftar (default 20, maks 100) |
| Uji beban | Skenario: N siswa check-in serentak (N diatur) → ukur p95 & error rate (M8) |

---

## 11. Observabilitas

- **Log:** JSON (`pino`), tiap request berisi `requestId`, `userId`, `route`, `status`, durasi; redaksi field sensitif.
- **Health:** `GET /api/health` (db, ai). Dipakai monitor uptime, pengecekan systemd/skrip watchdog, dan lencana status server pada halaman login (`05_DESIGN_SYSTEM.md` §10).
- **Metrik minimum (log/endpoint internal):** jumlah attempt per outcome, latensi AI, jumlah job alpa terproses, error 5xx.
- **Alert dasar:** AI down, DB down, job alpa gagal, disk hampir penuh.

---

## 12. Deployment & Operasi

### 12.1 Topologi (host Linux, tanpa Docker — TD-17, OQ-07)

| Komponen | Port publik | Cara jalan | Catatan |
|----------|:-----------:|------------|---------|
| `proxy` (Nginx/Caddy) | 80/443 | service sistem | TLS (Let's Encrypt), meneruskan `/api` ke `api` |
| `api` (Express) | — (listen `127.0.0.1:3000`) | systemd atau PM2, `Restart=always` | Healthcheck `/api/health`; Node LTS dikunci (`.nvmrc`/`engines`) |
| `ai` (Flask + Gunicorn) | — (listen `127.0.0.1:5000`) | systemd + virtualenv Python | **Hanya localhost**; versi Python & dependensi dikunci `requirements.txt` |
| `db` (MySQL 8) | — (bind `127.0.0.1`/socket) | service sistem | Tidak dipublikasikan; user DB berprivilege minimum |
| Direktori `UPLOAD_DIR` | — | direktori di luar web root | Izin `0700`, milik user layanan; tercakup backup |

Aturan host: firewall hanya membuka 80/443 (dan SSH terbatas); layanan berjalan sebagai user non-root; log lewat `journalctl`/file dengan rotasi.

HTTPS **wajib**: aplikasi mobile (Android memblokir cleartext secara default) dan fitur kamera/GPS sensitif keamanan.

### 12.2 Pipeline CI/CD (minimum)
`lint → typecheck → unit test → integration test (MySQL test) → build (`tsc`, bundel web) → deploy staging via skrip di `deploy/` (rsync/git pull + `pnpm install --frozen-lockfile` + restart service) → smoke test`. Migrasi DB dijalankan sebagai langkah terpisah sebelum rilis API; migrasi harus *backward compatible* satu versi.

### 12.3 Backup & pemulihan

| Item | Kebijakan (`USULAN`) |
|------|----------------------|
| MySQL | Dump harian terenkripsi, retensi 14 hari + mingguan 8 minggu |
| Uploads | Sinkron harian ke penyimpanan terpisah |
| Uji restore | Minimal sekali sebelum pilot dan tiap kuartal |
| RPO/RTO | RPO ≤ 24 jam; RTO beberapa jam (`USULAN`) |

### 12.4 Skrip operator (CLI)

| Skrip | Fungsi |
|-------|--------|
| `import-roster <file.csv>` | Impor/upsert siswa & kelas (kolom: `nisn, nama, jenis_kelamin, kelas, nomor_absen, tanggal_lahir?, nama_wali?, no_wali?`); laporan baris gagal |
| `hash-password` / `npm run user -- ...` (`src/database/cli-user.ts`) | Membaca sandi & membuat hash argon2id / mengelola akun admin/guru di database |
| `seed-dev` (`npm run db:seed`) | Data dev (≈30 siswa dummy sesuai FE) — **dilarang di production** |
| `set-geofence <lat> <lng> <radius>` | Atur `school_settings` sampai UI/API P1 tersedia |

---

## 13. Strategi Pengujian

| Level | Cakupan | Alat |
|-------|---------|------|
| Unit | geo (Haversine), waktu (WIB/UTC), status hadir/terlambat, keputusan wajah (cocok / tidak cocok), bucket agregasi, aturan izin (overlap, rentang), kebijakan sandi | vitest/jest |
| Integrasi | Tiap endpoint FSD §5: sukses, validasi, 401/403/404, kasus bisnis (termasuk OAuth Google siswa: token valid/invalid, butuh NISN, klaim NISN, tolak admin/guru; pengumuman & kalender); MySQL nyata | supertest + MySQL test |
| Kontrak AI | Express terhadap *mock server* Flask (respons sukses, no_face, multi-face, timeout, 5xx) + uji Flask nyata dengan gambar uji | |
| Job | `alpa` idempoten, hari libur, izin disetujui, catch-up | |
| Keamanan | Akses lintas-siswa → 404; role salah → 403 (guru ditolak di endpoint 🛡 admin; admin/guru ditolak di endpoint siswa & OAuth mobile); akun dihapus → token ditolak; rate limit; unggah berkas berbahaya; URL bertanda tangan kedaluwarsa | |
| Beban | Check-in serentak, polling dashboard | k6 atau sejenis |
| Lapangan (UAT) | Geofence nyata di sekolah, jaringan seluler, berbagai ponsel | Checklist go-live |

**Uji invarian kritis:** (1) `Σ bucket = total siswa`; (2) satu record/siswa/hari; (3) siswa A tak bisa membaca data siswa B; (4) AI mati → tidak ada presensi lolos; (5) waktu hadir ditentukan server.

Target cakupan `USULAN`: ≥ 80% baris pada modul aturan bisnis (attendance, leave, recap, auth).

---

## 14. Roadmap Implementasi (Milestone)

> Ukuran relatif: **S** kecil · **M** sedang · **L** besar. Kerjakan berurutan; tiap milestone berakhir dengan *exit criteria* yang teruji. FE mengintegrasikan paralel (kolom "FE & Design System").

| M | Nama | Isi | FE & Design System (`00` §8, `05` §12) | Ukuran | Exit criteria |
|---|------|-----|---------------------------------------|:------:|---------------|
| **M0** | Fondasi | Monorepo/workspace, paket `contract` (Zod, error, waktu WIB), skema DB (15 tabel), env, skrip dev lokal & unit systemd (api/ai stub), migrasi baseline (§4.2), error handler & kode error, request-id, logging, health, CI, OpenAPI skeleton | DS-01, DS-02, DS-04 (token warna & tema) | M | service `api` dan `ai` berjalan; `/api/health` hijau; migrasi & seed berjalan; `tsc` lulus |
| **M1** | Auth & Sesi | Login admin/guru (`/auth/admin/login`), siswa/admin-mobile (`/auth/login`; `guru` ditolak 403), **login Google OAuth siswa mobile (`/auth/oauth/google` + tautan NISN)**, register **siswa**, OTP lupa sandi (**siswa**, SMTP), logout, sesi, guard role (`admin`/`guru`/`siswa`), `/me` GET/PATCH, ganti sandi, avatar, daftar sesi, rate limit, helper `hash-password` / `cli-user` | FC-01, FC-02, DS-08 (hapus halaman register & lupa sandi web), FC-04, Mobile Google Sign-In | L | Login web & OAuth mobile siswa berjalan; US-01…06 (termasuk US-02B), 62, 70 lulus uji |
| **M2** | Data Induk & Konfigurasi | `classes`, import roster CLI & `/api/roster`, `school_settings`, `attendance_schedules`, util hari sekolah/libur, `GET /school/config`, seed akun admin/guru di DB | FC-07 (koordinat dari API), DS-05 (nama sekolah dari `school/config`) | M | Roster 30 siswa ter-impor; konfigurasi terbaca klien |
| **M3** | Wajah & Presensi Inti | Klien AI, Flask (detect/embed/verify), enrollment, check-in (geofence, jendela, mock, keputusan wajah satu ambang → langsung tercatat), attempts, late-reason, `today`, riwayat; layanan notifikasi (insert-only) | FC-07, FC-08, FC-09 | L | Presensi end-to-end di perangkat nyata; invarian 2,4,5 lulus |
| **M4** | Surat Izin | Ajukan, daftar/detail, lampiran, batal, review, efek ke presensi, notifikasi | FC-05 | M | US-20/21 lulus; BR-25/27 teruji |
| **M5** | Monitoring & Hasil Scan | `dashboard/summary`, `recap/*`, `recap/location`, `face-scans*` (read-only), **job alpa** + catch-up | FC-03, FC-06, DS-07 (hapus `ui-avatars.com`), DS-08 (read-only scan wajah) | L | Angka dashboard konsisten (invarian 1); alpa idempoten |
| **M6** | Pengumuman, Kalender, Notifikasi | CRUD pengumuman, `calendar/events`, `calendar/summary`, `calendar/attendance`, endpoint notifikasi (list/read/read-all/unread-count), pemicu BR-50 | FC-03 | M | US-50…52, 60 lulus |
| **M7** | Laporan & Profil | Export Excel (label baku **"Alpa"** DS-03), PDF bulanan, profil siswa, wali kelas | DS-03 | M | Excel & PDF sesuai data; US-30/31/44/61 lulus |
| **M8** | Hardening & Kesiapan Pilot | Tinjauan keamanan (§9), uji beban, backup/restore teruji, retensi job, kalibrasi threshold, checklist go-live, dokumentasi operasional | DS-06 (audit aksesibilitas dasar) | M | Semua uji lulus; UAT lapangan disetujui; OQ P0 tertutup |
| **P1** | Setelah pilot | FCM, hapus sesi lain, API geofence/jadwal, reset enrollment | — | — | Berdasarkan evaluasi pilot |

**Ketergantungan penting:** notifikasi (insert) dipakai sejak M3 → buat `NotificationService` kecil di M3, endpoint baca di M6. Job alpa (M5) bergantung pada izin (M4) dan jadwal/libur (M2).

### 14.1 Checklist Go-Live (ringkas)
- [ ] Koordinat & radius resmi terisi & diuji di lapangan (`school_settings`)
- [ ] Jadwal presensi 7 hari terisi (`attendance_schedules`)
- [ ] Roster ter-impor; akun admin/guru dibuat di DB; wali kelas di-assign (`classes.homeroom_teacher_id`)
- [ ] `GOOGLE_CLIENT_ID` (SHA-1 signing certificate Android / iOS / Web client ID) terdaftar di Google Cloud Console & `.env`
- [ ] Threshold wajah dikalibrasi & dicatat
- [ ] SMTP OTP teruji
- [ ] HTTPS valid; CORS hanya origin web
- [ ] Backup & restore teruji
- [ ] Persetujuan biometrik terdokumentasi (OQ-09)
- [ ] Perubahan FE (`FC-01`…`FC-09`) & Design System (`DS-05`, `DS-07`, `DS-08`) terverifikasi
- [ ] Rahasia produksi diganti; `seed-dev` dinonaktifkan

---

## 15. Pagar Pembatas Cakupan (Anti-Scope-Creep)

1. Endpoint/tabel baru **hanya** jika ada US/BR di PRD/FSD — jika tidak, perbarui dokumen dulu.
2. Kontrak FE yang sudah ada (`/auth/admin/login`, `/auth/me`, `/auth/logout`, bentuk error) **tidak diubah**.
3. Role hanya `admin`, `guru`, `siswa` — tidak menambah role lain, integrasi WhatsApp, reverse geocoding, atau layanan pihak ketiga di luar daftar (SMTP & Google OAuth mobile siswa) tanpa keputusan baru (`D-xx`).
4. Nilai ambang & jam tidak di-hardcode; semua melalui konfigurasi.
5. Setiap perubahan keputusan dicatat di `00_README_HANDOFF.md` (Decision Log).
6. **Stack terkunci:** Express+TypeScript+MySQL · Flask (internal) · Flutter · Vite/React. Tidak mengganti Flutter dengan React Native, tidak memindahkan face recognition ke Node, tidak menambah database/antrian/layanan baru tanpa `D-xx`/`TD-xx` baru.
7. **Flutter tidak memakai paket TypeScript.** Berbagi kontrak ke mobile hanya lewat OpenAPI.
8. Tidak memperkenalkan Docker/Kubernetes/antrian baru tanpa keputusan `TD-xx` baru (TD-17).
9. Kontrak semantik enum, label, dan format data mengacu pada `05_DESIGN_SYSTEM.md` §7–§9.
10. Pekerjaan di luar daftar milestone §14 tidak dikerjakan sebelum dokumen diperbarui.

---

## 16. Risiko Teknis

| ID | Risiko | Dampak | Mitigasi |
|----|--------|--------|----------|
| TR-01 | Latensi AI di CPU lambat saat gelombang presensi | Presensi lambat/timeout | Pra-cek; resize di klien; worker >1; ukur di M8; opsi GPU bila perlu |
| TR-02 | Akurasi wajah rendah (pencahayaan, kamera murah, wajah remaja berubah) | False reject/accept **langsung berdampak ke rekap** (tanpa review manual) | Multi-sampel enrollment; kalibrasi ambang; enrollment ulang berkala; log scan untuk tinjauan; OQ-10 |
| TR-03 | GPS indoor tidak akurat vs radius 50 m | Penolakan sah | Ambang akurasi; panduan GPS; OQ-10 |
| TR-04 | Kontrak FE–BE melenceng | Integrasi gagal | OpenAPI + contract test; Change List FE (`00_README_HANDOFF.md` §8) & `05_DESIGN_SYSTEM.md` §7 |
| TR-05 | Pergantian model AI | Embedding tak kompatibel | Simpan versi; rencana re-enrollment |
| TR-06 | Kebocoran file/foto | Pelanggaran privasi | URL bertanda tangan, penyimpanan privat, audit akses, hapus `ui-avatars.com` (DS-07) |
| TR-07 | Server tunggal mati | Layanan berhenti | Backup, healthcheck, restart otomatis; RTO terdefinisi |
| TR-08 | Zona waktu/hari berganti (UTC vs WIB) | Status/rekap salah | TD-03 + uji batas tengah malam |
| TR-09 | Tidak ada peninjauan manual: siswa sah yang gagal verifikasi berujung alpa | Tinggi | Kalibrasi + multi-sampel; keputusan OQ-10 (mekanisme koreksi); liveness P1 |

---

## 17. Status Artefak (checkpoint kelanjutan)

| Artefak | Status | Catatan |
|---------|:------:|---------|
| Dokumen Requirements (`00_README_HANDOFF.md` s.d. `05_DESIGN_SYSTEM.md`) | ✅ Selesai | Lengkap di `requirements/`, selaras v1.2–v1.4 |
| Skema Database & Migrasi (`src/database/schema.sql`, `migrate.ts`, `seed.ts`) | ✅ Berjalan | Mencakup `users` (dengan `google_id` & `oauth_provider`), `classes`, `student_roster`, `user_sessions`, `announcements`, `school_settings`, `attendance_schedules`, `attendance_records` |
| Modul Auth, Profil, Avatar, Sesi, & Google OAuth Siswa (`src/services/auth.service.ts`) | ✅ Selesai | US-01, US-02, US-02B, US-03, US-04, US-06, US-61, US-62 |
| Modul Pengumuman & Kalender (`src/services/announcement.service.ts`, `calendar.service.ts`) | ✅ Selesai | US-13, US-30, US-50, US-51, US-52 |
| Mesin wajah in-process (Node) | **Dibatalkan** | Diganti Flask (TD-16) |
| Paket TS bersama untuk Flutter | **Dibatalkan** | Diganti OpenAPI (TD-13) |

**Langkah berikutnya (urutan):** Lanjutkan modul presensi wajah & surat izin sesuai Milestone §14. Jika sesi terputus, lanjutkan dari milestone pertama yang *exit criteria*-nya belum teruji; jangan memulai ulang dari awal.
