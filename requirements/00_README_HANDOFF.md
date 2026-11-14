# M-Class Backend — Dokumen Induk & Handoff

> **Proyek:** Backend sistem absensi sekolah (MTs/SMP) "M-Class"
> **Stack:** Express + TypeScript · MySQL · Flask AI Service (face recognition)
> **Klien:** Web (React/Vite) · Mobile (Flutter)
> **Tanggal dokumen:** 12 November 2026 · **Versi:** 1.2 (diselaraskan dengan PRD v1.3, FSD v1.4, TRD v1.4, MRD v1.2, Design System v1.2)

Dokumen ini adalah **pintu masuk** dan **catatan serah-terima (handoff)**. Jika percakapan terputus (limit token), cukup tempel isi file ini ke chat baru, lalu lanjutkan — semua keputusan, asumsi, dan pertanyaan terbuka tercatat di sini.

---

## 0. Riwayat Revisi

### v1.1 — 4 November 2026 (revisi dari pemilik proyek)

| # | Revisi | Dampak ke dokumen |
|---|--------|-------------------|
| 1 | **Guru/admin tanpa registrasi.** Akun dikelola (insert/update/delete) langsung di database; di web hanya **login & logout** | PRD US-04 diganti; FSD BR-03/04/09 & endpoint `admin/register` dihapus; TRD: kolom `status` tanpa `pending`, skrip `activate-teacher` → `hash-password`; FE: hapus halaman register & lupa sandi web (FC-02) |
| 2 | **Presensi wajah otomatis.** Wajah cocok → langsung tercatat, **tanpa validasi guru**. "Validasi foto" di web = **lihat hasil scan** (read-only) | PRD US-11/US-42; FSD BR-14/16/19/28/30, state machine, modul `validations` → `face-scans` (GET saja); TRD: DDL tanpa `verification_status`/`reviewed_*`, satu ambang `FACE_MATCH_THRESHOLD`; Design System §7.2; FE: halaman validasi read-only (FC-06) |
| 3 | **Role `admin` ditambahkan** untuk semua akses. Role: `admin`, `guru`, `siswa` | PRD persona & US-70; FSD §2 matriks hak akses; TRD enum `role`, guard; keputusan D-29 |
| 4 | **Presensi pulang dihapus** | PRD (M-OUT, riwayat, R2); FSD (endpoint `check-out`, `check_out_at`, `checkout_*`); TRD (kolom `check_out_at`, `checkout_start/end`, daftar P1); keputusan D-22 |

### v1.2 — 11–12 November 2026 (penambahan OAuth Mobile & penyelarasan Design System/MRD)

| # | Revisi | Dampak ke dokumen |
|---|--------|-------------------|
| 5 | **Login Google OAuth khusus siswa di aplikasi Mobile (Flutter).** Siswa dapat masuk dengan Google (`id_token`); jika akun/email belum tertaut ke siswa, wajib memasukkan 10 digit NISN untuk klaim roster | PRD US-02B; FSD BR-09B & `POST /api/auth/oauth/google`; TRD TD-18, kolom `google_id` & `oauth_provider`; keputusan D-30 |
| 6 | **Penyelarasan penuh `00_README_HANDOFF.md`, `01_MRD.md`, dan `05_DESIGN_SYSTEM.md` di folder `requirements/`** | Kontrak semantik UI ↔ API (`05_DESIGN_SYSTEM.md` §7–§12), pesan error standar, format data tampilan, dan rekomendasi `DS-01`…`DS-08` diintegrasikan ke PRD, FSD, dan TRD |

**Efek samping yang perlu Anda ketahui:**
- Tanpa peninjauan manual, kesalahan verifikasi wajah (siswa sah ditolak / orang lain lolos) langsung memengaruhi rekap. Risiko ini dicatat (MRD R-02/R-03, TRD TR-09) dan memunculkan **OQ-10**.
- Status presensi kini final seketika; kartu "perlu validasi" dihapus dari dashboard/rekap.

---

## 1. Daftar Dokumen

