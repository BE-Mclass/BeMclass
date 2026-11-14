# 01 — Market / Business Requirements Document (MRD)

> **Produk:** M-Class — Sistem Absensi Digital Sekolah Menengah Pertama (MTs/SMP)
> **Versi:** 1.2 · **Tanggal:** 12 November 2026 · **Status:** Draft untuk review
> **Konvensi label:** `USULAN` = angka/target usulan yang perlu dikonfirmasi · `ASUMSI` = dugaan yang belum divalidasi. Dokumen ini **tidak memuat statistik pasar** karena tidak ada data tervalidasi yang tersedia.
> **Revisi v1.1:** akun admin/guru dikelola di database (tanpa registrasi); presensi wajah otomatis tanpa validasi manual (guru/admin hanya melihat hasil scan); role `admin` ditambahkan.
> **Revisi v1.2:** penyelarasan dengan PRD v1.3, FSD v1.4, TRD v1.4, dan Design System v1.2 (termasuk dukungan login Google OAuth untuk siswa di aplikasi mobile dengan penautan NISN ke roster).

---

## 1. Ringkasan Eksekutif

M-Class adalah sistem absensi untuk sekolah menengah pertama yang memadukan **verifikasi lokasi GPS (geofence)**, **verifikasi wajah (face recognition)**, dan **surat izin digital**. Siswa mengisi presensi melalui aplikasi mobile; admin dan guru memantau, melihat hasil scan wajah, dan merekap melalui dashboard web (akun staf dikelola di database). Backend (Express + MySQL + Flask AI) menjadi sumber kebenaran tunggal untuk kedua klien.

Dokumen ini menjawab **mengapa** produk dibuat, **untuk siapa**, dan **seperti apa keberhasilannya** dari sisi bisnis/sekolah — bukan bagaimana membangunnya (lihat PRD, FSD, TRD).

---

## 2. Latar Belakang & Masalah

### 2.1 Kondisi saat ini (`ASUMSI`, berdasarkan alur yang digambarkan dokumen UI/UX)

- Presensi harian dicatat manual (kertas/rekap guru) sehingga rekap bulanan memakan waktu.
- Surat izin/sakit disampaikan secara fisik atau lewat pesan informal, sulit dilacak.
- Titip absen (siswa mengabsenkan teman) sulit dicegah tanpa verifikasi identitas dan lokasi.
- Guru/wali kelas tidak memiliki gambaran kehadiran **hari ini** secara cepat.

### 2.2 Pernyataan masalah

> Sekolah membutuhkan cara **cepat, dapat dipercaya, dan terdokumentasi** untuk mencatat kehadiran siswa, memproses izin, dan menghasilkan laporan — tanpa menambah beban administrasi guru.

### 2.3 Akar masalah yang ditangani produk

| Masalah | Mekanisme solusi produk |
|---------|--------------------------|
| Titip absen | Wajah diverifikasi oleh AI + posisi harus dalam radius sekolah |
| Rekap lambat | Rekap otomatis per kelas + export Excel / PDF |
| Izin tidak terlacak | Surat izin digital dengan lampiran, status, dan persetujuan |
| Tidak ada visibilitas real-time | Dashboard monitoring kelas (pembaruan berkala) |
| Komunikasi informasi sekolah | Pengumuman & kalender akademik terpusat |

---

## 3. Visi, Tujuan, dan Sasaran Bisnis

**Visi:** Presensi sekolah yang jujur, cepat, dan transparan.

