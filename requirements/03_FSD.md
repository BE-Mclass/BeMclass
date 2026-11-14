# 03 — Functional Specification Document (FSD)

> **Produk:** M-Class Backend · **Versi:** 1.4 · **Tanggal:** 12 November 2026
> **Fungsi dokumen:** Kontrak perilaku sistem — aturan bisnis (BR), state machine, kontrak semantik UI ↔ API, dan **spesifikasi API**. FE dan BE mengimplementasikan dokumen ini sebagai acuan bersama.
> Rujukan: PRD `US-xx` (`02_PRD.md`) · MRD (`01_MRD.md`) · TRD (`04_TRD.md`) · Design System (`05_DESIGN_SYSTEM.md`) · Keputusan `D-xx` & Pertanyaan terbuka `OQ-xx` (`00_README_HANDOFF.md`).
> Label: `USULAN`/`TBD` = nilai konfigurasi yang belum final.
> **Revisi v1.1:** (1) akun admin/guru **tanpa registrasi** (dikelola di database; web hanya login & logout); (2) presensi wajah **otomatis** tanpa validasi guru — halaman "validasi" menjadi **hasil scan (read-only)**; (3) **role `admin`** ditambahkan (akses penuh); (4) **presensi pulang dihapus** (hanya presensi masuk).
> **Revisi v1.2 (koreksi stack):** (1) **Backend = Express + TypeScript + MySQL**, satu database; (2) **Flask tetap layanan AI internal** — tidak ada mesin wajah in-process di Node; (3) **Flutter tetap untuk mobile** — kontrak lewat **OpenAPI**, bukan paket TypeScript bersama; (4) **Web Vite/React dipertahankan**, migrasi ke TS opsional/bertahap memakai tipe dari paket kontrak `packages/contract`; (5) skema Prisma (15 tabel P0) = sumber kebenaran skema DB.
> **Revisi v1.3 (OAuth Mobile Murid):** Penambahan fitur **Login Google OAuth khusus siswa (`siswa`) di aplikasi mobile (`POST /api/auth/oauth/google` / `POST /api/auth/mobile/oauth/google`)**, termasuk mekanisme penautan otomatis ke email siswa terdaftar atau klaim NISN baru dari roster (`BR-09B`).
> **Revisi v1.4 (Penyelarasan Design System & MRD):** (1) Integrasi **Kontrak Semantik API ↔ UI** (`05_DESIGN_SYSTEM.md` §7), pedoman pesan error siap tampil Bahasa Indonesia (§8), format data tampilan vs API (§9), dan pola interaksi (§10); (2) penyelarasan BR-43 & spesifikasi pengumuman dengan dukungan `status` (`draft`|`published`) serta pemetaan alias bilingual (`type`/`category`, `audience`/`target_audience`, `event_date`/`publish_date`); (3) dokumentasi endpoint kalender presensi siswa (`GET /api/calendar/attendance`) dan manajemen roster (`GET/POST/PUT/DELETE /api/roster`).

---

## 1. Konvensi API

### 1.1 Dasar & Format Data (`05_DESIGN_SYSTEM.md` §9)

| Item | Format API | Format Tampilan UI (`05_DESIGN_SYSTEM.md` §9) |
|------|------------|-----------------------------------------------|
| Base path | `/api` (web dev proxy `/api` → `localhost:3000`) | — |
| Format payload | JSON (`Content-Type: application/json`); upload memakai `multipart/form-data` | — |
| Autentikasi | Header `Authorization: Bearer <JWT>` kecuali endpoint publik | — |
| Bahasa pesan | Bahasa Indonesia (sopan, ringkas, menjelaskan apa yang terjadi & tindakan perbaikan) | Bahasa Indonesia |
| Penamaan field | `snake_case` (kecuali `{token, user}` kontrak auth yang sudah dipakai FE) | — |
| Instant waktu | ISO-8601 **UTC** (`2026-11-02T00:12:34Z`) | — |
| Tanggal | `YYYY-MM-DD` (kalender WIB) | `Jumat, 14 Mar 2026` / `12 Mei 2013` (`id-ID`) |
| Jam harian | `HH:mm` (WIB) | `07.15 WIB` (mobile) / `06:45 WIB` (web) |
| Bulan | `YYYY-MM` | `Oktober 2026` |
| Persentase | Integer `0–100` (tanpa desimal) | `90%` |
| Jarak | Angka (meter) | `72 m` |
| Kecocokan wajah | `similarity` desimal `0–1` | `Match 99.4%` (klien × 100, 1 desimal) |
| NISN | String 10 digit angka | 10 digit tanpa spasi |
| Kelas | `class.name` string siap tampil | `Kelas 7` |
| Gender | `L` \| `P` | L / P |
| Kontrak | **OpenAPI 3** yang di-generate dari skema Zod (`packages/contract`, TRD §1.2). Flutter memakai OpenAPI; web memakai tipe dari paket yang sama (bila TS). Flutter **tidak** memakai paket TypeScript | — |

### 1.2 Bentuk respons

**Sukses auth** (mengikuti kontrak FE yang ada):
```json
{ "token": "<jwt>", "user": { "...": "..." } }
```
**Sukses lainnya:**
```json
{ "data": { }, "meta": { } }
```
`meta` hanya untuk daftar berpaginasi:
```json
{ "data": [ ], "meta": { "page": 1, "limit": 20, "total": 57, "total_pages": 3 } }
```
Parameter paginasi: `page` (default 1), `limit` (default 20, maks 100).

**Error** (selalu):
```json
{
  "message": "Pesan yang dapat ditampilkan ke pengguna",
  "code": "KODE_MESIN",
  "errors": { "email": "Format email tidak valid" }
}
```
- `errors` (objek field→pesan) hanya ada pada HTTP 400 `VALIDATION_ERROR` (FE membacanya per-field dan menampilkannya di bawah input dengan border merah, `05_DESIGN_SYSTEM.md` §10).
- Tubuh error bisa membawa `details` untuk kasus bisnis (mis. jarak & radius, atau info profil OAuth saat meminta NISN).
- **Pedoman teks `message` (`05_DESIGN_SYSTEM.md` §8.2–8.3):**
  - Login gagal (401): `"Login gagal! Email atau kata sandi salah."`
  - Akses ditolak (403): `"Akses ditolak."` (atau penjelasan spesifik yang sopan)
  - Sandi < 8: `"Kata sandi minimal 8 karakter."`
  - OTP: `"Kode OTP harus 6 digit."`
  - NISN: `"NISN harus 10 digit"`
  - Konfirmasi sandi: `"Password tidak cocok"`
  - Presensi berhasil: `"Absensi Masuk Berhasil!"`
  - Penolakan presensi menyebut penyebab + tindakan perbaikan (contoh: `"Anda berada 72 m dari sekolah (batas 50 m). Mendekatlah ke area sekolah lalu coba lagi."`).

### 1.3 Status HTTP

| Kode | Arti |
|------|------|
| 200/201/204 | Sukses / dibuat / tanpa isi |
| 400 | Validasi input gagal (`VALIDATION_ERROR`) |
| 401 | Token tidak ada/invalid/kedaluwarsa/dicabut, kredensial login salah, atau `id_token` OAuth tidak valid → **FE akan logout otomatis** pada 401 (kecuali endpoint login/OAuth) |
| 403 | Role tidak berhak / akun tidak aktif |
| 404 | Resource tidak ada (atau bukan milik pemanggil) |
| 409 | Konflik (duplikat, sudah presensi, NISN/akun OAuth sudah diklaim) |
| 413 | File terlalu besar |
| 415 | Tipe file tidak didukung |
| 422 | Aturan bisnis menolak (di luar radius, di luar jam, butuh NISN saat OAuth pertama kali, dst.) |
| 429 | Terlalu banyak permintaan |
| 500/503 | Kesalahan server / layanan AI tidak tersedia |

> **Penting:** Respons 401 pada endpoint login/OAuth **tidak** memicu redirect (FE memakai `auth:false`), tetapi 401 pada endpoint terautentikasi memicu logout. Karena itu **jangan** memakai 401 untuk kasus "tidak punya izin" (pakai 403).

### 1.4 URL file & Privasi Avatar (`05_DESIGN_SYSTEM.md` DS-07)

Foto (presensi, referensi wajah, avatar) dan lampiran **tidak publik**. Respons menyertakan `*_url` bertanda tangan & berumur pendek (`FILE_URL_TTL`, `USULAN` 10 menit), sehingga bisa dipakai tag `<img src>` tanpa header Authorization. Klien **tidak boleh** mengirim nama siswa ke layanan pihak ketiga seperti `ui-avatars.com` (DS-07); gunakan URL foto dari API atau inisial lokal. Detail: TRD §9.5.

---

## 2. Peran & Hak Akses

