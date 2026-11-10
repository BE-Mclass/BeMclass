# 02 — Product Requirements Document (PRD)

> **Produk:** M-Class · **Versi:** 1.1 · **Tanggal:** 4 November 2026
> **Cakupan dokumen:** *Apa* yang dibangun dan *kriteria penerimaannya*. Detail aturan & API ada di `03_FSD.md`.
> **Prioritas:** `P0` wajib v1 · `P1` v1 jika waktu cukup / rilis berikutnya · `P2` backlog.

> **Revisi v1.1 (4 Nov 2026) — perubahan dari pemilik proyek:**
> 1. **Akun admin & guru tidak punya registrasi.** Akun dikelola (tambah/ubah/hapus) langsung di database; di web hanya ada **login dan logout**.
> 2. **Presensi wajah sepenuhnya otomatis.** Siswa langsung tercatat hadir bila wajah cocok dengan data referensi — **tanpa menunggu validasi guru**. Halaman "validasi" di web menjadi **lihat hasil scan saja** (read-only).
> 3. **Role `admin` ditambahkan** dengan akses penuh. Role sekarang: `admin`, `guru`, `siswa`.
> 4. **Presensi pulang dihapus** dari cakupan (tidak ada fitur, endpoint, maupun kolom check-out); hanya ada presensi masuk.

---

## 1. Tujuan Produk

1. Siswa melakukan presensi harian lewat mobile dengan **GPS + foto wajah**.
2. Admin/guru memantau, melihat hasil scan wajah, dan merekap kehadiran lewat web.
3. Izin/sakit diajukan sebagai **surat izin digital** dan diproses admin/guru.
4. Sekolah menyebarkan **pengumuman & kalender akademik** secara terpusat.

Tujuan bisnis & metrik: lihat `01_MRD.md` §3.

---

## 2. Persona

### 2.1 Admin — "Pak Hendra, pengelola sekolah" (web)

| Atribut | Isi |
|---------|-----|
| Peran sistem | `admin` |
| Tujuan | Akses ke **semua** fitur web; mengatur konfigurasi sekolah (geofence, jadwal — P1) dan membantu enrollment ulang wajah (P1) |
| Akun | Dibuat/diubah/dihapus **langsung di database** (tanpa registrasi) |
| Hak akses | Seluruh hak `guru` + fitur khusus admin (lihat FSD §2) |

### 2.2 Guru / Wali Kelas — "Bu Rina" (web)

| Atribut | Isi |
|---------|-----|
| Peran sistem | `guru` |
| Tujuan | Tahu siapa yang hadir/terlambat/izin/alpa hari ini; melihat hasil scan wajah; memproses surat izin; rekap & laporan; umumkan agenda |
| Frustrasi | Rekap manual, surat izin tercecer, tidak tahu siswa hadir di mana |
| Perangkat | Laptop/desktop (browser) |
| Akun | Dibuat/diubah/dihapus **langsung di database** (tanpa registrasi) |
| Hak akses | Melihat & memproses **semua kelas** (D-23) |

### 2.3 Siswa — "Dimas, kelas 8" (mobile)

| Atribut | Isi |
|---------|-----|
| Peran sistem | `siswa` |
| Tujuan | Presensi cepat; ajukan izin; lihat riwayat; tahu pengumuman |
| Frustrasi | Antrean absen manual; takut dianggap alpa padahal sudah izin |
| Perangkat | Ponsel (kamera + GPS) |
| Hak akses | Hanya **data dirinya sendiri** |
| Akun | Mendaftar sendiri lewat mobile (NISN harus ada di roster) |

> Tidak ada persona orang tua/wali di v1 (D-13). Tidak ada UI untuk mengelola akun staf.

---

## 3. Ringkasan Fitur & Prioritas

### 3.1 Web (admin & guru)