| # | File | Isi | Pembaca utama |
|---|------|-----|---------------|
| 00 | `00_README_HANDOFF.md` | Indeks, hasil audit frontend, keputusan (D-xx), pertanyaan terbuka (OQ-xx), cara melanjutkan | Semua |
| 01 | `01_MRD.md` | Market/Business Requirements: masalah, tujuan bisnis, stakeholder, risiko | Pemilik produk, sekolah |
| 02 | `02_PRD.md` | Product Requirements: persona, user story, acceptance criteria, prioritas, cakupan | Product, FE, BE |
| 03 | `03_FSD.md` | Functional Spec: aturan bisnis, state machine, **kontrak API**, kontrak semantik UI, kode error | BE, FE, QA |
| 04 | `04_TRD.md` | Technical Spec: arsitektur, skema MySQL (DDL), kontrak Flask, keamanan, deployment, roadmap | BE, DevOps |
| 05 | `05_DESIGN_SYSTEM.md` | Design token & komponen **yang diekstrak dari kode FE**, plus konvensi semantik status/format untuk API | FE, BE |

**Urutan baca yang disarankan:** 00 → 02 → 03 → 04 (01 dan 05 sebagai konteks & kontrak semantik UI).

---

## 2. Aturan Anti-Halusinasi yang Dipakai

Dokumen ini disusun dengan aturan berikut agar tidak melebar:

1. **Sumber kebenaran berjenjang** (jika ada konflik, yang lebih atas menang):
   1. Pernyataan eksplisit pemilik proyek di chat (daftar fitur Web & Mobile, stack, 3 role: admin/guru/siswa, serta revisi v1.1 & v1.2).
   2. **Kode frontend yang sudah di-slicing** (repo web & mobile) — terutama kontrak API yang sudah tertulis di `src/lib/api.js` dan `AuthContext.jsx`.
   3. Dokumen UI/UX Kelompok 5 (`KELOMPOK_5_UIUX`) — *catatan: file ini hanya berisi teks outline Information Architecture & User Flow + gambar; teks gambar tidak dapat dibaca otomatis*.
   4. Asumsi saya — **selalu diberi label `ASUMSI`** dan masuk daftar keputusan/pertanyaan terbuka.
2. **Tidak ada angka/fakta pasar yang dikarang.** Target metrik diberi label `USULAN` dan harus dikonfirmasi.
3. **Nilai ambang (threshold) face recognition & jam presensi** adalah *konfigurasi*, bukan angka final. Nilai awal bertanda `TBD-kalibrasi`.
4. **Versi library tidak dipatok** di dokumen; pasang versi stabil terbaru saat implementasi dan kunci via lockfile.
5. **Fitur di luar daftar fitur pemilik proyek** (mis. manajemen siswa via UI penuh, broadcast WhatsApp — yang muncul di dokumen UI/UX) dimasukkan ke **Backlog**, bukan v1.

---

## 3. Hasil Audit Frontend (Fakta dari Kode)

### 3.1 Web — `asalmanafisa/frontend-mclass`

| Aspek | Temuan |
|-------|--------|
| Framework | **React 19 + Vite + Tailwind v4 + react-router-dom v7, JavaScript** — **bukan Next.js** |
| Base URL API | `VITE_API_URL` (production placeholder `https://api-kamu.com`); dev proxy `/api` → `http://localhost:3000` |
| Rute | `/login`, `/register`, `/forgot-password`, `/dashboard`, `/rekap-kelas`, `/semua-kelas`, `/detail-kelas/:kelas`, `/detail-lokasi`, `/validasi-wajah/:nis`, `/kalender`, `/buat-pengumuman`, `/pengaturan` |
| API yang **sudah terkoneksi** | `POST /api/auth/admin/login` (body `{identity, password}` → `{token, user}`), `GET /api/auth/me`, `PATCH /api/auth/me` (body `{name, email}`), `POST /api/auth/logout` |
| Penanganan error | 401 → hapus token & redirect `/login`; 403 → "Akses ditolak" (pesan dari server); 400 dengan `errors` berbentuk objek → tampil per-field; bentuk error `{message, errors}` |
| Token | Disimpan di `localStorage` (remember = true) atau `sessionStorage`; header `Authorization: Bearer <token>`; komentar kode menyebut "token dicabut" → server-side revocation diharapkan |
| Guard rute | `ProtectedRoute roles={["admin","teacher"]}` → membandingkan `user.role` |
| Data lain | **Seluruh halaman lain masih data dummy** (dashboard, rekap, detail kelas, lokasi, validasi wajah, kalender, pengumuman, pengaturan foto/sandi, register, lupa sandi) |
| Export Excel | Dilakukan di klien dengan library `xlsx` dari data dummy |
| Sekolah | "MTs Al-Ma'arif" (teks login: "02 Singosari"; teks lupa sandi: "Ponorogo" — **tidak konsisten**) |