Role: **`admin`** (Label UI: **Admin**), **`guru`** (Label UI: **Guru**), **`siswa`** (Label UI: **Siswa**). Istilah **staf** = `admin` atau `guru`.

| Kemampuan | `siswa` | `guru` | `admin` |
|-----------|:------:|:------:|:------:|
| Login mobile sandi (`/auth/login` / `/auth/mobile/login`) | ✅ | ❌ (403) | ✅ |
| Login mobile Google OAuth (`/auth/oauth/google`) | ✅ | ❌ (403) | ❌ (403) |
| Login web (`/auth/admin/login` / `/auth/web/login`) | ❌ (403) | ✅ | ✅ |
| Registrasi mandiri | ✅ (mobile, NISN di roster) | ❌ (dikelola di DB) | ❌ (dikelola di DB) |
| Lupa sandi via OTP | ✅ | ❌ | ❌ |
| Presensi, enrollment wajah, surat izin sendiri, riwayat sendiri, PDF bulanan | ✅ | ❌ | ❌ |
| Dashboard/rekap/lokasi semua kelas | ❌ | ✅ | ✅ |
| Hasil scan wajah (**lihat saja**) | ❌ | ✅ | ✅ |
| Proses surat izin (setujui/tolak) | ❌ | ✅ | ✅ |
| Buat/ubah/hapus pengumuman & kelola roster (`/api/roster`) | ❌ | ✅ | ✅ |
| Lihat pengumuman/kalender (sesuai target) | ✅ | ✅ | ✅ |
| Export Excel kelas | ❌ | ✅ | ✅ |
| Notifikasi & profil/pengaturan akun sendiri | ✅ | ✅ | ✅ |
| Atur geofence & jadwal presensi (P1) | ❌ | ❌ | ✅ |
| Reset enrollment wajah siswa (P1) | ❌ | ❌ | ✅ |

**Admin = akses penuh** (D-29): seluruh kemampuan `guru` ditambah kemampuan khusus admin. Fungsi personal siswa (presensi, surat izin sendiri, riwayat/PDF sendiri, serta login Google OAuth murid) terikat identitas siswa sehingga **tidak berlaku** bagi admin/guru. Implementasi: guard `requireRole('guru','admin')` / `authorizeRoles('admin','guru')` untuk endpoint staf, `authorizeRoles('admin')` untuk khusus admin, `authorizeRoles('siswa')` untuk endpoint personal siswa.

Aturan umum: siswa **hanya** mengakses baris miliknya (`student_id` diambil dari token, tidak pernah dari body). Akses ke resource milik orang lain → **404** (bukan 403) agar tidak membocorkan keberadaan.

---

## 3. Aturan Bisnis (Business Rules)

### 3.1 Autentikasi

| ID | Aturan |
|----|--------|
| BR-01 | **Kebijakan sandi:** ≥ 8 karakter, mengandung minimal 1 huruf dan 1 angka. Hash: argon2id. (Untuk akun siswa yang dibuat langsung via Google OAuth tanpa sandi awal, `password_hash` boleh `NULL` atau diisi hash acak yang tidak dapat ditebak hingga siswa mengatur sandi). |
| BR-02 | **Resolusi `identity`:** jika cocok pola 10 digit angka → cari berdasarkan NISN siswa; jika mengandung `@` → cari berdasarkan email (case-insensitive, disimpan lowercase). |
| BR-03 | `POST /auth/admin/login` (alias `/auth/web/login`) hanya untuk `admin` dan `guru`; `POST /auth/mobile/login` hanya untuk `siswa` (dan `POST /auth/login` mendukung login terpadu sesuai tipe klien). Role tidak sesuai → 403 `ROLE_NOT_ALLOWED` (`"Akses ditolak."`). Kredensial salah/akun tak ditemukan → 401 `INVALID_CREDENTIALS` (`"Login gagal! Email atau kata sandi salah."`, pesan sama untuk keduanya). Admin yang login di mobile tidak memperoleh fungsi personal siswa (presensi, enrollment, surat izin sendiri → 403 sesuai §2). |
| BR-04 | Akun berstatus `inactive` → 403 `ACCOUNT_NOT_ACTIVE`. Status dicek **setelah** sandi/token OAuth benar (agar tidak membocorkan keberadaan akun). Akun yang **dihapus** dari database tidak ditemukan → 401 `INVALID_CREDENTIALS`. |
| BR-05 | **Sesi:** setiap login (sandi maupun OAuth) membuat baris `auth_sessions` / `user_sessions` (jti). Token valid jika: tanda tangan benar, belum kedaluwarsa, sesi belum `revoked_at`. `logout` mencabut sesi saat ini. Ganti/reset sandi mencabut **sesi lain** (reset: semua). Masa berlaku: web default `SESSION_TTL_WEB` (`USULAN` 7 hari; `remember` memperpanjang hingga 30 hari), mobile `SESSION_TTL_MOBILE` (`USULAN` 30 hari). |
| BR-06 | **OTP:** 6 digit acak kriptografis; disimpan ter-hash; berlaku `OTP_TTL` (`USULAN` 10 mnt); maks `OTP_MAX_ATTEMPTS` (`USULAN` 5) salah → OTP dihanguskan; kirim ulang: cooldown `OTP_RESEND_COOLDOWN` (`USULAN` 60 dtk), maks `OTP_MAX_SENDS_PER_HOUR` (`USULAN` 5). **Hanya akun `siswa`:** email tak terdaftar, atau milik admin/guru, mengembalikan respons **identik** (200) tanpa mengirim OTP. |
| BR-07 | Verifikasi OTP benar → dikeluarkan `reset_token` (acak, sekali pakai, `RESET_TOKEN_TTL` `USULAN` 15 mnt, disimpan ter-hash). |
| BR-08 | **Register siswa:** NISN harus ada di `students`/`student_roster` dan `user_id` kosong; email unik. Berhasil → buat `users(role=siswa,status=active)` dan tautkan ke baris roster siswa. |
| BR-09 | **Akun admin/guru** dibuat, diubah, dan dihapus **langsung di database** (insert/update/delete); tidak ada endpoint registrasi, aktivasi, OAuth, maupun lupa sandi untuk role ini. Sandi tersimpan sebagai hash argon2id (helper CLI `hash-password` / `cli-user`, TRD §12.4). `classes.homeroom_teacher_id` hanya boleh menunjuk akun `guru`. |
| BR-09B | **Login Google OAuth Siswa (Mobile):** Khusus `role=siswa` di tampilan mobile. Klien Flutter mengirim `id_token` Google (dan `nisn` opsional 10 digit). Server memverifikasi `id_token` ke Google (signature, `exp`, `iss`, `aud` terhadap daftar `GOOGLE_CLIENT_ID`, dan `email_verified=true`; gagal → 401 `INVALID_OAUTH_TOKEN`). Resolusi akun:<br>1. **Berdasarkan `google_id` (`sub`):** jika ditemukan di `users`, pastikan `role=siswa` (selain itu → 403 `ROLE_NOT_ALLOWED`) dan akun aktif (nonaktif → 403 `ACCOUNT_NOT_ACTIVE`), lalu buat sesi mobile.<br>2. **Berdasarkan `email` Google:** jika `google_id` belum ada tetapi `email` cocok dengan baris `users` yang sudah ada: jika `role != siswa` → 403 `ROLE_NOT_ALLOWED`; jika `users.google_id` sudah terisi `sub` berbeda → 409 `OAUTH_ACCOUNT_CONFLICT`; jika valid → tautkan `google_id = sub` ke akun `siswa` tersebut dan buat sesi mobile.<br>3. **Akun baru (belum ada di `users`):** wajib menyertakan `nisn` (10 digit). Jika `nisn` tidak dikirim → 422 `OAUTH_NISN_REQUIRED` (beserta `details: { requires_nisn: true, email, name, picture }` dari token Google agar UI mobile dapat menampilkan form konfirmasi NISN). Jika `nisn` dikirim: cek di `students`/`student_roster`; jika tidak ada/nonaktif → 422 `NISN_NOT_IN_ROSTER`; jika `user_id` sudah terisi → 409 `NISN_ALREADY_REGISTERED`; jika valid → buat baris `users(role='siswa', status='active', google_id=sub, oauth_provider='google')`, tautkan ke `user_id` roster siswa, dan langsung keluarkan sesi JWT mobile. |

### 3.2 Presensi

