# 05 — Design System M-Class

> **Versi:** 1.2 · **Tanggal:** 12 November 2026
> **Revisi v1.1:** halaman validasi wajah menjadi **hasil scan (read-only)**; halaman register & lupa sandi web tidak dipakai (akun admin/guru dikelola di database); label role `admin` ditambahkan.
> **Revisi v1.2:** diselaraskan dengan PRD v1.3, FSD v1.4, dan TRD v1.4 (termasuk dukungan Login Google OAuth khusus siswa di mobile dan dukungan status pengumuman `draft`/`published`).
> **Sumber:** diekstrak dari kode FE yang sudah di-slicing — Web (`frontend-mclass`: Tailwind v4, `src/index.css`, komponen `.jsx`) dan Mobile (`mobile_m-class_fe`: `lib/utils/colors.dart`, widget). **Bukan desain baru**; nilai yang tidak ditemukan di kode ditandai `ASUMSI`/`TBD`.
> **Fungsi untuk proyek backend:** (1) acuan token agar FE web & mobile konsisten, (2) **kontrak semantik** antara API dan UI (status, label, format), sehingga backend tidak mengirim nilai yang memaksa FE menebak.
> Nilai heksadesimal Tailwind adalah nilai palet standar Tailwind (v3); Tailwind v4 memakai ruang warna berbeda sehingga selisih visual sangat kecil.

---

## 1. Prinsip Desain

| Prinsip | Wujud di FE yang ada |
|---------|----------------------|
| **Tenang & terpercaya** | Palet hijau-emerald, latar putih/abu muda, kartu bersudut membulat |
| **Status terbaca sekilas** | Badge berwarna per status kehadiran + ikon |
| **Ramah siswa SMP/MTs** | Teks Bahasa Indonesia, pesan error yang menjelaskan cara memperbaiki |
| **Konsisten lintas platform** | Font sama (Plus Jakarta Sans), keluarga warna hijau yang sama |
| **Aksesibel dasar** | Kontras teks gelap di atas latar terang; status tidak hanya mengandalkan warna (ada teks/ikon) |

---

## 2. Token — Warna

### 2.1 Warna merek (Web = Tailwind emerald; Mobile = `AppColors`)

| Peran | Web (Tailwind) | Hex | Mobile (`AppColors`) | Hex |
|-------|----------------|-----|----------------------|-----|
| Primary (aksi utama, tautan) | `emerald-700` (paling sering dipakai) | `#047857` | `primary` | `#0B6E4F` |
| Primary hover/tekan | `emerald-800` | `#065F46` | `primaryDark` | `#084A35` |
| Primary kuat (ikon/aksen) | `emerald-600` / `emerald-500` | `#059669` / `#10B981` | `buttonGradientStart` | `#0F8A62` |
| Primary lembut (latar badge) | `emerald-100` / `emerald-50` | `#D1FAE5` / `#ECFDF5` | `primarySoft` / `badgeBg` | `#D4F1E0` |
| Teks sekunder merek | — | — | `primaryLight` / `textSecondary` | `#4A6B60` |

> **Temuan konsistensi:** primary web (`#047857`) dan mobile (`#0B6E4F`) berbeda sedikit. Rekomendasi: **sepakati satu** (usulan: pakai `#0B6E4F` sebagai primary merek untuk kedua platform, atau petakan web ke token yang sama). Tidak berdampak pada backend.

### 2.2 Netral

| Peran | Web | Hex | Mobile | Hex |
|-------|-----|-----|--------|-----|
| Teks utama | `gray-900` | `#111827` | `textPrimary` | `#0A2E24` |
| Teks sekunder | `gray-500` | `#6B7280` | `textSecondary` | `#4A6B60` |
| Placeholder/hint | `gray-400` | `#9CA3AF` | `textHint` | `#9AA8A3` |
| Border | `gray-200` | `#E5E7EB` | `inputBorder` | `#E0E7E4` |
| Latar halaman | `gray-50` | `#F9FAFB` | `gradientTop → gradientBottom` | `#F1F8F4 → #C9E5D3` |
| Latar kartu | `white` | `#FFFFFF` | `cardWhite` / `cardBg` | `#FFFFFF` / `#F5F9F6` |
| Latar input | `white` / `gray-50` | — | `inputFill` | `#F5F7F6` |

### 2.3 Warna status kehadiran (**semantik utama**)