### 3.2 Mobile — `yasmineesha/mobile_m-class_fe`

| Aspek | Temuan |
|-------|--------|
| Framework | Flutter (Dart SDK ^3.13.2), nama paket `m_class` |
| Dependency saat ini | `google_maps_flutter`, `camera`, `geolocator`, `google_fonts`, `flutter_svg` — **belum ada HTTP client, secure storage, image picker/file picker, push notification, google_sign_in** |
| Layar | splash, onboarding, login, register, lupa sandi → OTP → sandi baru, dashboard, scan wajah, peta lokasi presensi, surat izin (+ berhasil), riwayat, kalender, notifikasi, profil, detail pengumuman |
| Login | Field "Email / NISN" (NISN 10 digit); login Google didukung di backend via `POST /api/auth/oauth/google` (US-02B, D-30) |
| Register | Nama, NISN (**wajib 10 digit**), Email, Password (+ konfirmasi, ada indikator kekuatan) |
| Geofence | Peta menggambar lingkaran **radius 50 m**; koordinat sekolah hardcoded `-7.9826, 112.6308` |
| Presensi | Batas tepat waktu **07.15 WIB**; dialog "Tercatat Terlambat" dengan alasan cepat: *Macet Lalu Lintas*, *Kendala Kendaraan*, *Keperluan Keluarga*; notifikasi menampilkan "Match 99.4%" |
| Surat izin | Kategori **Sakit / Keperluan / Dispensasi**; periode Dari–Sampai (durasi hari dihitung); keterangan wajib; **lampiran wajib** PDF/JPG maks 5 MB; status "Menunggu"; teks "Notifikasi WhatsApp Wali Murid" |
| Profil siswa | NISN, kelas, nomor absen, nomor WA siswa, alamat, kontak orang tua/wali; data akademik **terkunci** ("perubahan melalui Operator TU") |
| Notifikasi | Presensi berhasil, presensi lengkap, percobaan di luar radius, surat izin disetujui walikelas, jadwal pulang lebih awal, pengumuman |

### 3.3 Dokumen UI/UX (Kelompok 5)

Berisi outline IA (Siswa, Admin) dan user flow (primary/alternatif/error). Beberapa flow **melebihi** daftar fitur pemilik proyek (manajemen siswa CRUD UI penuh, kiriman WhatsApp massal, edit radius GPS via UI, edit jadwal sesi, "presensi sesi"). Pemetaan ke cakupan ada di §6.

---

## 4. Ketidakcocokan yang Harus Diketahui (Findings)

| ID | Temuan | Dampak | Penanganan |
|----|--------|--------|-----------|
| F-01 | Web = Vite/React JS, bukan Next.js | Tidak ada SSR/API route; murni SPA → backend harus REST + CORS | D-01 |
| F-02 | Web `ProtectedRoute` mengecek role `admin`/`teacher`, sedangkan API memakai `admin`/`guru`/`siswa` | `admin` cocok, tetapi `guru` ≠ `teacher` → login guru ditolak | D-02 + **perubahan FE** (FC-01) |
| F-03 | Web memiliki `RegistrationForm` ("Registrasi Admin Baru") dan `ForgotPasswordForm` | Bertentangan dengan keputusan: akun admin/guru dikelola di database, hanya login & logout | D-04: halaman dihapus dari web (FC-02, DS-08) |
| F-04 | Koordinat sekolah berbeda: web `-7.8898, 112.6632` vs mobile `-7.9826, 112.6308` | Geofence salah → presensi ditolak massal | **OQ-03** (ambil dari satu sumber: tabel `school_settings`) |
| F-05 | Web memakai NIS 7 digit di data dummy (`2601001`), mobile mewajibkan NISN 10 digit | Dua identitas berbeda | D-05: kunci identitas = **NISN 10 digit**; NIS opsional |
| F-06 | Web tidak punya halaman **persetujuan surat izin**, padahal mobile mengirim surat izin ke wali kelas | Surat izin tidak bisa diproses dari web | Backend menyediakan endpoint review; **UI web perlu ditambah** (FC-05) |
| F-07 | **Tidak ada alur pendaftaran wajah (enrollment)** di mobile maupun web | Face recognition butuh wajah referensi | D-21; endpoint `face/enroll`; **layar mobile baru** (FC-08) |
| F-08 | Pengumuman web punya target `wali` (Wali Murid), tetapi tidak ada role wali | Tidak ada penerima | D-13: disimpan, **tidak dikirim** di v1 |
| F-09 | Mobile & web menyebut WhatsApp wali murid | Integrasi WA di luar stack/fitur | D-13: **di luar cakupan v1** |
| F-10 | Daftar siswa-di-luar-radius di web menampilkan nama jalan ("Jl. Raya Singosari") | Perlu reverse-geocoding (layanan eksternal) | D-12: backend kirim lat/lng + jarak; **tanpa reverse geocoding** di v1 |
| F-11 | Ejaan status: "Alfa" (export web) vs "Alpa" (label UI) vs "alpha" (pesan Anda) | Inkonsistensi label | Enum API: `alpa`; label baku UI & Excel: **"Alpa"** (`05_DESIGN_SYSTEM.md` §2.3, §7.1, DS-03) |
| F-12 | Mobile tidak punya dependency HTTP/secure-storage/file-picker/push/google_sign_in | Integrasi API butuh paket baru | Dicatat di FC-07 |
| F-13 | Nama sekolah tidak konsisten (02 Singosari / Ponorogo) | Konten email OTP & laporan | Nama sekolah dari `school_settings` / `GET /api/school/config` (DS-05) |
| F-14 | Web `ValidasiWajah` memiliki tombol & modal **Setujui/Tolak** validasi | Bertentangan dengan keputusan presensi otomatis | D-28: jadikan read-only (FC-06, DS-08) |