| ID | Aturan |
|----|--------|
| BR-10 | **Hari sekolah:** hari-dalam-minggu memiliki `is_school_day = true` pada `attendance_schedules` **dan** tidak ada pengumuman `type=libur` (`category=holiday`, `status=published`) yang mencakup tanggal tersebut (`event_date..end_date`). |
| BR-11 | **Jendela presensi (WIB):** diterima hanya jika `checkin_open ≤ jam sekarang ≤ checkin_close`. Di luar itu → 422 `OUTSIDE_TIME_WINDOW`. Nilai jam = `TBD` (OQ-04); contoh dari FE: batas terlambat `07:15`. |
| BR-12 | **Geofence:** jarak Haversine antara (lat,lng) klien dan pusat sekolah. Sah jika `jarak ≤ radius_m` (default 50). Di luar → 422 `OUTSIDE_RADIUS`, attempt dicatat, **tidak** membuat record presensi. Pesan error menyebutkan jarak aktual dan batas radius (`05_DESIGN_SYSTEM.md` §8.3). |
| BR-13 | **Kualitas GPS:** jika `is_mocked = true` → 422 `MOCK_LOCATION`. Jika `accuracy_m > GPS_MAX_ACCURACY_M` (`TBD`, dev: 30) → 422 `GPS_ACCURACY_LOW` dengan panduan mengaktifkan GPS akurasi tinggi. |
| BR-14 | **Keputusan wajah otomatis (satu ambang):** skor kemiripan `s` dari Flask dibandingkan dengan seluruh embedding referensi siswa → ambil skor tertinggi. `s ≥ FACE_MATCH_THRESHOLD` → **terverifikasi (`match`) dan langsung dicatat**, tanpa menunggu admin/guru. `s < FACE_MATCH_THRESHOLD` → 422 `FACE_MISMATCH` (`no_match`, attempt dicatat, tanpa record; siswa boleh mengulang sesuai BR-17). Tidak ada wajah → `NO_FACE` (`no_face`); >1 wajah → `MULTIPLE_FACES` (`multiple_faces`); kualitas rendah → `LOW_QUALITY` (`low_quality`). Nilai ambang `TBD-kalibrasi` (OQ-05); karena tidak ada peninjauan manual, kalibrasi menentukan keseimbangan false-accept vs false-reject. |
| BR-15 | **Status waktu:** `waktu_sekarang ≤ late_after` → `hadir` (ket. `"Tepat Waktu"`); selainnya → `terlambat` dengan `late_minutes = ceil((sekarang − late_after) / 1 menit)`. |
| BR-16 | **Duplikat:** satu record per `(siswa, tanggal)` (unique key). Jika sudah ada record `hadir/terlambat` → 409 `ALREADY_CHECKED_IN`. Jika ada izin/sakit disetujui → 409 `HAS_APPROVED_LEAVE`. |
| BR-17 | **Batas percobaan:** maks `ATTEMPT_MAX_PER_DAY` (`USULAN` 10) attempt/siswa/hari → 429 `TOO_MANY_ATTEMPTS`. |
| BR-18 | **Alasan terlambat:** record `terlambat` menerima `late_reason` sekali (atau diperbarui hingga akhir hari). Pilihan baku (`05_DESIGN_SYSTEM.md` §7.5): `macet` ("Macet Lalu Lintas"), `kendala_kendaraan` ("Kendala Kendaraan"), `keperluan_keluarga` ("Keperluan Keluarga"), `lainnya` ("Lainnya", dengan `late_note` ≤ 120 karakter). Opsional (tidak memblokir). |
| BR-19 | **Hasil scan wajah = lihat saja:** admin/guru dapat melihat daftar & detail scan (foto scan, foto referensi, skor, hasil, jarak, waktu). Tidak ada aksi setujui/tolak dan tidak ada perubahan status presensi dari fitur ini (D-28, DS-08). Akses detail tercatat di audit log. |
| BR-20 | **Enrollment:** butuh `biometric_consent=true`; terima `ENROLL_MIN_SAMPLES`–`ENROLL_MAX_SAMPLES` foto (`USULAN` 3–5); tiap foto harus memuat tepat 1 wajah berkualitas memadai; sampel gagal dilaporkan beserta alasan; enrollment sah bila sampel diterima ≥ `ENROLL_MIN_SAMPLES`. Enrollment ulang menggantikan template lama. |

### 3.3 Surat Izin

| ID | Aturan |
|----|--------|
| BR-21 | Kategori (`05_DESIGN_SYSTEM.md` §7.3): `sakit` ("Sakit"), `keperluan` ("Keperluan"), `dispensasi` ("Dispensasi"). Lampiran **wajib** (PDF/JPG/PNG, ≤ 5 MB). `keterangan` wajib (≥ 5 karakter, ≤ 1000). |
| BR-22 | Rentang `start_date ≤ end_date`; maks panjang `LEAVE_MAX_DAYS` (`USULAN` 14); tanggal mulai tidak lebih dari `LEAVE_MAX_BACKDATE_DAYS` (`USULAN` 3) hari ke belakang; tidak boleh tumpang tindih dengan izin berstatus `menunggu`/`disetujui` lain milik siswa yang sama (409 `LEAVE_OVERLAP`). |
| BR-23 | Hari dalam rentang yang bukan hari sekolah diabaikan saat menerapkan izin. |
| BR-24 | **Pemetaan status:** `sakit` → status presensi `sakit`; `keperluan` & `dispensasi` → `izin`. |
| BR-25 | **Persetujuan:** `disetujui` → untuk setiap hari sekolah dalam rentang, buat/ubah record presensi (`source=leave`, `status` sesuai BR-24) **kecuali** hari yang sudah punya presensi `hadir/terlambat` valid (tidak ditimpa). `ditolak` → `review_note` wajib. Setelah diputuskan, tidak dapat diubah (v1). |
| BR-26 | Siswa dapat membatalkan hanya selama `menunggu` → `dibatalkan`. |
| BR-27 | Izin disetujui **setelah** hari tersebut sudah ditandai `alpa` → record alpa diubah menjadi `izin/sakit` (koreksi). |

### 3.4 Alpa Otomatis

| ID | Aturan |
|----|--------|
| BR-28 | Job berjalan per hari sekolah, `ALPA_DELAY_MIN` (`USULAN` 5 menit) setelah `checkin_close`. Untuk setiap siswa **aktif** yang tidak punya record pada hari itu → buat record `alpa` (`source=auto_alpa`, ket. `"Tanpa Keterangan"`, Label UI **"Alpa"** per DS-03). |
| BR-29 | Job **idempoten** (unique `(student_id, date)`), melewati hari non-sekolah, dan menjalankan *catch-up* untuk hari yang terlewat bila server mati. Notifikasi `attendance_alpa` dikirim ke siswa terkait. |

### 3.5 Agregasi & Definisi Metrik (`05_DESIGN_SYSTEM.md` §7.6)

Untuk tanggal `D` dan himpunan siswa aktif `S` (tiap siswa tepat satu bucket):

| ID | Definisi |
|----|----------|
| BR-30 | **Bucket dashboard (`StatCard`):** `sudah_hadir` = status `hadir` (`variant="success"`); `terlambat_izin` = `terlambat + izin + sakit` (`variant="warning"`, subteks `"N Izin, N Telat"`); `belum_hadir_alpa` = `belum_hadir` (belum ada record sebelum job alpa) `+ alpa` (`variant="danger"`). Jumlah ketiganya **selalu = `total_students` (`variant="default"`)**. |
| BR-31 | **Kehadiran** = `hadir + terlambat`. **Persentase hadir** = `(hadir + terlambat) ÷ total_siswa_aktif × 100`, dibulatkan 0 desimal (integer `0–100`). Untuk rentang tanggal: pembagi = jumlah (siswa aktif × hari sekolah dalam rentang). Hari non-sekolah dikecualikan. |
| BR-32 | **Status kelas:** `Normal` (hijau) bila % hadir ≥ `CLASS_ALERT_THRESHOLD` (`USULAN` 95); selainnya `Perlu Cek` (amber). (FE: 100% = normal, 90%/80% = perlu cek.) |
| BR-33 | **GPS:** *terpantau* = siswa distinct yang punya record presensi sah pada `D` (lokasi dalam radius). *Di luar radius* = siswa distinct yang punya attempt `rejected_outside_radius` pada `D`. Daftar di luar radius memuat attempt terbaru per siswa. |
| BR-34 | **Total izin/sakit** = jumlah record `izin` + `sakit` pada rentang. **Alpa & pelanggaran** = jumlah `alpa` (v1: pelanggaran = alpa). |
| BR-35 | Hanya data siswa dengan `is_active = true` yang dihitung. |

### 3.6 Pengumuman & Kalender