| Kode | Fitur | Prioritas |
|------|-------|-----------|
| W-AUTH | Login (email + sandi), pesan sandi salah, logout — **tanpa registrasi & tanpa lupa sandi** (akun dikelola di database) | P0 |
| W-DASH | Dashboard utama: total siswa, sudah hadir, terlambat/izin, belum hadir/alpa, monitoring kelas, pengumuman, mini kalender | P0 |
| W-REKAP | Rekap kelas: kehadiran rata-rata, total izin/sakit, alpa, detail per kelas, daftar siswa, pencarian | P0 |
| W-FACE | Hasil scan wajah (**lihat saja**): foto scan vs foto referensi, skor kecocokan, jarak vs radius | P0 |
| W-GPS | Monitoring radius GPS: siswa terpantau vs di luar radius | P0 |
| W-EXP | Export laporan Excel | P0 |
| W-CAL | Kalender: total agenda, agenda penting, libur nasional, agenda berlangsung | P0 |
| W-ANN | CRUD pengumuman (jenis, judul, tanggal, target, prioritas, deskripsi, status) | P0 |
| W-SET | Pengaturan akun: profil, foto (ganti/hapus), log sesi, ganti sandi, simpan | P0 |
| W-LEAVE | Persetujuan surat izin siswa | P0 *(UI belum ada — FC-05)* |
| W-OUT | Logout | P0 |
| W-ADM | Fitur khusus admin: atur geofence & jadwal presensi, reset enrollment wajah (API; belum ada UI) | P1 |

### 3.2 Mobile (siswa)

| Kode | Fitur | Prioritas |
|------|-------|-----------|
| M-AUTH | Register (nama, NISN, email, sandi), login (email/NISN), lupa sandi (OTP), keluar | P0 |
| M-FACE | Enrollment wajah + persetujuan biometrik | P0 *(layar baru — FC-08)* |
| M-ATT | Presensi GPS + foto + verifikasi wajah **otomatis** (cocok → langsung tercatat) | P0 |
| M-STAT | Status harian (hadir/terlambat/izin/sakit/alpa), popup terlambat | P0 |
| M-LEAVE | Surat izin digital (sakit/keperluan/dispensasi) + lampiran + status | P0 |
| M-HIST | Riwayat kehadiran + laporan PDF 1 bulan | P0 |
| M-CAL | Kalender akademik (UTS, UAS, libur, agenda) | P0 |
| M-ANN | Pengumuman sekolah & kelas | P0 |
| M-NOTIF | Pusat notifikasi (in-app) | P0 |
| M-PROF | Profil siswa + hubungi wali kelas + ubah no. WA/alamat | P0 |
| M-PUSH | Push notification (FCM) | P1 |
| M-OFF | Mode offline | **Tidak di v1** |

---

## 4. User Stories & Acceptance Criteria

> Format AC: **Given / When / Then**. ID `US-xx` dipakai di FSD & test.

### 4.1 Autentikasi

**US-01 — Admin/Guru login (Web)** · P0
Sebagai admin atau guru, saya ingin masuk dengan email dan kata sandi agar dapat mengakses dashboard.
- **AC1** Given kredensial benar & akun aktif, When submit, Then token + data user diterima dan saya diarahkan ke `/dashboard`.
- **AC2** Given email/sandi salah, Then tampil "Login gagal! Email atau kata sandi salah." (HTTP 401), tanpa membocorkan mana yang salah.
- **AC3** Given akun siswa mencoba login web, Then 403 "Akses ditolak".
- **AC4** Given akun nonaktif, Then 403 dengan pesan jelas.
- **AC6** Given akun dihapus/dinonaktifkan di database saat sesi masih aktif, Then token berikutnya ditolak (401).
- **AC5** Given "Ingat perangkat ini" dicentang, Then sesi tetap setelah browser ditutup (diatur FE; token tetap valid sesuai masa berlaku).

**US-02 — Siswa login (Mobile)** · P0
- **AC1** Identitas dapat berupa **email atau NISN 10 digit** + sandi.
- **AC2** Salah kredensial → 401 pesan generik. Akun admin/guru → 403.

**US-03 — Register siswa (Mobile)** · P0
- **AC1** Input: nama, NISN (10 digit angka), email, sandi (≥ 8, huruf & angka), konfirmasi sandi (validasi di klien).
- **AC2** NISN harus ada di **roster**; jika tidak → 422 "NISN tidak terdaftar di sekolah".
- **AC3** NISN sudah diklaim → 409 "NISN sudah terdaftar". Email sudah dipakai → 409.
- **AC4** Format email salah → 400 dengan `errors.email`.