---

## 5. Log Keputusan (Decision Log)

Status: ✅ = diputuskan dari input Anda / kode FE; 🟡 = **asumsi saya** (bisa dibantah).

| ID | Keputusan | Dasar | Status |
|----|-----------|-------|--------|
| D-01 | Backend = REST JSON murni, CORS untuk origin web; tanpa SSR | F-01 | ✅ |
| D-02 | Nilai `role` di API: `admin` \| `guru` \| `siswa`. Web guard diubah ke `["admin","guru"]` (saat ini `["admin","teacher"]`) | Instruksi 4 Nov | ✅ |
| D-03 | Login terpisah: `POST /api/auth/admin/login` (khusus **admin & guru**, kontrak sudah ada di FE) dan `POST /api/auth/login` (khusus siswa/admin mobile). Role salah → 403 | Kode FE | ✅ |
| D-04 | **Akun admin & guru tidak punya registrasi**: dibuat/diubah/dihapus langsung di database; di web hanya **login & logout** (plus pengaturan akun setelah login). Registrasi dan lupa sandi OTP hanya untuk **siswa** (mobile) — lupa sandi khusus siswa adalah tafsiran dari "hanya login dan logout" | Instruksi 4 Nov | ✅ |
| D-05 | Identitas siswa = NISN 10 digit; login `identity` = email **atau** NISN | Mobile UI | ✅ |
| D-06 | "Kelas" = tingkat 7/8/9 (+ `section` opsional untuk paralel A/B). Dashboard FE menampilkan Kelas 7, 8, 9 | Kode FE | ✅ |
| D-07 | Enum status presensi: `hadir`, `terlambat`, `izin`, `sakit`, `alpa`. Kategori izin `sakit`→status `sakit`; `keperluan` & `dispensasi`→status `izin` | UI mobile & web | 🟡 |
| D-08 | v1: **satu sesi masuk per hari sekolah**, jadwal per hari-dalam-minggu (mis. Jumat berbeda) | Notif "Jumat pulang 11.30" | 🟡 |
| D-09 | Threshold wajah & jam presensi = konfigurasi (env/tabel), bukan hardcode | Anti-halusinasi | ✅ |
| D-10 | Geofence = 1 baris `school_settings` (lat, lng, radius_m; default radius 50) | Kode FE | ✅ |
| D-11 | Flask AI **hanya internal** (tidak diekspos ke klien); Express satu-satunya pintu masuk | Arsitektur | ✅ |
| D-12 | Presensi di luar radius **tidak dicatat sebagai hadir**, tetapi dicatat sebagai *attempt* (untuk daftar "di luar radius") | UI web DetailLokasi | ✅ |
| D-13 | WhatsApp & target audiens `wali` **di luar v1** | F-08, F-09 | ✅ |
| D-14 | Laporan dibuat **di server**: Excel (`.xlsx`) untuk web, PDF bulanan untuk mobile | Fitur Anda | ✅ |
| D-15 | Respons sukses auth mengikuti kontrak FE (top-level `{token,user}`); endpoint lain `{ "data": …, "meta"?: … }`. Error selalu `{message, errors?, code}` | Kode FE | ✅ |
| D-16 | Auth = JWT Bearer **dengan `jti` tersimpan di `auth_sessions` / `user_sessions`** (bisa dicabut, mendukung "Log Sesi Terakhir"). Tanpa refresh token di v1 | Kode FE | 🟡 |
| D-17 | Password hash **argon2id**; aturan: ≥ 8 karakter, mengandung huruf & angka | Teks FE | ✅ |
| D-18 | OTP lupa sandi: 6 digit, disimpan ter-hash, kedaluwarsa & batas percobaan (nilai di TRD) | UI 6 digit | ✅ |
| D-19 | Waktu disimpan **UTC**; hari presensi dihitung **Asia/Jakarta (WIB)** | Lokasi pengguna | ✅ |
| D-20 | File (foto presensi, lampiran izin, avatar) disimpan privat, diakses via endpoint terautentikasi/signed URL | Privasi | ✅ |
| D-21 | Face enrollment: endpoint khusus + persetujuan biometrik; layar mobile baru diperlukan | F-07 | 🟡 |
| D-22 | **Tidak ada presensi pulang** (dihapus 4 Nov): hanya presensi masuk; tidak ada kolom/endpoint check-out | Instruksi 4 Nov | ✅ |
| D-23 | Admin dan guru dapat melihat & memproses semua kelas (sekolah kecil, dashboard menampilkan 3 kelas sekaligus). `wali kelas` dipakai untuk routing notifikasi & fitur "Hubungi wali kelas" | Fitur Anda | 🟡 |
| D-24 | Notifikasi v1 = **in-app (REST + polling)**; push FCM = P1 | Mobile tanpa paket push | 🟡 |
| D-25 | Monitoring "real-time" web = polling berkala (mis. 30 dtk); SSE/WebSocket = P2 | Kesederhanaan | 🟡 |
| D-26 | Alpa otomatis oleh job terjadwal setelah batas presensi ditutup | Fitur Anda | ✅ |
| D-27 | Mode offline mobile **tidak didukung di v1** (sesuai "bukan prioritas") | Instruksi Anda | ✅ |
| D-28 | **Presensi wajah otomatis dengan satu ambang** (`FACE_MATCH_THRESHOLD`): cocok → langsung tercatat; tidak cocok → ditolak (boleh ulang). **Tidak ada validasi guru**; fitur "validasi foto" web = **lihat hasil scan** (read-only) | Instruksi 4 Nov | ✅ |
| D-29 | **Role `admin` = akses penuh**: semua endpoint staf (guru) + endpoint khusus admin (geofence, jadwal, reset enrollment — P1). Tidak mengakses fungsi personal siswa (presensi, izin sendiri). Cakupan persisnya: OQ-11 | Instruksi 4 Nov | ✅ (cakupan 🟡) |
| D-30 | **Login Google OAuth khusus siswa (`siswa`) di mobile** (`POST /api/auth/oauth/google`): memverifikasi `id_token` Google; menautkan otomatis ke akun `siswa` dengan email yang sama atau meminta 10 digit NISN (`OAUTH_NISN_REQUIRED`) untuk menautkan ke roster sekolah | Instruksi 11 Nov | ✅ |