| ID | Aturan |
|----|--------|
| BR-40 | `audience` (`target_audience`): `semua` (`all`), `siswa`, `guru`, `wali`. `wali` disimpan tetapi tidak menghasilkan notifikasi/penampilan (D-13). `class_id` opsional → hanya siswa kelas itu (pengumuman kelas). Siswa melihat pengumuman `status = 'published'` dengan audiens `semua`, `siswa`, dan (jika `class_id` terisi) kelasnya sendiri. Admin/guru melihat: `semua`, `guru`, `siswa` (semua kelas). Audiens `guru` mencakup **staf (guru dan admin)**. |
| BR-41 | Pengumuman `type=libur` (`category=holiday`, `status=published`) pada rentang `event_date..end_date` membuat hari tersebut non-sekolah (BR-10). Menerbitkan/menghapus libur yang sudah lewat tidak mengubah record lama. |
| BR-42 | **Statistik kalender bulan M:** `total_agenda` = jumlah pengumuman `published` dengan `event_date` (atau rentang) beririsan dengan M; `agenda_penting` = `priority ∈ {penting, urgent}` **atau** `type=penting`; `libur_nasional` = `type=libur`; `sedang_berlangsung` = event yang mencakup hari ini (WIB). Jumlah "dalam minggu ini" dikembalikan bersama `agenda_penting`. |
| BR-43 | Pengumuman mendukung `status` ∈ `draft | published` (default saat diterbitkan tanpa status eksplisit = `published`, sesuai `02_PRD.md` US-51 AC3). Admin/guru dapat mengubah/hapus pengumuman; perubahan tercatat. |
| BR-44 | Prioritas `urgent`/`penting` saat `published` memicu notifikasi ke audiens; `rendah`/`normal` hanya muncul di daftar (agar tidak spam). *(USULAN)* |

### 3.7 Notifikasi

| ID | Pemicu | Penerima | `type` |
|----|--------|----------|--------|
| BR-50a | Presensi tercatat | siswa | `attendance_recorded` |
| BR-50b | Percobaan ditolak di luar radius | siswa | `outside_radius_attempt` |
| BR-50c | Ditandai alpa | siswa | `attendance_alpa` |
| BR-50d | Surat izin diajukan | wali kelas siswa (jika ada; jika tidak, semua guru & admin) | `leave_submitted` |
| BR-50e | Surat izin disetujui / ditolak | siswa | `leave_approved` / `leave_rejected` |
| BR-50f | Pengumuman penting/urgent terbit | audiens sesuai BR-40 | `announcement` |

Notifikasi bersifat **in-app** (REST), tanpa push di v1 (D-24).

### 3.8 File

| ID | Aturan |
|----|--------|
| BR-70 | Foto presensi/enrollment: JPEG/PNG, ≤ `PHOTO_MAX_MB` (`USULAN` 3), dinormalisasi (orientasi EXIF dibaca, metadata dibuang), sisi terpanjang dibatasi. Avatar: JPG/PNG/WebP ≤ 2 MB (sesuai FE & `05_DESIGN_SYSTEM.md` §10). Lampiran izin: PDF/JPG/PNG ≤ 5 MB (sesuai FE & `05_DESIGN_SYSTEM.md` §10). Tipe diverifikasi dari **isi file** (magic bytes), bukan hanya ekstensi/header. |
| BR-71 | Retensi foto presensi: `ATTEMPT_PHOTO_RETENTION_DAYS` (`TBD`, usulan 90); embedding & foto enrollment: selama siswa aktif atau hingga ditarik persetujuan. |

---

## 4. State Machine & Kontrak Semantik UI (`05_DESIGN_SYSTEM.md` §7)

### 4.1 Status presensi harian

```text
(no record) ──check-in OK (wajah cocok), ≤ late_after──▶ hadir        (langsung, otomatis)
(no record) ──check-in OK (wajah cocok), > late_after──▶ terlambat    (langsung, otomatis)
(no record) ──leave approved───────────────────────────▶ izin | sakit
(no record) ──job alpa (cutoff)────────────────────────▶ alpa
alpa ─────────leave approved (koreksi, BR-27)──────────▶ izin | sakit
```
Tidak ada status antara ("menunggu validasi"): setelah wajah cocok, record final.

| Nilai API | Label UI (`05_DESIGN_SYSTEM.md` §7.1) | Catatan / Keterangan Default |
|-----------|---------------------------------------|------------------------------|
| `hadir` | **Hadir** | `"Tepat Waktu"` |
| `terlambat` | **Terlambat** | `"Terlambat (N menit) - <alasan>"` |
| `izin` | **Izin** | `"Izin"` |
| `sakit` | **Sakit** | `"Sakit"` |
| `alpa` | **Alpa** *(baku DS-03)* | `"Tanpa Keterangan"` |
| `belum_hadir` | **Belum Hadir** | Status virtual pada rekap/dashboard sebelum cutoff |
| `belum_presensi` | **Belum Presensi** | Status harian siswa pada `GET /api/me/attendance/today` |

### 4.2 Hasil verifikasi wajah (`face_result` — baca-saja)

| `face_result` | Label UI (`05_DESIGN_SYSTEM.md` §7.2) | Arti | `outcome` attempt |
|---------------|---------------------------------------|------|-------------------|
| `match` | **Cocok** | Skor ≥ ambang | `recorded` |
| `no_match` | **Tidak cocok** | Skor < ambang | `rejected_face` |
| `no_face` | **Wajah tidak terdeteksi** | 0 wajah | `rejected_face` |
| `multiple_faces` | **Lebih dari satu wajah** | >1 wajah | `rejected_face` |
| `low_quality` | **Foto kurang jelas** | Kualitas tidak lolos | `rejected_face` |
| `error` | **Gagal diproses** | AI tidak tersedia/galat | `error` |

### 4.3 Surat izin

```text
menunggu ──guru/admin setujui──▶ disetujui   (terminal, Label: "Disetujui")
menunggu ──guru/admin tolak────▶ ditolak     (terminal, Label: "Ditolak")
menunggu ──siswa batalkan──────▶ dibatalkan  (terminal, Label: "Dibatalkan")
```

### 4.4 Akun admin & guru

Dikelola **di database**: `status` `active` ⇄ `inactive` (`is_active` `1` ⇄ `0`); dihapus = baris dihapus (sesi ikut terhapus via `ON DELETE CASCADE`, token langsung tidak berlaku). Tidak ada alur registrasi/aktivasi/OAuth.

### 4.5 Outcome attempt presensi

`recorded` · `rejected_outside_radius` · `rejected_face` · `rejected_time_window` · `rejected_mock_location` · `rejected_gps_accuracy` · `rejected_already_recorded` · `rejected_not_enrolled` · `error`

---

## 5. Spesifikasi Endpoint

Legenda **Akses**: 🌐 publik · 🔑 terautentikasi (semua role) · 👩‍🏫 staf (`admin` atau `guru`) · 🛡 hanya `admin` · 🎒 siswa. **Pri**: P0/P1.

### 5.1 AUTH

| Method & Path | Akses | Pri | US |
|---------------|:----:|:---:|----|
| `POST /api/auth/admin/login` (alias `/api/auth/web/login`) | 🌐 | P0 | US-01 |
| `POST /api/auth/login` (alias `/api/auth/mobile/login`) | 🌐 | P0 | US-02 |
| `POST /api/auth/oauth/google` (alias `/api/auth/mobile/oauth/google`) | 🌐 | P0 | US-02B |
| `POST /api/auth/register` (siswa, alias `/api/auth/mobile/register`) | 🌐 | P0 | US-03 |
| `POST /api/auth/forgot-password` | 🌐 | P0 | US-05 |
| `POST /api/auth/verify-otp` | 🌐 | P0 | US-05 |
| `POST /api/auth/reset-password` | 🌐 | P0 | US-05 |
| `POST /api/auth/logout` | 🔑 | P0 | US-06 |
| `GET /api/auth/me` | 🔑 | P0 | US-62 |
| `PATCH /api/auth/me` (alias `PUT /api/auth/me`, `PATCH/PUT /api/auth/profile`) | 🔑 | P0 | US-62 |
| `PUT /api/auth/me/password` (alias `PATCH /api/auth/me/password`, `PUT/PATCH /api/auth/password`) | 🔑 | P0 | US-62 |
| `POST /api/auth/me/avatar` · `DELETE /api/auth/me/avatar` (alias `/api/auth/avatar`) | 🔑 | P0 | US-62 |
| `GET /api/auth/sessions` | 🔑 | P0 | US-62 |
| `DELETE /api/auth/sessions/:sessionId` | 🔑 | P1 | — |

#### `POST /api/auth/admin/login` · `POST /api/auth/login`
Request:
```json
{ "identity": "bu.rina@mtsalmaarif.sch.id", "password": "Rahasia123", "remember": true }
```
- `identity`: email (admin/guru) atau email/NISN (siswa). `remember` opsional (default `false`).
Response 200:
```json
{
  "token": "eyJ...",
  "user": {
    "id": 3, "name": "Rina Wulandari, S.Pd.", "email": "bu.rina@mtsalmaarif.sch.id",
    "role": "guru", "phone": null, "avatar_url": null
  }
}
```
`/auth/mobile/login` menerima `siswa`; `/auth/admin/login` (`/auth/web/login`) menerima `admin` dan `guru`. Untuk siswa `user` menyertakan `"nisn": "0064892104", "class": { "id": 2, "name": "Kelas 8" }, "absence_number": 5`.
Error: 400 `VALIDATION_ERROR`, 401 `INVALID_CREDENTIALS` (`"Login gagal! Email atau kata sandi salah."`), 403 `ROLE_NOT_ALLOWED` / `ACCOUNT_NOT_ACTIVE`, 429 `RATE_LIMITED`.