**US-04 — Akun admin & guru dikelola di database (tanpa registrasi)** · P0 *(D-04)*
Akun admin/guru dibuat, diubah, dan dihapus langsung di database; tidak ada pendaftaran mandiri.
- **AC1** Tidak ada endpoint maupun halaman registrasi untuk admin/guru (halaman `/register` dan `/forgot-password` di web tidak dipakai).
- **AC2** Akun yang dihapus/nonaktif tidak bisa login dan sesinya langsung tidak berlaku (BR-05).
- **AC3** Sandi tersimpan sebagai hash argon2id; operator mendapat helper CLI untuk membuat hash (TRD §12.4).

**US-05 — Lupa sandi via OTP (Mobile, khusus siswa)** · P0
- **AC1** Input email → OTP 6 digit dikirim ke email (respons sama baik email terdaftar atau tidak).
- **AC2** OTP salah/kedaluwarsa → 400; terlalu banyak percobaan → 429.
- **AC3** OTP benar → izin ganti sandi berumur pendek; sandi baru (≥ 8, huruf & angka) menggantikan lama dan **semua sesi aktif dicabut**.
- **AC4** Kirim ulang OTP dibatasi cooldown.
- **AC5** Hanya untuk akun siswa. Permintaan untuk email admin/guru mendapat respons identik tetapi **tidak ada OTP terkirim**.

**US-06 — Logout** · P0
- **AC** Token dicabut di server; token yang sama tidak bisa dipakai lagi (401).

### 4.2 Presensi (Mobile)

**US-10 — Enrollment wajah** · P0
Sebagai siswa, saya mendaftarkan wajah sekali agar presensi berikutnya dapat diverifikasi.
- **AC1** Wajib menyetujui persetujuan biometrik (dicatat dengan waktu).
- **AC2** Sistem menerima beberapa foto; hanya foto dengan tepat satu wajah & kualitas memadai yang diterima; selainnya ditolak dengan alasan (mis. wajah tidak terlihat jelas).
- **AC3** Status enrollment dapat dicek; presensi tanpa enrollment → 409 `FACE_NOT_ENROLLED`.

**US-11 — Presensi masuk (GPS + wajah)** · P0
- **AC1** Given dalam radius, dalam jendela waktu, dan wajah cocok dengan data referensi, When kirim foto + koordinat, Then presensi **langsung tercatat** `hadir` (jika ≤ batas) atau `terlambat` (jika > batas) tanpa menunggu persetujuan guru, dan notifikasi "Absensi Masuk Berhasil" dibuat.
- **AC2** Given di luar radius, Then **tidak tercatat**; respons memuat jarak & radius; percobaan tersimpan sebagai *attempt* dan muncul di daftar "di luar radius" web.
- **AC3** Given wajah tidak cocok, Then ditolak, siswa boleh mencoba lagi (dengan batas jumlah percobaan).
- **AC4** Keputusan wajah **sepenuhnya otomatis** (satu ambang): cocok → tercatat; tidak cocok → ditolak. Tidak ada status "menunggu validasi".
- **AC5** Given sudah presensi hari ini, Then 409 `ALREADY_CHECKED_IN`.
- **AC6** Given lokasi palsu (mock) terdeteksi atau akurasi GPS terlalu rendah, Then ditolak dengan panduan.
- **AC7** Given bukan hari sekolah / di luar jendela waktu, Then 422 dengan pesan jelas.
- **AC8** Foto hanya diterima dari **kamera langsung** (kontrol di klien; server memvalidasi format & ukuran).

**US-12 — Popup terlambat** · P0
- **AC1** Given presensi tercatat `terlambat`, Then respons membawa `requires_late_reason = true` dan klien menampilkan dialog dengan pilihan alasan.
- **AC2** Alasan dapat dikirim setelahnya dan tersimpan pada catatan presensi.

**US-13 — Status harian** · P0
- **AC** Beranda menampilkan status hari ini (belum presensi / hadir / terlambat / izin / sakit / alpa), batas waktu, dan status radius.