---

## 6. Pemetaan Cakupan (Scope)

### 6.1 Daftar fitur Anda → Prioritas

| Fitur | Platform | Prioritas |
|-------|----------|-----------|
| **Web:** login (email + sandi), pesan sandi salah, logout — **tanpa registrasi & lupa sandi**. **Mobile:** register, login (Email/NISN), **login Google OAuth (ID Token + NISN)**, lupa sandi OTP, keluar | Web+Mobile | **P0** |
| Dashboard utama web (total, hadir, terlambat/izin, belum hadir/alpa, monitoring kelas, pengumuman, kalender) | Web | **P0** |
| Rekap kelas (detail real-time, rata-rata, izin/sakit, alpa, hasil scan wajah (lihat saja), radius GPS, terpantau/di luar radius, export Excel) | Web | **P0** |
| Kalender + buat pengumuman | Web | **P0** |
| Setting (akun, foto profil, data diri, log sesi, ganti sandi) & logout | Web | **P0** |
| Presensi GPS + foto + face recognition | Mobile | **P0** |
| Status harian, popup terlambat, alpa otomatis | Mobile | **P0** |
| Surat izin digital (sakit/izin) | Mobile | **P0** |
| Riwayat + laporan PDF bulanan | Mobile | **P0** |
| Kalender akademik, pengumuman, notifikasi, hubungi wali kelas, setting | Mobile | **P0** |
| Push notification (FCM), revoke sesi lain, edit radius via API | — | **P1** |
| SSE/WebSocket real-time, liveness/anti-spoof lanjutan | — | **P2** |
| Mode offline | Mobile | **Bukan prioritas (di luar v1)** |