#### `POST /api/auth/oauth/google` (khusus siswa di mobile — US-02B, BR-09B)
Digunakan oleh aplikasi Flutter setelah memperoleh `id_token` dari Google Sign-In SDK.

Request (langkah 1 — langsung login bila email/`google_id` sudah tertaut):
```json
{
  "id_token": "eyJhbGciOiJSUzI1NiIs...",
  "nisn": "0064892104"
}
```
- `id_token`: wajib (string JWT dari Google).
- `nisn`: opsional pada percobaan pertama (string 10 digit angka); **wajib** jika akun Google belum pernah terdaftar di sistem.

Response 200 (berhasil login / registrasi OAuth):
```json
{
  "token": "eyJ...",
  "user": {
    "id": 12,
    "name": "Dimas Anggara",
    "email": "dimas@gmail.com",
    "role": "siswa",
    "nisn": "0064892104",
    "class": { "id": 2, "name": "Kelas 8" },
    "absence_number": 5,
    "avatar_url": "https://lh3.googleusercontent.com/..."
  }
}
```
Response 422 `OAUTH_NISN_REQUIRED` (jika akun Google baru dan `nisn` belum dikirim):
```json
{
  "message": "Akun Google belum terhubung ke data siswa. Silakan masukkan 10 digit NISN Anda.",
  "code": "OAUTH_NISN_REQUIRED",
  "details": {
    "requires_nisn": true,
    "email": "dimas@gmail.com",
    "name": "Dimas Anggara"
  }
}
```
Error lainnya:
- 400 `VALIDATION_ERROR` (`id_token` kosong atau format `nisn` bukan 10 digit angka)
- 401 `INVALID_OAUTH_TOKEN` (`id_token` tidak valid, kedaluwarsa, audience tidak cocok, atau email belum terverifikasi)
- 403 `ROLE_NOT_ALLOWED` (email Google terdaftar sebagai `admin` atau `guru`) / `ACCOUNT_NOT_ACTIVE`
- 409 `NISN_ALREADY_REGISTERED` (NISN sudah ditautkan ke akun lain) / `OAUTH_ACCOUNT_CONFLICT` (email sudah tertaut ke akun Google lain)
- 422 `NISN_NOT_IN_ROSTER` (NISN tidak ditemukan di roster aktif sekolah)

#### `POST /api/auth/register` (siswa)
```json
{ "name": "Dimas Anggara", "nisn": "0064892104", "email": "dimas@mail.com", "password": "Rahasia123" }
```
201 → `{ "data": { "message": "Registrasi berhasil. Silakan login." } }` (tanpa auto-login).
Error: 400; 409 `EMAIL_TAKEN` / `NISN_ALREADY_REGISTERED`; 422 `NISN_NOT_IN_ROSTER`.

#### Lupa sandi (3 langkah — khusus siswa/mobile; akun admin/guru dikelola di database)
1. `POST /api/auth/forgot-password` `{ "email": "..." }` → 200 `{ "data": { "message": "Jika email terdaftar, kode OTP telah dikirim.", "resend_available_in": 60 } }` · 429 `OTP_COOLDOWN` / `RATE_LIMITED`.
2. `POST /api/auth/verify-otp` `{ "email": "...", "otp": "123456" }` → 200 `{ "data": { "reset_token": "...", "expires_in": 900 } }` · 400 `OTP_INVALID` / `OTP_EXPIRED` · 429 `OTP_ATTEMPTS_EXCEEDED`.
3. `POST /api/auth/reset-password` `{ "reset_token": "...", "new_password": "Baru12345" }` → 200 `{ "data": { "message": "Kata sandi berhasil diperbarui." } }` · 400 `RESET_TOKEN_INVALID`.

#### `GET /api/auth/me` → `{ "data": {…user…} }` *(FE membaca `data.user ?? data`, jadi keduanya aman)*
#### `PATCH /api/auth/me`
```json
{ "name": "Rina W.", "email": "rina@mtsalmaarif.sch.id" }
```
200 → user terbaru. 400 `VALIDATION_ERROR` dengan `errors` per-field; 409 `EMAIL_TAKEN`. Siswa hanya dapat mengubah `phone`/`whatsapp_number` dan `address` pada profilnya (data akademik terkunci, US-61).
#### `PUT /api/auth/me/password`
`{ "current_password": "...", "new_password": "..." }` → 200/204. Salah sandi lama → 400 dengan `errors.current_password`. Sesi lain dicabut (BR-05).
#### Avatar
`POST /api/auth/me/avatar` (multipart `file`/`avatar`, JPG/PNG/WebP ≤ 2 MB) → `{ "data": { "avatar_url": "<url>" } }` · 413/415. `DELETE` → 200/204.
#### `GET /api/auth/sessions`
```json
{ "data": [
  { "id": "9f1c…", "device": "Chrome pada macOS", "platform": "web", "ip": "103.x.x.x",
    "last_active_at": "2026-11-02T00:10:00Z", "created_at": "2026-11-01T02:00:00Z", "is_current": true },
  { "id": "a77b…", "device": "Aplikasi Android", "platform": "android", "ip": "…", "last_active_at": "…", "is_current": false }
] }
```

---

### 5.2 SCHOOL & ROSTER (konfigurasi sekolah & data induk siswa)

| Method & Path | Akses | Pri |
|---------------|:----:|:---:|
| `GET /api/school/config` | 🔑 | P0 |
| `GET /api/roster` · `POST /api/roster` · `PUT /api/roster/:id` · `DELETE /api/roster/:id` | 👩‍🏫 | P0 |
| `PATCH /api/school/geofence` | 🛡 | P1 |
| `PUT /api/school/schedule/:dayOfWeek` | 🛡 | P1 |

`GET /api/school/config` →
```json
{ "data": {
  "school_name": "MTs Al-Ma'arif", "timezone": "Asia/Jakarta",
  "geofence": { "latitude": -7.9826, "longitude": 112.6308, "radius_m": 50 },
  "today": { "date": "2026-11-02", "is_school_day": true, "checkin_open": "06:00", "late_after": "07:15", "checkin_close": "12:00",
             "holiday_title": null }
} }
```
*(Dipakai FE Web `Header`/`Footer` untuk menggantikan nama sekolah hardcode sesuai `05_DESIGN_SYSTEM.md` §6.1 & DS-05, serta Mobile untuk menggantikan koordinat & radius hardcode sesuai FC-07.)*

---

### 5.3 FACE (enrollment)

| Method & Path | Akses | Pri | US |
|---------------|:----:|:---:|----|
| `GET /api/face/status` | 🎒 | P0 | US-10 |
| `POST /api/face/enroll` | 🎒 | P0 | US-10 |
| `POST /api/students/:nisn/face/reset` | 🛡 | P1 | — |

`POST /api/face/enroll` — multipart: `consent` (`"true"`), `photos` (3–5 file). Respons 201:
```json
{ "data": { "status": "enrolled", "samples_accepted": 4,
            "rejected": [ { "index": 2, "reason": "NO_FACE" } ] } }
```
Gagal bila diterima < min → 422 `ENROLL_INSUFFICIENT_SAMPLES` (dengan daftar `rejected`). Tanpa consent → 400 `CONSENT_REQUIRED`. Layanan AI mati → 503 `AI_UNAVAILABLE`.
`GET /api/face/status` → `{ "data": { "enrolled": true, "enrolled_at": "…", "samples": 4, "consent_at": "…" } }`.

---

### 5.4 ATTENDANCE (siswa)

| Method & Path | Akses | Pri | US |
|---------------|:----:|:---:|----|
| `POST /api/attendance/check-in` | 🎒 | P0 | US-11 |
| `PATCH /api/attendance/:id/late-reason` | 🎒 | P0 | US-12 |
| `GET /api/me/attendance/today` | 🎒 | P0 | US-13 |
| `GET /api/me/attendance?month=YYYY-MM` (alias `GET /api/calendar/attendance?month=YYYY-MM`) | 🎒 | P0 | US-30/52 |
| `GET /api/me/reports/monthly?month=YYYY-MM` | 🎒 | P0 | US-31 |

#### `POST /api/attendance/check-in`
`multipart/form-data`:

| Field | Tipe | Wajib | Ket. |
|-------|------|:----:|------|
| `photo` | file | ✅ | Foto kamera depan langsung (`05_DESIGN_SYSTEM.md` §10) |
| `latitude`, `longitude` | number | ✅ | Derajat desimal |
| `accuracy_m` | number | ✅ | Akurasi horizontal GPS |
| `is_mocked` | boolean | ✅ | Dari `geolocator` (Android) |
| `captured_at` | ISO datetime | ✅ | Waktu klien (hanya informasi; **waktu otoritatif = waktu server**) |
| `device` | string ≤ 100 | ➖ | Info perangkat |