| Status API | Label UI | Web (badge) | Mobile (`AppColors`) |
|-----------|----------|-------------|----------------------|
| `hadir` | **Hadir** | `bg-emerald-100 text-emerald-700` | `hadir` `#2F9E5F` · bg `hadirBg` `#E3F3E9` |
| `terlambat` | **Terlambat** | `bg-orange-100 text-orange-700` | *(belum ada token khusus; pakai warna peringatan `izin` `#E8A93C` / bg `izinBg` `#FFF3DD` — `ASUMSI`)* |
| `izin` | **Izin** | `bg-blue-100 text-blue-700` | `izin` `#E8A93C` · bg `izinBg` `#FFF3DD` |
| `sakit` | **Sakit** | `bg-amber-100 text-amber-700` | `sakit` `#E8A93C` · bg `sakitBg` `#FFE8CC` |
| `alpa` | **Alpa** | merah (`red-100/red-700`, `ASUMSI` — baris style Alfa tidak terbaca otomatis) | `alpa` `#E53935` |
| *(virtual)* `belum_hadir` | **Belum hadir** | abu (`gray-100/gray-600`, `ASUMSI`) | abu netral (`ASUMSI`) |
| *(kalender)* `libur` | **Libur** | merah | `libur` `#E53935` · bg `liburBg` `#FFDDDD` |
| *(kalender)* `agenda` | **Agenda** | hijau | bg `agendaBg` `#E3F3E9` |

> **Temuan inkonsistensi (perlu keputusan desain, bukan backend):**
> 1. Mobile memakai warna yang **sama** untuk `izin` dan `sakit` (`#E8A93C`); web membedakan (biru vs amber). Rekomendasi: ikuti web (biru = izin, amber = sakit).
> 2. `terlambat` belum punya token di mobile.
> 3. Ejaan: UI web campur "Alfa"/"Alpa". **Label baku usulan: "Alpa"** (selaras istilah di brief & API `alpa`).

### 2.4 Warna fungsional

| Peran | Web | Mobile |
|-------|-----|--------|
| Sukses | `emerald-600` | `success` `#0B6E4F` |
| Peringatan | `amber-500` / `amber-50` | `izin` `#E8A93C` |
| Error/bahaya | `red-600` / `red-50` / `red-500` (banner & border input) | `error` `#D32F2F` |
| Info | `blue-*` | — |
| Kartu stat bahaya | `border-red-200 bg-red-50` (`variant="danger"`) | — |

---

## 3. Token — Tipografi

| Item | Nilai |
|------|-------|
| Keluarga font (web & mobile) | **Plus Jakarta Sans** (web: `@fontsource/plus-jakarta-sans`; mobile: `google_fonts`) |
| Bobot dimuat (web) | 400, 500, 600, 700, 800 |
| Fallback web | `ui-sans-serif, system-ui, sans-serif` |

### 3.1 Skala (hasil frekuensi pemakaian di kode)

| Peran | Web (Tailwind) | Mobile (contoh yang ditemukan) |
|-------|----------------|-------------------------------|
| Caption/label kecil | `text-xs` (paling sering, 131×), `text-[10px]` untuk badge | 11–12 sp, w500–w800 |
| Body | `text-sm` | 13 sp, w600 |
| Body besar / subjudul | `text-base`, `text-lg` | — |
| Judul halaman/kartu | `text-xl`, `text-2xl` bold | 18 sp, w800 |
| Angka statistik besar | `text-3xl font-extrabold` | — |

Aturan penggunaan: judul `font-bold`/`w800`; label field `font-bold` (web) dan tanda wajib `*` merah; teks bantu `text-xs text-gray-500`.

---

## 4. Token — Bentuk, Jarak, Elevasi

| Token | Nilai (frekuensi di web) | Penggunaan |
|-------|--------------------------|-----------|
| Radius `lg` | `rounded-lg` (97×) | Input, tombol, kartu kecil |
| Radius `full` | `rounded-full` (84×) | Badge/pill, avatar |
| Radius `xl` | `rounded-xl` (43×) | Kartu & panel |
| Radius `2xl` | `rounded-2xl` (10×) | Kartu auth besar, modal |
| Radius `md` | `rounded-md` (32×) | Elemen kecil |
| Elevasi | `shadow-sm` (15×) kartu; `shadow-md` (32×) hover/modal | |
| Border kartu | `border border-gray-200` | |
| Padding kartu auth | `p-8`, lebar `max-w-lg` | |
| Mobile | `BorderRadius.circular(...)` bervariasi; `blurRadius` 10–20 untuk bayangan kartu | |
| Grid & jarak | Skala Tailwind 4 px (`gap-1.5`, `gap-2`, `p-4`, `mt-6`, `space-y-5`) | |

---

## 5. Gerak (Motion — Web)

Didefinisikan di `src/index.css`:

| Nama | Fungsi |
|------|--------|
| `animate-card`, `fade-slide-up` | Kemunculan kartu auth |
| `animate-item` (+ `delay-*`) | Kemunculan bertahap isi form |
| `animate-slide-in` | Toast/panel masuk |
| `animate-pulse-bg` (`pulse-slow`) | Ornamen latar blur emerald di halaman auth |
| `fade-in-backdrop`, `scale-up-modal` | Latar & kotak modal |

Pedoman: animasi singkat (≤ ~300–500 ms), tidak menghalangi aksi; hormati preferensi *reduced motion* (`ASUMSI`, belum terlihat di kode).

---

## 6. Komponen

### 6.1 Web (komponen yang ada di `src/components`)

| Komponen | Pola | Catatan data dari API |
|----------|------|----------------------|
| `Header` / `Footer` | Bingkai halaman auth | Nama sekolah dari `GET /school/config` (hindari hardcode — lihat temuan F-13) |
| `Sidebar` (Dashboard Utama, Rekap Kelas, Kalender & Agenda, Pengaturan) + `Topbar` | Navigasi utama admin/guru | Item aktif ditentukan oleh prefix rute |
| `StatCard` | Angka besar + label + subteks; varian `default/success/warning/danger` | Lihat §7 pemetaan |
| `ClassCard` | Kartu kelas: hadir/total, % dan tautan detail | `dashboard/summary.classes[]` |
| `CalendarWidget` | Mini kalender + penanda agenda | `calendar_marks[]` |
| `AnnouncementList` | Daftar pengumuman | `announcements[]` |
| `Toast` | Umpan balik sukses/gagal (judul + pesan) | Pesan dari `message` API |
| Modal: `ModalGantiFoto`, `ModalHapusFoto`, `ModalTerbitkan`, `LogoutModal` | Konfirmasi aksi | `ModalSetujuiValidasi` & `ModalTolakValidasi` **tidak dipakai lagi** (presensi wajah otomatis, D-28) |
| Form auth: `LoginForm` (web, admin/guru) | Input berlabel, ikon, toggle tampilkan sandi | Error per-field dari `errors`. `RegistrationForm` & `ForgotPasswordForm` **tidak dipakai di web** (D-04); pola stepper/OTP tetap relevan untuk mobile siswa |
| Tabel rekap | Header abu, baris `hover`, badge status | `recap/classes` |

### 6.2 Mobile (widget di `lib/widgets`)

| Widget | Pola |
|--------|------|
| `PrimaryButton` | Tombol gradien (`buttonGradientStart → End`) |
| `CustomTextField`, `LabelRequired` | Input berlabel, tanda wajib |
| `AppHeader` | Judul "M-Class" + subjudul layar |
| `SectionCard` | Kartu konten |
| `FloatingBottomNav` | Navigasi bawah (Dashboard, Riwayat, Kalender, Notifikasi, Profil — `ASUMSI` dari layar yang ada) |
| `AppSnackbar` | Umpan balik |
| `LogoutDialog`, `AttendanceReminderDialog` | Konfirmasi keluar; dialog "Tercatat Terlambat" (peringatan disiplin + pilihan alasan) |
| `BlurBackground` | Ornamen latar hijau |

---

## 7. Kontrak Semantik API ↔ UI

> Bagian ini yang paling relevan untuk backend: nilai enum **dari API** dan **label tampilan** yang disepakati.

### 7.1 Status kehadiran

| Nilai API | Label | Ikon (usulan) |
|-----------|-------|---------------|
| `hadir` | Hadir (ket. "Tepat Waktu") | centang |
| `terlambat` | Terlambat | jam |
| `izin` | Izin | dokumen |
| `sakit` | Sakit | termometer |
| `alpa` | Alpa (ket. "Tanpa Keterangan") | segitiga peringatan |
| `belum_hadir` | Belum Hadir | titik abu |
| `belum_presensi` *(status harian siswa)* | Belum Presensi | — |

### 7.2 Hasil scan wajah (`face_result`) — tampilan baca-saja

| Nilai API | Label | Catatan |
|-----------|-------|---------|
| `match` | Cocok | Presensi langsung tercatat |
| `no_match` | Tidak cocok | Siswa dapat mengulang |
| `no_face` | Wajah tidak terdeteksi | |
| `multiple_faces` | Lebih dari satu wajah | |
| `low_quality` | Foto kurang jelas | |
| `error` | Gagal diproses | Layanan AI bermasalah |

Tidak ada status "menunggu validasi/disetujui/ditolak guru" (D-28).