### 6.2 Item dokumen UI/UX di luar daftar fitur Anda → Backlog

| Item UI/UX | Status |
|------------|--------|
| Manajemen siswa (tambah/edit/hapus) via UI | **Backlog UI** — v1 menyediakan *import CSV roster via CLI* & endpoint API `/api/roster` (OQ-02) |
| Kiriman WhatsApp massal / broadcast WA | **Backlog** (D-13) |
| Edit radius GPS & jadwal sesi via UI | **Backlog UI**; endpoint API `P1` tersedia |
| Broadcast hari libur | Tercakup oleh **Pengumuman kategori `libur`** |
| Rekap bulanan / download PDF | Tercakup (laporan bulanan mobile) |

---

## 7. Pertanyaan Terbuka (butuh jawaban Anda)

Setiap pertanyaan punya **default** agar pekerjaan tetap jalan. Cukup balas "setuju semua default" atau koreksi per nomor.

| ID | Pertanyaan | Default yang dipakai dokumen |
|----|-----------|------------------------------|
| OQ-01 | ~~Apakah web register untuk guru?~~ | **Terjawab (4 Nov):** tidak ada registrasi guru/admin (D-04) |
| OQ-02 | Siapa yang membuat data siswa? Karena tidak ada UI manajemen siswa. | Roster siswa **di-import CSV via script CLI** (dan didukung endpoint `/api/roster` untuk admin/guru); register/OAuth siswa hanya berhasil jika NISN ada di roster & belum diklaim |
| OQ-02b | ~~Gerbang akun guru~~ | **Tidak berlaku lagi:** akun admin/guru dibuat di database |
| OQ-03 | Koordinat resmi sekolah? (web vs mobile berbeda) | Diisi lewat `school_settings`; **belum ada nilai final** |
| OQ-04 | Jam presensi: buka, batas terlambat, tutup, jadwal Jumat | Contoh dari FE: batas terlambat **07:15**; Jumat bisa berbeda (contoh FE: KBM berakhir 11:30). Jam buka & tutup `TBD` (placeholder 06:00 / 12:00) |
| OQ-05 | Ambang kecocokan wajah (**satu ambang**, tanpa review) & kebijakan liveness | `TBD-kalibrasi`; tanpa liveness di v1 (disarankan naik ke P1 karena tanpa peninjauan manual) tetapi foto **wajib dari kamera langsung** |
| OQ-06 | Penyedia email OTP (SMTP)? | SMTP generik via Nodemailer |
| OQ-07 | Target hosting? | Host Linux langsung (systemd + Nginx/Caddy, tanpa Docker — TD-17) |
| OQ-08 | ~~Presensi pulang masuk v1?~~ | **Terjawab (4 Nov):** dihapus dari cakupan (D-22) |
| OQ-09 | Persetujuan orang tua untuk data biometrik siswa (anak < 18) | Wajib dicatat sebelum enrollment (`biometric_consent_at`); bentuk formulir ditentukan sekolah. *Bukan nasihat hukum — konsultasikan dengan pihak berwenang/sekolah terkait UU PDP No. 27/2022* |
| OQ-10 | Bagaimana jika siswa **sah** terus gagal verifikasi (false reject) padahal tidak ada validasi manual? | Tidak ada mekanisme koreksi di v1: siswa mengulang scan / enrollment ulang; jika tetap gagal → alpa di akhir hari. *Opsi (jika Anda mau): endpoint koreksi manual oleh admin (`source=manual`; kolom sudah tersedia)* |
| OQ-11 | Cakupan persis "admin untuk semua akses" | Admin = semua endpoint staf + endpoint khusus admin (P1); **tidak** bertindak sebagai siswa. Beri tahu bila admin juga harus mengelola akun/siswa lewat API/UI atau mengoreksi presensi |