Respons **201** (tercatat):
```json
{ "data": {
  "record": { "id": 811, "date": "2026-11-02", "status": "terlambat", "check_in_at": "2026-11-02T00:28:10Z",
              "late_minutes": 13 },
  "requires_late_reason": true,
  "late_reason_options": ["macet", "kendala_kendaraan", "keperluan_keluarga", "lainnya"],
  "face": { "similarity": 0.994 },
  "geofence": { "distance_m": 12, "radius_m": 50 },
  "message": "Absensi Masuk Berhasil!"
} }
```
Presensi **final seketika** saat wajah cocok; tidak ada status menunggu validasi.

Error bisnis (422 kecuali dicatat) — `code`:
`OUTSIDE_RADIUS` (+`details:{distance_m, radius_m}`) · `OUTSIDE_TIME_WINDOW` · `NOT_SCHOOL_DAY` · `MOCK_LOCATION` · `GPS_ACCURACY_LOW` · `FACE_MISMATCH` · `NO_FACE` · `MULTIPLE_FACES` · `LOW_QUALITY`; 409 `FACE_NOT_ENROLLED` · `ALREADY_CHECKED_IN` · `HAS_APPROVED_LEAVE`; 429 `TOO_MANY_ATTEMPTS`; 413/415 file; 503 `AI_UNAVAILABLE`.

> Seluruh outcome (berhasil maupun ditolak) menulis baris `attendance_attempts`. Pada `AI_UNAVAILABLE`, attempt dicatat `error` dan **tidak** otomatis meloloskan presensi (fail-closed).

#### `PATCH /api/attendance/:id/late-reason`
`{ "reason": "macet", "note": "Jalan raya ditutup" }` → 200 record. Hanya pemilik; hanya record `terlambat`; 404 bila bukan miliknya; 422 `NOT_LATE`.

#### `GET /api/me/attendance/today`
```json
{ "data": {
  "date": "2026-11-02", "is_school_day": true, "holiday_title": null,
  "status": "belum_presensi",
  "record": null,
  "window": { "open": "06:00", "late_after": "07:15", "close": "12:00" },
  "enrolled": true
} }
```
`status` ∈ `belum_presensi | hadir | terlambat | izin | sakit | alpa` (`05_DESIGN_SYSTEM.md` §7.1); bila ada record, `record` berisi `id, status, check_in_at, late_minutes, late_reason, late_note`.

#### `GET /api/me/attendance?month=2026-10` · `GET /api/calendar/attendance?month=2026-10`
```json
{ "data": {
  "month": "2026-10",
  "today": "2026-10-31",
  "summary": { "hadir": 15, "terlambat": 2, "izin": 1, "sakit": 1, "alpa": 0, "school_days": 19, "attendance_percent": 89 },
  "days": [
    { "date": "2026-10-01", "status": "hadir", "check_in_at": "…", "late_minutes": null, "late_reason": null, "note": "Tepat Waktu" }
  ],
  "events": [ ],
  "calendar_marks": [ ]
} }
```
Mengembalikan riwayat harian, ringkasan statistik bulanan (`attendance_percent` integer `0–100`), serta `events` dan `calendar_marks` untuk tampilan kalender mobile (US-30 & US-52).

#### `GET /api/me/reports/monthly?month=2026-10`
`200 application/pdf`, `Content-Disposition: attachment; filename="Laporan-Presensi-<NISN>-2026-10.pdf"`. Isi: identitas siswa, periode, ringkasan, tabel harian. Error: 400 format bulan; 422 `MONTH_IN_FUTURE`.

---

### 5.5 LEAVE (surat izin)

| Method & Path | Akses | Pri | US |
|---------------|:----:|:---:|----|
| `POST /api/leave-requests` | 🎒 | P0 | US-20 |
| `GET /api/leave-requests` | 🔑 | P0 | US-20/21 |
| `GET /api/leave-requests/:id` | 🔑 | P0 | US-20/21 |
| `GET /api/leave-requests/:id/attachment` | 🔑 | P0 | US-21 |
| `PATCH /api/leave-requests/:id/cancel` | 🎒 | P0 | US-20 |
| `PATCH /api/leave-requests/:id/review` | 👩‍🏫 | P0 | US-21 |

`POST /api/leave-requests` — multipart: `category` (`sakit|keperluan|dispensasi`), `start_date`, `end_date`, `reason`, `attachment` (file). 201:
```json
{ "data": { "id": 55, "category": "sakit", "start_date": "2026-11-03", "end_date": "2026-11-04", "days": 2,
            "reason": "Demam…", "status": "menunggu", "created_at": "…", "attachment_url": "<signed>" } }
```
Error: 400 (termasuk lampiran hilang → `errors.attachment`), 409 `LEAVE_OVERLAP`, 413/415, 422 `LEAVE_RANGE_INVALID`.

`GET /api/leave-requests` — siswa: miliknya; guru/admin: semua. Filter: `status`, `class_id` (staf), `nisn` (staf), `from`, `to`, `page`, `limit`. Setiap item menyertakan siswa (`nisn`, `name`, `class`) untuk staf.
`PATCH /api/leave-requests/:id/review` — `{ "decision": "approve" | "reject", "note": "…" }` (`note` wajib bila `reject`). 200 → izin terbaru. 409 `LEAVE_ALREADY_REVIEWED`.
`GET /api/leave-requests/:id/attachment` — mengembalikan berkas bila pemilik/staf (stream dengan `Content-Disposition: inline`).

---

### 5.6 DASHBOARD & REKAP (admin & guru)

| Method & Path | Akses | Pri | US |
|---------------|:----:|:---:|----|
| `GET /api/dashboard/summary?date=` | 👩‍🏫 | P0 | US-40 |
| `GET /api/recap/overview?from=&to=` | 👩‍🏫 | P0 | US-41 |
| `GET /api/recap/classes?from=&to=` | 👩‍🏫 | P0 | US-41 |
| `GET /api/recap/classes/:classId?date=&q=&status=` | 👩‍🏫 | P0 | US-41 |
| `GET /api/recap/location?date=` | 👩‍🏫 | P0 | US-43 |
| `GET /api/reports/attendance/export?format=xlsx&from=&to=&class_id=` | 👩‍🏫 | P0 | US-44 |

Default `date` = hari ini (WIB). `from`/`to` default = hari ini. Validasi: `from ≤ to`, rentang ≤ `REPORT_MAX_RANGE_DAYS` (`USULAN` 92).

#### `GET /api/dashboard/summary`
```json
{ "data": {
  "date": "2026-11-02", "generated_at": "2026-11-02T00:30:00Z", "is_school_day": true,
  "totals": {
    "total_students": 30,
    "sudah_hadir": 22,
    "terlambat_izin": { "total": 3, "terlambat": 1, "izin": 1, "sakit": 1 },
    "belum_hadir_alpa": { "total": 5, "belum_hadir": 4, "alpa": 1 }
  },
  "classes": [
    { "class_id": 1, "name": "Kelas 7", "grade": 7, "section": "", "total_students": 10,
      "hadir": 10, "terlambat": 0, "izin": 0, "sakit": 0, "belum_hadir": 0, "alpa": 0,
      "attendance_count": 10, "attendance_percent": 100, "note": null }
  ],
  "announcements": [ { "id": 9, "type": "akademik", "title": "…", "event_date": "2026-11-10", "priority": "penting" } ],
  "calendar_marks": [ { "date": "2026-11-10", "type": "penting" }, { "date": "2026-11-28", "type": "libur" } ]
} }
```
Pemetaan ke `StatCard` web (`05_DESIGN_SYSTEM.md` §7.6): `totals.total_students` (`default`), `totals.sudah_hadir` (`success`), `totals.terlambat_izin.total` (`warning`), `totals.belum_hadir_alpa.total` (`danger`). `generated_at` dipakai sebagai indikator waktu sinkron terakhir (`05_DESIGN_SYSTEM.md` §10).

#### `GET /api/recap/overview`
```json
{ "data": {
  "from": "2026-11-02", "to": "2026-11-02",
  "monitored_classes": 3,
  "attendance_avg_percent": 90,
  "leave_total": { "izin": 1, "sakit": 1, "total": 2 },
  "alpa_total": 3,
  "gps": { "monitored_students": 27, "outside_radius_students": 3, "radius_m": 50 }
} }
```
`GET /api/recap/classes` → `{ "data": [ { "class_id", "name", "total_students", "hadir", "terlambat", "izin", "sakit", "alpa", "attendance_percent", "status": "Normal|Perlu Cek" } ] }`.