### 7.3 Surat izin

| Nilai API | Label |
|-----------|-------|
| `menunggu` | Menunggu |
| `disetujui` | Disetujui |
| `ditolak` | Ditolak |
| `dibatalkan` | Dibatalkan |

Kategori: `sakit` → "Sakit", `keperluan` → "Keperluan", `dispensasi` → "Dispensasi".

### 7.4 Pengumuman

| `type` (alias `category`) | Label | | `priority` | Label |
|--------|-------|-|-----------|-------|
| `akademik` (`academic`) | Akademik | | `rendah` (`low`) | Rendah |
| `kegiatan` (`activity`) | Kegiatan | | `normal` | Normal |
| `libur` (`holiday`) | Libur / Cuti | | `penting` (`important`) | Penting |
| `penting` (`important`) | Penting | | `urgent` | Urgent |
| `prestasi` (`achievement`) | Prestasi | | | |
| `info` | Info | | | |

Audiens: `semua` (`all`) → Semua, `siswa` → Siswa, `guru` → Guru, `wali` → Wali Murid (tidak aktif di v1).
Status publikasi: `published` → Diterbitkan, `draft` → Draft.

### 7.5 Alasan terlambat

| Nilai API | Label |
|-----------|-------|
| `macet` | Macet Lalu Lintas |
| `kendala_kendaraan` | Kendala Kendaraan |
| `keperluan_keluarga` | Keperluan Keluarga |
| `lainnya` | Lainnya (+ catatan) |

### 7.6 Pemetaan kartu statistik dashboard

| Kartu web | Sumber API | Varian |
|-----------|-----------|--------|
| TOTAL SISWA | `totals.total_students` | `default` |
| SUDAH HADIR | `totals.sudah_hadir` | `success` |
| TERLAMBAT / IZIN | `totals.terlambat_izin.total` + subteks "N Izin, N Telat" | `warning` |
| BELUM HADIR / ALPA | `totals.belum_hadir_alpa.total` | `danger` |

Status kelas: `Normal` (hijau) / `Perlu Cek` (amber) — dari `recap/classes[].status`.

### 7.7 Role

| Nilai API | Label |
|-----------|-------|
| `admin` | Admin |
| `guru` | Guru |
| `siswa` | Siswa |

---

## 8. Konten & Pesan (Content Design)

### 8.1 Nada
Bahasa Indonesia, sopan, ringkas, menjelaskan **apa yang terjadi** dan **apa yang bisa dilakukan**.

### 8.2 Pesan error yang sudah ada di FE (dipertahankan)

| Situasi | Teks |
|---------|------|
| Login gagal (401) | "Login gagal! Email atau kata sandi salah." + "Periksa kembali email dan kata sandi Anda." |
| Akses ditolak (403) | "Akses ditolak." + pesan dari server |
| Koneksi gagal | "Tidak dapat terhubung ke server." |
| Umum | "Terjadi kesalahan." |
| Sandi < 8 | "Kata sandi minimal 8 karakter." |
| OTP | "Kode OTP harus 6 digit." |
| NISN | "NISN harus 10 digit" |
| Konfirmasi sandi | "Password tidak cocok" |
| Google OAuth butuh NISN (422) | "Akun Google belum terhubung ke data siswa. Silakan masukkan 10 digit NISN Anda." |

### 8.3 Pedoman pesan dari backend
- `message` **siap tampil** (tanpa istilah teknis/kode).
- Penolakan presensi menyebut penyebab + tindakan: mis. "Anda berada 72 m dari sekolah (batas 50 m). Mendekatlah ke area sekolah lalu coba lagi."
- Jangan membocorkan keberadaan akun (login/OTP).
- Pesan sukses presensi: "Absensi Masuk Berhasil!" (selaras notifikasi mobile).

---

## 9. Format Data Tampilan

| Data | Format tampilan | Format API |
|------|-----------------|-----------|
| Tanggal | `Jumat, 14 Mar 2026` / `12 Mei 2013` (id-ID) | `YYYY-MM-DD` |
| Jam | `07.15 WIB` (mobile memakai titik) / `06:45 WIB` (web) | `HH:mm` (WIB) / instant UTC ISO |
| Bulan | `Oktober 2026` | `YYYY-MM` |
| Persentase | `90%` (tanpa desimal) | integer 0–100 |
| Jarak | `72 m` | angka (meter) |
| Kecocokan wajah | `Match 99.4%` | `similarity` 0–1 (klien × 100, 1 desimal) |
| NISN | 10 digit, tanpa spasi | string 10 digit |
| Kelas | `Kelas 7` | `class.name` (string siap tampil) |
| Gender | L / P | `L` \| `P` |