**US-14 — Alpa otomatis** · P0
- **AC1** Setelah jendela presensi ditutup pada hari sekolah, siswa tanpa catatan dan tanpa izin disetujui → `alpa`.
- **AC2** Siswa dengan izin disetujui menutup hari tersebut → `izin`/`sakit`, **bukan** alpa.
- **AC3** Job idempoten (aman dijalankan ulang) dan tidak berjalan pada hari libur/non-sekolah.

### 4.3 Surat Izin

**US-20 — Ajukan surat izin (Mobile)** · P0
- **AC1** Input: kategori (`sakit` | `keperluan` | `dispensasi`), tanggal dari–sampai, keterangan (wajib), lampiran (**wajib**, PDF/JPG, ≤ 5 MB).
- **AC2** Tanggal sampai ≥ dari; tidak boleh tumpang tindih dengan izin aktif lain; batas maksimum mundur/maju mengikuti konfigurasi.
- **AC3** Status awal `menunggu`; siswa dapat membatalkan selama `menunggu`.
- **AC4** Wali kelas siswa (atau semua guru & admin bila belum ada wali kelas) mendapat notifikasi; siswa menerima notifikasi saat disetujui/ditolak.

**US-21 — Proses surat izin (Web)** · P0
- **AC1** Admin/guru melihat daftar (filter status/kelas/tanggal) dan detail + lampiran.
- **AC2** Setujui → catatan presensi tanggal terkait menjadi `izin`/`sakit`; Tolak → wajib alasan.
- **AC3** Aksi tercatat (siapa, kapan) pada audit log.

### 4.4 Riwayat & Laporan

**US-30 — Riwayat kehadiran (Mobile)** · P0
- **AC** Daftar per bulan berisi tanggal, status, jam masuk, keterangan; ringkasan jumlah per status & persentase.

**US-31 — Laporan PDF bulanan (Mobile)** · P0
- **AC** Siswa mengunduh PDF satu bulan berisi identitas, ringkasan, dan tabel harian; hanya data miliknya.

### 4.5 Dashboard & Rekap (Web)

**US-40 — Dashboard utama** · P0
- **AC1** Menampilkan: Total siswa; Sudah hadir; Terlambat/Izin (dengan sub-rincian); Belum hadir/Alpa.
- **AC2** Kartu kelas 7/8/9 menampilkan hadir/total, persentase, dan catatan (mis. "1 belum hadir"), dengan tautan ke detail.
- **AC3** Menampilkan pengumuman terbaru & penanda tanggal agenda pada mini kalender.
- **AC4** Menampilkan waktu sinkron terakhir; data diperbarui berkala (polling).
- **AC5** Jumlah keempat kartu = total siswa aktif (konsistensi, lihat FSD BR-30).

**US-41 — Rekap kelas** · P0
- **AC1** Kartu ringkasan: jumlah kelas dimonitor, kehadiran rata-rata, total izin/sakit, alpa/pelanggaran.
- **AC2** Tabel per kelas: hadir, izin, telat, alpa, % hadir, status (Normal/Perlu Cek) + tautan detail.
- **AC3** Detail kelas: daftar siswa (nama, NISN, status, waktu, keterangan), kartu hadir/sakit/izin/alpa/terlambat, pencarian nama/NISN.
- **AC4** Rentang tanggal/hari dapat dipilih (default hari ini).

**US-42 — Hasil scan wajah (lihat saja)** · P0
Presensi wajah bersifat **otomatis**: begitu wajah cocok dengan data referensi, siswa langsung tercatat. Halaman ini hanya agar admin/guru dapat **melihat hasil scan**.
- **AC1** Admin/guru melihat daftar scan (filter kelas, tanggal, NISN, hasil) dan detail: foto scan vs foto referensi, skor kecocokan, hasil (cocok/ditolak + alasan), jarak vs radius, waktu, data siswa.
- **AC2** Tampilan **read-only**: tidak ada aksi setujui/tolak dan tidak ada perubahan status kehadiran dari halaman ini.
- **AC3** Foto hanya diakses lewat URL bertanda tangan berumur pendek; akses detail scan tercatat di audit log.