#### `GET /api/recap/classes/:classId`
```json
{ "data": {
  "class": { "id": 2, "name": "Kelas 8" }, "date": "2026-11-02",
  "counts": { "hadir": 8, "sakit": 0, "izin": 0, "alpa": 1, "terlambat": 1, "belum_hadir": 0 },
  "students": [
    { "nisn": "0064892104", "name": "Abdul Rahman", "absence_number": 1, "status": "hadir",
      "check_in_at": "2026-11-02T23:41:00Z", "note": "Tepat Waktu",
      "record_id": 801, "scan_id": 790 }
  ]
} }
```
`status` bisa `belum_hadir` (tanpa record). `scan_id` = id hasil scan wajah (null bila siswa tanpa scan, mis. izin/alpa) untuk membuka `GET /api/face-scans/:scanId`. `q` mencari nama/NISN (case-insensitive, substring). `status` memfilter. Urut: nomor absen lalu nama.

#### `GET /api/recap/location`
```json
{ "data": {
  "date": "2026-11-02",
  "center": { "latitude": -7.9826, "longitude": 112.6308 }, "radius_m": 50,
  "monitored_students": 27, "outside_radius_students": 3,
  "outside": [
    { "attempt_id": 90, "nisn": "…", "name": "Joko Widodo", "class": { "id": 2, "name": "Kelas 8" },
      "distance_m": 72, "attempted_at": "2026-11-02T23:45:00Z", "latitude": -7.98, "longitude": 112.64 }
  ]
} }
```

#### `GET /api/reports/attendance/export`
`200` biner `.xlsx`, `Content-Disposition: attachment; filename="Rekap-Presensi-<YYYY-MM-DD>.xlsx"`.
- **Satu hari:** satu sheet per kelas; kolom `No, NISN, Nama Siswa, Status, Waktu Presensi, Keterangan`; di bawahnya baris ringkasan (Total Siswa, Total Hadir, Total Alpa, Persentase Hadir) — menggunakan label baku **"Alpa"** (`05_DESIGN_SYSTEM.md` DS-03).
- **Rentang:** satu sheet per kelas; kolom `No, NISN, Nama Siswa, Hadir, Terlambat, Izin, Sakit, Alpa, % Hadir`.
Error: 400 rentang tidak valid; 422 `NO_DATA`.

---

### 5.7 FACE SCANS (hasil scan wajah — **lihat saja**)

Presensi wajah otomatis (BR-14); modul ini hanya menampilkan hasil scan untuk admin/guru (`05_DESIGN_SYSTEM.md` §7.2 & §10, DS-07, DS-08). **Tidak ada endpoint ubah/setujui/tolak.**

| Method & Path | Akses | Pri | US |
|---------------|:----:|:---:|----|
| `GET /api/face-scans?class_id=&date=&nisn=&result=&page=` | 👩‍🏫 | P0 | US-42 |
| `GET /api/face-scans/:scanId` | 👩‍🏫 | P0 | US-42 |

`scanId` = id `attendance_attempts`. Default `date` = hari ini; urut `attempted_at` desc. `result` ∈ `match | no_match | no_face | multiple_faces | low_quality | error`.
Item daftar: `scan_id, nisn, name, class, attempted_at, result, similarity, outcome, distance_m, within_radius, record_id`.

`GET /api/face-scans/:scanId`:
```json
{ "data": {
  "scan_id": 790, "attempted_at": "2026-11-02T00:03:00Z",
  "result": "match", "similarity": 0.994, "match_threshold": 0.5, "outcome": "recorded",
  "student": { "nisn": "…", "name": "…", "class": { "id": 1, "name": "Kelas 7" }, "gender": "L",
               "birth_date": "2013-05-12", "guardian_name": "Bpk. Suryanto", "absence_number": 1 },
  "reference_photo_url": "<signed>", "captured_photo_url": "<signed>", "photo_expired": false,
  "location": { "latitude": -7.98, "longitude": 112.63, "accuracy_m": 8.5, "distance_m": 12, "radius_m": 50,
                "within_radius": true, "is_mocked": false },
  "record": { "id": 811, "status": "hadir", "check_in_at": "2026-11-02T00:03:00Z" }
} }
```
- `match_threshold` hanya informasi (nilai contoh; dari konfigurasi).
- Setelah retensi foto (BR-71) `captured_photo_url = null` dan `photo_expired = true`; metadata tetap ada.
- Setiap pemanggilan detail menulis audit log `face_scan.view`.
- 404 bila scan tidak ada.

---

### 5.8 ANNOUNCEMENTS & CALENDAR

| Method & Path | Akses | Pri | US |
|---------------|:----:|:---:|----|
| `GET /api/announcements` | 🔑 | P0 | US-40/52 |
| `GET /api/announcements/:id` | 🔑 | P0 | US-52 |
| `POST /api/announcements` | 👩‍🏫 | P0 | US-51 |
| `PUT /api/announcements/:id` · `PATCH /api/announcements/:id` | 👩‍🏫 | P0 | US-51 |
| `DELETE /api/announcements/:id` | 👩‍🏫 | P0 | US-51 |
| `GET /api/calendar/events?month=YYYY-MM` | 🔑 | P0 | US-50/52 |
| `GET /api/calendar/summary?month=YYYY-MM` | 👩‍🏫 | P0 | US-50 |
| `GET /api/calendar/attendance?month=YYYY-MM` | 🎒 | P0 | US-30/52 |

`POST /api/announcements`:
```json
{ "type": "akademik", "title": "Penilaian Tengah Semester", "description": "…",
  "event_date": "2026-11-10", "end_date": "2026-11-14",
  "audience": "semua", "class_id": null, "priority": "penting", "status": "published" }
```
- Mendukung istilah FSD/Design System §7.4 maupun alias FE:
  - `type` / `category`: `akademik` (`academic`) | `kegiatan` (`activity`) | `libur` (`holiday`, `libur-cuti`) | `penting` (`important`) | `prestasi` (`achievement`) | `info`
  - `audience` / `target_audience`: `semua` (`all`) | `siswa` | `guru` | `wali`
  - `priority`: `rendah` (`low`) | `normal` | `penting` (`important`) | `urgent`
  - `event_date` / `publish_date`: `YYYY-MM-DD`; `end_date >= event_date` bila ada
  - `status`: `draft` | `published` (default `published`)
- `title` 1–200 karakter, `description` wajib.
201 → objek pengumuman (+`created_by`, `published_at`). 400 `VALIDATION_ERROR` dengan `errors` per-field.
`GET /api/announcements` — filter `type`/`category`, `audience`/`target_audience`, `priority`, `status`, `from`, `to`, `class_id`, `q`; urut `publish_date` desc. Disaring otomatis berdasarkan role (BR-40).
`GET /api/calendar/events?month=2026-11` → `{ "data": [ { "id", "type", "category", "title", "description", "event_date", "publish_date", "end_date", "priority", "priority_code", "audience", "target_audience", "class_id" } ] }`.
`GET /api/calendar/summary?month=2026-11` → `{ "data": { "month": "2026-11", "today": "2026-11-02", "total_agenda": 6, "agenda_penting": { "total": 2, "this_week": 2 }, "libur_nasional": 1, "sedang_berlangsung": 1, "events": [ ], "days": [ ] } }`.

> Klien mobile dapat memanggil `GET /api/calendar/attendance?month=YYYY-MM` (atau `GET /api/me/attendance?month=YYYY-MM`) yang langsung menggabungkan `events`, `days`, `summary`, dan `calendar_marks` per tanggal (Hadir, Terlambat, Izin/Sakit, Alpa, Libur, Agenda).

---

### 5.9 NOTIFICATIONS

| Method & Path | Akses | Pri | US |
|---------------|:----:|:---:|----|
| `GET /api/notifications?unread=&type=&page=` | 🔑 | P0 | US-60 |
| `GET /api/notifications/unread-count` | 🔑 | P0 | US-60 |
| `PATCH /api/notifications/:id/read` | 🔑 | P0 | US-60 |
| `POST /api/notifications/read-all` | 🔑 | P0 | US-60 |
| `POST /api/devices` (daftar token FCM) | 🔑 | P1 | — |

Item: `{ "id", "type", "title", "body", "data": { "record_id": 811 }, "read_at": null, "created_at": "…" }`. Hanya milik pemanggil.

---

### 5.10 PROFILE (siswa)

| Method & Path | Akses | Pri | US |
|---------------|:----:|:---:|----|
| `GET /api/me/profile` | 🎒 | P0 | US-61 |
| `PATCH /api/me/profile` | 🎒 | P0 | US-61 |
| `GET /api/me/homeroom` | 🎒 | P0 | US-61 |