---

## 8. Perubahan Frontend yang Dibutuhkan (Change List)

| ID | Platform | Perubahan | Prioritas |
|----|----------|-----------|-----------|
| FC-01 | Web | `ProtectedRoute roles={["admin","guru"]}` (saat ini `["admin","teacher"]`) | P0 |
| FC-02 | Web | **Hapus** halaman `/register` dan `/forgot-password` (+ tautan "Lupa Sandi?" di login) — akun admin/guru dikelola di database (DS-08) | P0 |
| FC-03 | Web | Ganti semua data dummy (dashboard, rekap, detail kelas/lokasi, hasil scan wajah, kalender, pengumuman) dengan API; ambil nama sekolah dari `GET /api/school/config` (DS-05) | P0 |
| FC-04 | Web | Pengaturan: sambungkan ganti foto/hapus foto (upload ≤ 2 MB JPG/PNG/WebP), ganti sandi, daftar sesi | P0 |
| FC-05 | Web | Tambah halaman **persetujuan surat izin** | P0 (jika izin harus diproses dari web) |
| FC-06 | Web | `/validasi-wajah/:nis` → jadikan **read-only** (hapus tombol & `ModalSetujuiValidasi`/`ModalTolakValidasi`, DS-08), gunakan `scan_id`/NISN; hapus ketergantungan `ui-avatars.com` (DS-07); tampilkan lat/lng bila nama jalan tidak tersedia | P0 |
| FC-07 | Mobile | Tambah paket: HTTP client, secure storage, file/image picker, `google_sign_in`, (opsional) FCM; ganti koordinat hardcoded dengan data dari `GET /api/school/config` | P0 |
| FC-08 | Mobile | Layar **enrollment wajah** + persetujuan biometrik | P0 |
| FC-09 | Mobile | Kirim `is_mocked` & `accuracy` dari `geolocator` saat presensi | P0 |

---

## 9. Status Pekerjaan & Cara Melanjutkan

### 9.1 Status dokumen

| Dokumen | Status |
|---------|--------|
| 00 README/Handoff | ✅ Selesai |
| 01 MRD | ✅ Selesai |
| 02 PRD | ✅ Selesai |
| 03 FSD | ✅ Selesai |
| 04 TRD | ✅ Selesai |
| 05 Design System | ✅ Selesai |

Semua dokumen (00–05) telah tersedia di `requirements/` dan diselaraskan.

### 9.2 Langkah implementasi berikutnya (urutan)

1. Jawab OQ-03 s.d. OQ-11 (OQ-01, OQ-02b, OQ-08 sudah terjawab) atau setujui default.
2. Scaffold / kembangkan repo `backend_mclass` (struktur di TRD §6) dan `mclass-ai` (Flask).
3. Eksekusi **Milestone M0 → M8** pada TRD §14, satu milestone per sesi kerja.
4. Terapkan Change List FE (§8) dan rekomendasi perapihan Design System (`05_DESIGN_SYSTEM.md` §12, DS-01…DS-08) paralel per milestone.

### 9.3 Template prompt untuk melanjutkan di chat baru

```text
Konteks: saya membangun backend M-Class (Express+TS, MySQL, Flask AI).
Dokumen acuan terlampir: 00_README_HANDOFF.md, 01_MRD.md, 02_PRD.md, 03_FSD.md, 04_TRD.md, 05_DESIGN_SYSTEM.md.
Patuhi Log Keputusan (D-xx) dan jangan menambah fitur di luar PRD.
Tugas sekarang: kerjakan Milestone <Mx> pada TRD §14.
Jawaban atas pertanyaan terbuka: <setuju semua default / koreksi: OQ-0x = ...>.
```

---

## 10. Glosarium

| Istilah | Arti |
|---------|------|
| Presensi / Absensi | Pencatatan kehadiran siswa |
| Geofence | Area lingkaran (lat, lng, radius) tempat presensi sah |
| Embedding | Vektor numerik wajah hasil model face recognition |
| Attempt | Satu percobaan presensi (berhasil maupun ditolak) |
| Roster | Daftar siswa resmi sekolah yang sudah di-import |
| Alpa | Tidak hadir tanpa keterangan (ejaan baku UI & API: `alpa` / **Alpa**) |
| WIB | Waktu Indonesia Barat (UTC+7) |