**US-43 — Monitoring radius GPS** · P0
- **AC1** Menampilkan pusat & radius geofence, jumlah siswa terpantau (dalam radius), dan **daftar siswa di luar radius** (nama, kelas, jarak, waktu, koordinat).
- **AC2** Tersedia tautan peta eksternal berdasar koordinat.

**US-44 — Export Excel** · P0
- **AC1** Admin/guru mengekspor rekap (per kelas atau semua, rentang tanggal) ke `.xlsx` dengan sheet per kelas dan baris ringkasan.
- **AC2** Kolom minimal: No, NISN, Nama, Status, Waktu Presensi, Keterangan.

### 4.6 Kalender & Pengumuman

**US-50 — Kalender (Web)** · P0
- **AC1** Kartu: total agenda bulan ini, agenda penting, libur nasional, agenda berlangsung.
- **AC2** Grid bulanan menandai tanggal dengan agenda/libur dan hari ini.

**US-51 — Pengumuman (Web)** · P0
- **AC1** Form: jenis (Akademik/Kegiatan/Libur-Cuti/Penting/Prestasi/Info), judul, tanggal, target (Semua/Siswa/Guru — `guru` mencakup admin), prioritas (Rendah/Normal/Penting/Urgent), deskripsi.
- **AC2** Admin/guru dapat melihat, membuat, mengubah, dan menghapus pengumuman setelah login; permintaan tanpa sesi ditolak (401) dan role selain admin/guru tidak dapat mengubah data (403).
- **AC3** Field wajib yang kosong/tidak valid tidak disimpan; API mengembalikan 400 dengan error per field. Tanggal memakai format `YYYY-MM-DD`; pengumuman dapat disimpan sebagai `draft` atau `published` (aksi terbitkan tanpa status eksplisit membuatnya `published`).
- **AC4** Konfirmasi sebelum terbitkan; setelah terbit, muncul di dashboard, kalender, dan mobile siswa sesuai target.
- **AC5** Pengumuman jenis `libur` menandai hari tersebut **bukan hari sekolah** (tidak ada alpa otomatis).
- **AC6** Target `wali` diterima & disimpan tetapi tidak menghasilkan notifikasi (D-13).

**US-52 — Kalender & pengumuman (Mobile)** · P0
- **AC** Siswa melihat agenda (UTS/UAS/libur/dll.), pengumuman sekolah & kelasnya, detail pengumuman; kalender juga menandai status kehadirannya.

### 4.7 Notifikasi, Profil, Pengaturan

**US-60 — Pusat notifikasi (Mobile)** · P0
- **AC1** Daftar notifikasi (presensi berhasil/lengkap, ditolak/di luar radius, status surat izin, pengumuman) dengan penanda belum dibaca, filter, dan "Baca semua".
- **AC2** Jumlah belum dibaca tersedia untuk badge.

**US-61 — Profil & hubungi wali kelas (Mobile)** · P0
- **AC1** Profil menampilkan NISN, kelas, nomor absen, kontak wali murid; data akademik **tidak dapat diubah** siswa.
- **AC2** Siswa dapat mengubah nomor WA & alamat.
- **AC3** "Hubungi wali kelas" menampilkan nama & kontak wali kelas kelasnya.

**US-62 — Pengaturan akun (Web)** · P0
- **AC1** Ubah nama & email (validasi per-field; email unik).
- **AC2** Ganti/hapus foto profil (JPG/PNG/WebP ≤ 2 MB).
- **AC3** Ganti sandi dengan sandi lama; sandi lain dicabut sesuai kebijakan.
- **AC4** "Log sesi terakhir": daftar sesi (perangkat/browser, waktu, penanda sesi saat ini).

### 4.8 Admin

**US-70 — Akses penuh admin** · P0 *(D-29)*
- **AC1** Admin dapat mengakses **semua endpoint web** yang dapat diakses guru (dashboard, rekap, hasil scan wajah, surat izin, pengumuman/kalender, export, pengaturan).
- **AC2** Admin tidak mengakses fungsi personal siswa (presensi, surat izin sendiri, riwayat sendiri) karena fungsi itu terikat identitas siswa.
- **AC3** Fitur khusus admin (P1, API saja): ubah geofence, ubah jadwal presensi, reset enrollment wajah siswa.
- **AC4** Semua aksi admin/guru yang sensitif tercatat di audit log (siapa, apa, kapan).