`GET /api/me/profile` →
```json
{ "data": { "nisn": "0064892104", "name": "Yasmine Shavira", "class": { "id": 2, "name": "Kelas 8" },
            "absence_number": 5, "gender": "P", "birth_date": "2012-03-05",
            "phone": "08xx", "address": "Jl. Soekarno Hatta", "guardian_name": "H. Budi Santoso", "guardian_phone": "0811…",
            "locked_fields": ["nisn", "name", "class", "absence_number", "gender", "birth_date", "guardian_name", "guardian_phone"],
            "avatar_url": null } }
```
`PATCH` hanya menerima `phone` (format nomor Indonesia sederhana, 9–15 digit) dan `address` (≤ 255). Field lain → diabaikan/400.
`GET /api/me/homeroom` → `{ "data": { "name": "…", "email": "…", "phone": null } }` atau `404 NO_HOMEROOM` bila belum di-assign.

---

### 5.11 SISTEM

| Method & Path | Akses | Keterangan |
|---------------|:----:|-----------|
| `GET /api/health` | 🌐 | `{ "status": "ok", "db": "up", "ai": "up|down", "time": "…" }` — dipakai juga untuk lencana "Server Presensi Terhubung" di halaman login (`05_DESIGN_SYSTEM.md` §10) |
| `GET /api/files/:signedPath` | 🔑*(signed)* | Mengambil file bertanda tangan / avatar (TRD §9.5) |

---

## 6. Matriks Kode Error (Ringkas)

| `code` | HTTP | Keterangan |
|--------|:----:|-----------|
| `VALIDATION_ERROR` | 400 | Input tidak valid (`errors` per-field) |
| `UNAUTHENTICATED` / `AUTH_REQUIRED` / `INVALID_TOKEN` / `SESSION_REVOKED` | 401 | Token tidak ada/invalid/dicabut |
| `INVALID_CREDENTIALS` | 401 | Login gagal (`"Login gagal! Email atau kata sandi salah."`) |
| `INVALID_OAUTH_TOKEN` | 401 | `id_token` Google OAuth tidak valid / kedaluwarsa / email belum terverifikasi |
| `ROLE_NOT_ALLOWED` | 403 | Role tidak sesuai endpoint (termasuk non-siswa mencoba OAuth mobile) |
| `ACCOUNT_NOT_ACTIVE` / `ACCOUNT_INACTIVE` | 403 | Akun `inactive` |
| `FORBIDDEN` | 403 | Tidak berhak (`"Akses ditolak."`) |
| `NOT_FOUND` / `ANNOUNCEMENT_NOT_FOUND` / `ROSTER_NOT_FOUND` | 404 | Tidak ada / bukan milik pemanggil |
| `EMAIL_TAKEN` / `EMAIL_ALREADY_REGISTERED` · `NISN_ALREADY_REGISTERED` · `OAUTH_ACCOUNT_CONFLICT` | 409 | Duplikat / konflik tautan akun |
| `ALREADY_CHECKED_IN` · `HAS_APPROVED_LEAVE` · `FACE_NOT_ENROLLED` | 409 | Konflik presensi |
| `LEAVE_OVERLAP` · `LEAVE_ALREADY_REVIEWED` | 409 | Konflik surat izin |
| `NISN_NOT_IN_ROSTER` · `OAUTH_NISN_REQUIRED` | 422 | Registrasi / OAuth siswa membutuhkan atau gagal validasi NISN di roster |
| `OUTSIDE_RADIUS` · `OUTSIDE_TIME_WINDOW` · `NOT_SCHOOL_DAY` · `MOCK_LOCATION` · `GPS_ACCURACY_LOW` | 422 | Aturan presensi |
| `FACE_MISMATCH` · `NO_FACE` · `MULTIPLE_FACES` · `LOW_QUALITY` | 422 | Hasil verifikasi wajah |
| `ENROLL_INSUFFICIENT_SAMPLES` · `LEAVE_RANGE_INVALID` · `NOT_LATE` · `MONTH_IN_FUTURE` · `NO_DATA` | 422 | Aturan bisnis lain |
| `OTP_INVALID` · `OTP_EXPIRED` · `RESET_TOKEN_INVALID` · `CONSENT_REQUIRED` | 400 | Alur OTP/consent |
| `OTP_COOLDOWN` · `OTP_ATTEMPTS_EXCEEDED` · `TOO_MANY_ATTEMPTS` · `RATE_LIMITED` | 429 | Pembatasan laju |
| `FILE_TOO_LARGE` · `UNSUPPORTED_MEDIA` | 413 · 415 | Berkas |
| `AI_UNAVAILABLE` | 503 | Layanan Flask tidak tersedia |
| `INTERNAL_ERROR` | 500 | Kesalahan tak terduga (tanpa detail internal) |

---

## 7. Audit Log

Dicatat untuk: login admin/guru (sukses/gagal), akses detail hasil scan wajah, review surat izin, buat/ubah/hapus pengumuman, ubah geofence/jadwal (admin), reset enrollment wajah (admin), export laporan. Field: `actor_user_id`, `action`, `entity`, `entity_id`, `meta` (JSON, tanpa data sensitif), `ip`, `created_at`. Tidak ada endpoint baca di v1 (akses via DB). Perubahan akun admin/guru dilakukan langsung di database sehingga tidak tercatat di sini.

---

## 8. Traceability: US → Endpoint

| US | Endpoint utama |
|----|----------------|
| US-01 | `POST /auth/admin/login` (`/auth/web/login`) |
| US-02 | `POST /auth/login` (`/auth/mobile/login`) |
| US-02B | `POST /auth/oauth/google` (`/auth/mobile/oauth/google`) |
| US-03 | `POST /auth/register` (`/auth/mobile/register`) |
| US-04 | — (akun admin/guru dikelola di database; tanpa endpoint) |
| US-05 | `forgot-password` · `verify-otp` · `reset-password` |
| US-06 | `POST /auth/logout` |
| US-10 | `face/enroll` · `face/status` |
| US-11/12/13 | `attendance/check-in` · `attendance/:id/late-reason` · `me/attendance/today` |
| US-14 | Job alpa (BR-28/29) — tanpa endpoint |
| US-20/21 | `leave-requests/*` |
| US-30/31 | `me/attendance` (`calendar/attendance`) · `me/reports/monthly` |
| US-40 | `dashboard/summary` |
| US-41 | `recap/overview` · `recap/classes*` |
| US-42 | `face-scans*` (lihat saja) |
| US-43 | `recap/location` |
| US-44 | `reports/attendance/export` |
| US-50/51/52 | `announcements*` · `calendar/*` |
| US-60 | `notifications*` |
| US-61 | `me/profile` · `me/homeroom` |
| US-62 | `auth/me*` · `auth/sessions` |
| US-70 | Guard role (§2) · endpoint 🛡 (P1): `school/geofence`, `school/schedule`, `students/:nisn/face/reset` |

---

## 9. Kriteria Selesai Fitur (Definition of Done per Endpoint)

1. Skema validasi (Zod) di `packages/contract` + OpenAPI **ter-generate** (bukan ditulis tangan) sesuai bagian 5.
2. Otorisasi per role teruji (positif & negatif; akses lintas-siswa → 404).
3. Unit test aturan bisnis terkait (BR-xx) + integration test (MySQL nyata).
4. Kode error sesuai §6 & pesan siap tampil sesuai `05_DESIGN_SYSTEM.md` §8; tidak ada stack trace/detail internal di respons.
5. Entri audit log untuk aksi sensitif (§7).
6. Dapat dipanggil dari FE (web **dan** Flutter) tanpa mengubah kontrak (atau perubahan dicatat pada Change List `00_README_HANDOFF.md` §8).
7. Nilai enum dan format data sesuai kontrak semantik `05_DESIGN_SYSTEM.md` §7 & §9.

---

## 10. Kontrak Lintas-Klien

1. **Sumber tunggal:** skema Zod + daftar kode error (§6) + util waktu WIB di `packages/contract`, serta kontrak semantik UI di `05_DESIGN_SYSTEM.md` §7.
2. **Flutter (mobile siswa):** menerima kontrak lewat file OpenAPI hasil generate; tidak ada paket TS bersama. Nama field `snake_case`, instant UTC ISO-8601, tanggal WIB `YYYY-MM-DD` (§1.1) harus diparse apa adanya di Dart. Untuk OAuth Google, Flutter memakai paket `google_sign_in`, mengambil `idToken`, dan mengirimkannya ke `POST /api/auth/oauth/google`.
3. **Web (guru/admin):** tetap Vite/React; boleh tetap JS. Migrasi ke TS opsional per-file, memakai tipe dari `contract`.
4. **Layanan AI (Flask):** bukan bagian kontrak klien; hanya dipanggil Express (TRD §7.2). Klien tidak pernah memanggil Flask.
5. **Perubahan kontrak:** ubah Zod → regenerasi OpenAPI → catat di Change List FE. Perubahan *breaking* pada endpoint yang sudah dipakai FE (`/auth/admin/login`, `/auth/me`, `/auth/logout`, bentuk error) dilarang.