| ID | Tujuan Bisnis | Indikator Keberhasilan | Target |
|----|---------------|------------------------|--------|
| BG-01 | Mengurangi waktu administrasi presensi guru | Waktu pembuatan rekap bulanan per kelas | Dari proses manual → ≤ beberapa klik (`USULAN`: < 1 menit) |
| BG-02 | Mengurangi kecurangan presensi | Rasio attempt ditolak karena wajah/lokasi; jumlah laporan titip absen yang terbukti | Dipantau lewat metrik attempt (`USULAN`: dikalibrasi saat pilot) |
| BG-03 | Memastikan setiap ketidakhadiran terdokumentasi | Persentase hari tidak hadir yang memiliki status akhir (izin/sakit/alpa) | `USULAN`: 100% (otomatis oleh job alpa) |
| BG-04 | Adopsi oleh siswa & staf | Persentase siswa aktif melakukan presensi via aplikasi pada hari sekolah | `USULAN`: ≥ 90% pada minggu ke-4 pilot |
| BG-05 | Informasi sekolah sampai tepat waktu | Pengumuman terbaca (notifikasi dibuka) | Dipantau; target ditetapkan setelah pilot |

> Seluruh target bertanda `USULAN` harus disepakati pemilik proyek dan pihak sekolah sebelum dijadikan acuan penerimaan.

---

## 4. Pemangku Kepentingan (Stakeholders)

| Pemangku | Kepentingan | Peran dalam sistem |
|----------|-------------|--------------------|
| Siswa | Presensi mudah, izin cepat, riwayat jelas | Role `siswa` (mobile) |
| Admin | Akses penuh ke seluruh fitur web; konfigurasi sekolah | Role `admin` (web); akun dikelola di database |
| Guru / wali kelas | Monitoring, melihat hasil scan wajah, rekap, persetujuan izin, pengumuman | Role `guru` (web); akun dikelola di database |
| Kepala sekolah / pihak sekolah | Data kehadiran akurat, kepatuhan privasi | Penerima laporan (via admin/guru); pemberi persetujuan kebijakan |
| Orang tua / wali murid | Mengetahui kehadiran anak | **Bukan pengguna sistem di v1** (tidak ada role wali; WhatsApp di luar cakupan) |
| Operator TU / pengelola database | Mengelola data siswa & akun staf | Menjalankan import roster (CLI / API `/api/roster`) dan mengelola akun admin/guru **langsung di database** di v1 |
| Tim pengembang (Kelompok 5 + backend) | Membangun & merawat | — |

---

## 5. Pengguna Sasaran

| Segmen | Ciri | Kebutuhan utama |
|--------|------|-----------------|
| Siswa SMP/MTs (kelas 7–9) | Menggunakan ponsel (kemungkinan Android; `ASUMSI`), tanpa banyak pengalaman aplikasi | Alur presensi singkat, notifikasi jelas |
| Admin & guru/wali kelas | Mengakses dashboard dari laptop | Ringkasan cepat, drill-down per kelas, hasil scan wajah, export |

**Ukuran awal (pilot):** data dummy FE menampilkan **30 siswa** (3 kelas × 10). Angka ini dipakai sebagai skala awal; arsitektur dirancang tidak terkunci pada angka tersebut (lihat TRD §10).

---

## 6. Lanskap Alternatif (Kualitatif)

| Alternatif | Kelebihan | Kekurangan relatif terhadap M-Class |
|-----------|-----------|--------------------------------------|
| Absen manual (kertas/buku) | Tanpa teknologi | Rekap lambat, mudah dimanipulasi, tidak ada bukti lokasi/wajah |
| Pesan instan untuk izin | Familier | Tidak terstruktur, tidak terintegrasi dengan rekap |
| Aplikasi absensi umum (kantor) | Siap pakai | Tidak mengenal konsep kelas, wali kelas, surat izin sekolah, atau kalender akademik |

> Tidak ada klaim perbandingan produk spesifik karena tidak ada riset kompetitor terverifikasi.

---

## 7. Proposisi Nilai

- **Untuk admin/guru:** gambaran kehadiran hari ini dalam satu layar; rekap & export otomatis; hasil scan wajah dapat dilihat sebagai bukti (tanpa perlu menyetujui satu per satu).
- **Untuk siswa:** presensi dalam hitungan langkah (buka app → scan wajah); izin digital dengan status yang bisa dilacak.
- **Untuk sekolah:** bukti kehadiran berlapis (waktu + lokasi + wajah), arsip digital, dan kalender/pengumuman terpusat.

---

## 8. Cakupan Bisnis

### 8.1 Dalam cakupan (v1)