> Titik vs titik dua pada jam (mobile vs web) adalah preferensi tampilan klien; backend selalu mengirim `HH:mm`.

---

## 10. Pola Interaksi Penting

| Pola | Spesifikasi |
|------|-------------|
| Form auth | Validasi di klien lebih dulu; error server per-field tampil di bawah input & border merah |
| Login Google OAuth (mobile) | Siswa memilih akun Google → kirim `id_token` ke `/api/auth/oauth/google`; bila 422 `OAUTH_NISN_REQUIRED`, tampilkan dialog/sheet input 10 digit NISN untuk klaim roster |
| Konfirmasi aksi sensitif | Modal konfirmasi: terbitkan pengumuman, setujui/tolak surat izin, hapus foto, logout |
| Hasil scan wajah | Tampilan **baca-saja**: foto scan vs foto referensi, skor, jarak vs radius, hasil; tanpa tombol setujui/tolak |
| Loading | Tombol menampilkan "Memproses..." dan nonaktif |
| Toast | Judul + pesan; hilang otomatis; tipe `success`/`error` |
| Indikator data segar | Dashboard menampilkan waktu sinkron terakhir ("07.30 WIB") — dari `generated_at` |
| Status server | Lencana "Server Presensi Terhubung" di halaman login — dari `GET /api/health` (opsional) |
| Popup terlambat (mobile) | Dialog "Tercatat Terlambat!" dengan waktu presensi, batas toleransi, dan pilihan alasan → kirim `late-reason` |
| Radius (mobile) | Peta dengan lingkaran radius dari `school/config`; lencana "Di Dalam Radius Presensi" dihitung klien dari posisi |
| Kamera | Hanya kamera langsung untuk presensi/enrollment (bukan galeri) |
| Upload | Avatar JPG/PNG/WebP ≤ 2 MB; lampiran izin PDF/JPG ≤ 5 MB; tampilkan batas di UI |

---

## 11. Aksesibilitas & Kualitas (Pedoman)

| Area | Pedoman | Status |
|------|---------|--------|
| Kontras | Teks ≥ 4.5:1 pada latar (teks `gray-500` di atas putih cukup untuk ukuran normal; hindari `gray-400` untuk teks penting) | `ASUMSI` perlu audit |
| Status | Selalu teks + warna (+ ikon) | Sudah umumnya demikian |
| Target sentuh mobile | ≥ 44×44 dp untuk tombol utama | `ASUMSI` perlu audit |
| Label form | Setiap input punya label terhubung | Ada label; `htmlFor` belum konsisten (perlu audit) |
| Fokus keyboard (web) | Cincin fokus emerald (`focus:ring-emerald-500`) sudah dipakai | ✅ |
| Gerak | Dukung `prefers-reduced-motion` | Belum terlihat — usulan |
| Bahasa | `lang="id"` pada dokumen web | `ASUMSI` perlu cek `index.html` |

---

## 12. Rekomendasi Perapihan (Tanpa Mengubah Backend)

| ID | Rekomendasi | Prioritas |
|----|-------------|-----------|
| DS-01 | Satukan primary web & mobile (`#047857` vs `#0B6E4F`) | Sedang |
| DS-02 | Bedakan warna `izin` vs `sakit` di mobile dan tambah token `terlambat` | Sedang |
| DS-03 | Baku label **"Alpa"** di seluruh UI & ekspor Excel | Rendah |
| DS-04 | Ekstrak token ke satu berkas (web: `@theme` Tailwind v4; mobile: `AppColors` + `ThemeData`) | Sedang |
| DS-05 | Ganti nama sekolah hardcode dengan data `school/config` | Tinggi (F-13) |
| DS-06 | Audit aksesibilitas dasar (kontras, target sentuh, label) | Sedang |
| DS-07 | Hapus ketergantungan `ui-avatars.com` (layanan eksternal) pada halaman hasil scan wajah; gunakan foto dari API / inisial lokal | Tinggi (privasi) |
| DS-08 | Ubah halaman `/validasi-wajah/:nis` menjadi read-only (hapus tombol & modal setujui/tolak); hapus halaman `/register` dan `/forgot-password` dari web | Tinggi (FC-02, FC-06) |

---

## 13. Referensi Silang

- Enum & payload yang dirujuk di §7 → `03_FSD.md` §4 & §5
- Perubahan FE yang dibutuhkan → `00_README_HANDOFF.md` §8
- Fitur & layar → `02_PRD.md` §3–4
- Keamanan & arsitektur → `04_TRD.md` §9