---

## 5. Alur Pengguna Utama (Ringkas, dari dokumen UI/UX)

**Siswa:** Register → (Enrollment wajah) → Login → Presensi masuk (GPS+wajah) → [Terlambat → pilih alasan] → Riwayat → Ajukan izin → Lihat status → Kalender/Pengumuman.
**Admin/Guru:** Login → Dashboard → Rekap/Detail kelas → Lihat hasil scan wajah → Monitoring radius → Persetujuan izin → Export Excel → Buat pengumuman → Pengaturan → Logout. *(Presensi siswa tercatat otomatis; tidak ada langkah validasi manual.)*

**Alur alternatif/error yang ditangani:** lupa sandi (siswa); izin sakit; rekap bulanan; sandi salah/akun tidak ditemukan; NISN sudah terdaftar & format email salah; ganti sandi; alasan izin kosong; gagal memuat riwayat/data; gagal verifikasi; gagal export.

---

## 6. Persyaratan Non-Fungsional (Ringkas)

| ID | Persyaratan | Target |
|----|-------------|--------|
| NFR-01 | Waktu respons presensi (termasuk verifikasi wajah) | p95 ≤ 5 dtk (`USULAN`) |
| NFR-02 | Waktu respons endpoint baca umum | p95 ≤ 500 ms (`USULAN`, skala pilot) |
| NFR-03 | Keamanan | HTTPS, hash sandi kuat, rate limit, otorisasi per role (TRD §9) |
| NFR-04 | Privasi | Data biometrik dienkripsi & terbatas; retensi foto dikonfigurasi |
| NFR-05 | Ketersediaan | Best-effort pada jam sekolah; backup harian |
| NFR-06 | Auditabilitas | Aksi sensitif admin/guru tercatat |
| NFR-07 | Bahasa & zona waktu | UI Bahasa Indonesia; WIB |
| NFR-08 | Kompatibilitas | Kontrak API stabil & terdokumentasi (OpenAPI) |

Detail teknis & pengukuran: `04_TRD.md`.

---

## 7. Di Luar Cakupan (Eksplisit)

Role orang tua/wali · registrasi & UI manajemen akun admin/guru (dikelola di database) · WhatsApp/SMS · UI manajemen siswa · mode offline · presensi per mapel · login Google · multi-sekolah · analitik lanjutan · liveness detection (P2) · SSE/WebSocket (P2).

---

## 8. Rencana Rilis

| Rilis | Isi | Prasyarat |
|-------|-----|-----------|
| **R1 (MVP/Pilot)** | Semua `P0` | OQ terjawab; FC-01…FC-09 selesai |
| **R2** | `P1`: push FCM, kelola sesi, API edit geofence/jadwal | Evaluasi pilot |
| **R3** | `P2`: real-time, liveness, dll. | Kebutuhan terbukti |

---

## 9. Metrik Produk (`USULAN`)

| Metrik | Definisi | Sumber data |
|--------|----------|-------------|
| Tingkat adopsi presensi | siswa yang presensi via app ÷ siswa aktif pada hari sekolah | `attendance_records` |
| Rasio attempt ditolak | attempt ditolak ÷ total attempt | `attendance_attempts` |
| Rasio penolakan wajah | attempt `rejected_face` ÷ total attempt | `attendance_attempts` |
| Waktu rata-rata proses izin | `reviewed_at − created_at` | `leave_requests` |
| Keterbacaan notifikasi | notifikasi dibaca ÷ dikirim | `notifications` |

---

## 10. Pertanyaan Terbuka yang Mempengaruhi PRD

Lihat `00_README_HANDOFF.md` §7 (OQ-01…OQ-11). Yang paling berpengaruh: **OQ-02** (sumber data siswa), **OQ-03/04** (lokasi & jam), **OQ-05** (threshold wajah — kini satu ambang tanpa review manual), **OQ-09** (persetujuan biometrik), **OQ-10** (penanganan siswa yang gagal verifikasi padahal sah), **OQ-11** (cakupan hak admin).