1. Presensi harian berbasis GPS + foto + verifikasi wajah **otomatis** (cocok → langsung tercatat).
2. Status kehadiran: hadir, terlambat, izin, sakit, alpa (otomatis).
3. Surat izin digital dengan lampiran & persetujuan admin/guru.
4. Dashboard & rekap kelas, melihat hasil scan wajah (read-only), monitoring radius, export Excel.
5. Riwayat kehadiran & laporan PDF bulanan (siswa).
6. Kalender akademik & pengumuman; notifikasi in-app.
7. Autentikasi: **admin/guru hanya login & logout** (akun dikelola di database); **siswa** register, login (email/NISN), **login Google OAuth (ID Token + tautan NISN ke roster)**, lupa sandi via OTP email; pengaturan akun.

### 8.2 Di luar cakupan (v1)

- Role orang tua/wali.
- Integrasi WhatsApp / SMS.
- Registrasi/UI manajemen akun admin/guru (dikelola di database), OAuth untuk web admin/guru, dan manajemen siswa melalui UI penuh (v1 memakai CLI/CSV & endpoint roster).
- Mode offline mobile.
- Integrasi sistem eksternal (Dapodik/EMIS, dsb.).
- Presensi per mata pelajaran/jam pelajaran.

---

## 9. Batasan, Asumsi, dan Ketergantungan

### 9.1 Batasan (constraints)

| ID | Batasan |
|----|---------|
| C-01 | Stack tetap: Express + TypeScript, MySQL, Flask AI service |
| C-02 | Klien sudah di-slicing (Web React/Vite, Mobile Flutter) — kontrak API dan semantik status/label harus menyesuaikan klien (`05_DESIGN_SYSTEM.md`), bukan sebaliknya, sejauh masuk akal |
| C-03 | Tiga role: `admin` (akses penuh), `guru`, `siswa` |
| C-04 | Data biometrik siswa (anak di bawah umur) → wajib memperhatikan privasi & persetujuan |

### 9.2 Asumsi

| ID | Asumsi |
|----|--------|
| A-01 | Sekolah menyediakan roster siswa (NISN, nama, kelas) dalam bentuk CSV |
| A-02 | Siswa memiliki ponsel dengan kamera depan, GPS, dan koneksi data pada jam presensi |
| A-03 | Sekolah menetapkan koordinat & radius resmi serta jadwal presensi |
| A-04 | Satu sekolah (single-tenant) pada v1 |
| A-05 | Pengelola sekolah/tim mampu mengelola akun admin/guru langsung di database (dibantu helper `hash-password` / `cli-user`) dan menjalankan script CLI sederhana |

### 9.3 Ketergantungan

| Ketergantungan | Pemilik | Dampak bila terlambat |
|----------------|---------|-----------------------|
| Perubahan FE (daftar di 00 §8 & 05 §12) | Tim FE | Integrasi tertunda |
| Koordinat, jam presensi, roster siswa | Pihak sekolah | Tidak bisa uji lapangan |
| Layanan SMTP untuk OTP & Google Cloud Console (`GOOGLE_CLIENT_ID`) | Tim/sekolah | Lupa sandi / Login Google mobile tidak berfungsi |
| Model face recognition & dataset uji | Tim AI | Kualitas verifikasi tidak terukur |

---

## 10. Risiko Bisnis & Mitigasi

| ID | Risiko | Dampak | Kemungkinan | Mitigasi |
|----|--------|--------|-------------|----------|
| R-01 | **Privasi data biometrik anak** (wajah) | Tinggi | Sedang | Persetujuan orang tua/wali tercatat; embedding dienkripsi; retensi foto dibatasi; akses foto terbatas pada admin/guru; hapus pemanggilan avatar pihak ketiga `ui-avatars.com` (DS-07); konsultasi hukum (UU PDP) |
| R-02 | False reject wajah (siswa sah ditolak) — **tanpa review manual** berujung alpa | Tinggi | Sedang | Satu ambang yang dikalibrasi saat pilot; multi-sampel enrollment; boleh mengulang scan; enrollment ulang; **keputusan mekanisme koreksi (OQ-10)** |
| R-03 | False accept / spoofing (foto dari foto) — **tanpa peninjauan manual** | Tinggi | Sedang | Wajib kamera langsung, deteksi mock location, log scan yang dapat dilihat admin/guru; liveness (disarankan naik ke P1) |
| R-04 | GPS tidak akurat di dalam gedung | Sedang | Tinggi | Ambang akurasi dikonfigurasi; pesan panduan GPS; uji lapangan; OQ-10 |
| R-05 | Resistensi pengguna / adopsi rendah | Sedang | Sedang | Onboarding sederhana; login Google OAuth 1-klik untuk siswa; pilot bertahap; umpan balik |
| R-06 | Koordinat/jam salah konfigurasi → presensi ditolak massal | Tinggi | Sedang | Konfigurasi terpusat (`school_settings`) + checklist go-live + uji lapangan sebelum rilis |
| R-07 | Ketidaksinkronan FE–BE (role, kontrak, label status) | Sedang | Tinggi | Dokumen FSD & Design System §7 sebagai kontrak; Change List FE (00 §8) |
| R-08 | Kehilangan data | Tinggi | Rendah | Backup harian terjadwal; uji restore |

---

## 11. Pertimbangan Biaya (Kualitatif)

| Komponen | Sifat biaya |
|----------|-------------|
| Server (API + AI + DB) | Berulang; AI service membutuhkan CPU lebih besar (GPU opsional, `ASUMSI`: CPU cukup untuk skala pilot) |
| Google Maps & Google Sign-In (mobile) | Mengikuti kebijakan harga/kuota Google — verifikasi sebelum produksi (Google Sign-In OIDC gratis) |
| Email OTP | Bergantung penyedia SMTP |
| Penyimpanan foto/lampiran | Tumbuh seiring waktu; dikendalikan dengan kebijakan retensi |
| Domain & TLS | Tahunan; TLS wajib (kamera/GPS/HTTPS mobile) |

> Estimasi nominal tidak diberikan karena tidak ada data tarif & kebutuhan beban yang terverifikasi.

---

## 12. Rencana Peluncuran (Go-to-Market Sekolah)

| Fase | Isi | Kriteria lanjut |
|------|-----|-----------------|
| 0. Persiapan | Konfirmasi OQ, koordinat, jam, roster, persetujuan biometrik | Semua OQ P0 terjawab |
| 1. Uji internal | Uji tim dengan akun dummy, uji lapangan geofence | Presensi end-to-end berjalan |
| 2. Pilot terbatas | 1 kelas (≈10 siswa), 1–2 guru + 1 admin, 2 minggu | Metrik BG-02/BG-04 terukur, bug kritis nol |
| 3. Perluasan | Kelas 7–9 | Threshold terkalibrasi, backup teruji |
| 4. Operasional | Pemeliharaan & perbaikan berkelanjutan | — |

---

## 13. Kriteria Keberhasilan Rilis (Business Acceptance)

1. Siswa pilot dapat melakukan presensi hadir/terlambat dengan GPS + wajah **tanpa bantuan developer**.
2. Admin/guru dapat melihat dashboard, melihat hasil scan wajah, menyetujui izin, dan mengekspor Excel kelas.
3. Siswa tidak hadir tanpa izin otomatis berstatus alpa pada akhir hari.
4. Laporan PDF bulanan siswa dan Excel kelas sesuai data di sistem.
5. Tidak ada kebocoran data antar-siswa (siswa hanya melihat datanya sendiri).
6. Pihak sekolah menandatangani persetujuan penggunaan data biometrik (OQ-09).

---

## 14. Referensi Silang

- Persona, user story, prioritas → `02_PRD.md`
- Aturan bisnis & API → `03_FSD.md`
- Arsitektur & keamanan → `04_TRD.md`
- Kontrak semantik UI ↔ API, token desain, & pesan → `05_DESIGN_SYSTEM.md`
- Keputusan & pertanyaan terbuka → `00_README_HANDOFF.md`
