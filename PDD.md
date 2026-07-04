# TrustFund — Dokumen Konsep & Landasan

> **Tim:** NexTrust · **ID Peserta:** S0261 · **Ajang:** Digdaya x Hackathon BI 2026
> **Sifat dokumen:** Landasan konseptual terkonsolidasi. Menjadi sumber kebenaran (*single source of truth*) untuk penulisan proposal, pembuatan video, dan pengembangan teknis. Dapat dijadikan *knowledge base* di percakapan lain.
> **Status revisi:** Konsep inti final (aktor, jenis donasi, milestone, validasi 3 tahap, hak donatur, privasi bukti).

---

## 0. Ringkasan Satu Paragraf

TrustFund adalah platform *crowdfunding* untuk **donasi sosial berbasis output fisik** (pembangunan, pengadaan, rekonstruksi) yang menyelesaikan krisis kepercayaan filantropi Indonesia. Dana donatur dikunci dalam **escrow smart contract (Polygon)** dan hanya cair **bertahap per milestone** setelah bukti penggunaan dana divalidasi. Platform menyembunyikan kompleksitas Web3 dari pengguna (donatur cukup bayar QRIS), memposisikan diri sebagai **lapisan pengawasan penyaluran di atas izin PUB yang sudah sah**, dengan **Dinas Sosial** sebagai validator resmi. Prinsip inti: *pada setiap titik, dana yang belum tersalurkan selalu cukup besar untuk menghilangkan insentif penyalahgunaan.*

---

## 1. Model Tiga Aktor & Dasar Hukum

### 1.1 Aktor dan Peran

| Aktor | Kanal | Peran | Constraint tegas |
|---|---|---|---|
| **Yayasan / Lembaga Filantropi** (badan hukum Kemenkumham + izin PUB aktif) | **Website** | Penyelenggara kampanye; menyusun RAB & milestone; unggah bukti | Hanya lembaga berbadan hukum & berizin PUB. Menerima dana bertahap via escrow. |
| **Dinas Sosial** (berjenjang sesuai wilayah) | **Website** | Validator legitimasi lapangan & pengawas penyaluran per-milestone | **Tidak menerbitkan izin lewat platform. TIDAK PERNAH menerima aliran dana.** Hanya memberi sinyal validasi. |
| **Masyarakat Umum (Donatur)** | **Mobile app (Flutter)** | Berdonasi, memantau, mengaudit, melapor | Dana hanya mengalir ke yayasan. Tidak memutuskan operasional kampanye. |

### 1.2 Dasar Hukum Validator (UU No. 9/1961 tentang PUB)

Berdasarkan **Pasal 4 UU No. 9/1961**, dikuatkan **PP No. 29/1980** dan **Permensos No. 8/2021 jo. No. 8/2024**, pejabat berwenang atas izin & pengawasan Pengumpulan Uang atau Barang (PUB) ditentukan **berjenjang berdasarkan cakupan wilayah**:

- **Menteri Sosial** — bila penggalangan mencakup seluruh wilayah negara / lintas provinsi / luar negeri.
- **Gubernur** — bila mencakup lintas kabupaten/kota dalam satu provinsi.
- **Bupati/Walikota** — bila dalam satu kabupaten/kota. **Kewenangan operasional didelegasikan ke Dinas Sosial.**

**Koreksi penting dari konsep awal:** Validator yang benar secara hukum adalah **Dinas Sosial**, BUKAN Pemerintah Desa/Kelurahan (yang tidak punya kewenangan menerbitkan atau mengawasi izin PUB).

### 1.3 Posisi TrustFund terhadap Izin PUB

TrustFund adalah **lapisan pengawasan penyaluran**, **BUKAN** penerbit/pengganti izin PUB.

- **Di hulu (izin):** tetap urusan Dinas Sosial lewat jalur resmi. TrustFund hanya **memverifikasi keberadaan** izin saat onboarding.
- **Di hilir (penyaluran & pertanggungjawaban):** di sinilah TrustFund bekerja, mengisi celah yang UU wajibkan tapi selama ini manual & sulit diverifikasi. Sistem PUB saat ini: izin diberikan di depan, lalu **buta** terhadap penggunaan dana sampai laporan akhir manual masuk. Itulah *blind spot* yang TrustFund tutup.

### 1.4 Boilerplate Anti-Salah-Paham (WAJIB di proposal)

> **Batas peran pemerintah:** *"TrustFund tidak menerbitkan atau menggantikan izin Pengumpulan Uang atau Barang (PUB). Sesuai UU No. 9/1961, kewenangan izin tetap berada pada Dinas Sosial. TrustFund memverifikasi keabsahan izin yang telah dimiliki yayasan dan menyediakan lapisan pengawasan penyaluran dana secara berkelanjutan."*

> **Batas aliran dana (anti-salah-paham APBD):** *"Platform ini menyalurkan dana sosial masyarakat (filantropi) ke yayasan penyelenggara, bukan kanal pembiayaan proyek pemerintah. Dinas Sosial berperan eksklusif sebagai validator dan tidak pernah menerima aliran dana. Pembangunan yang menjadi kewajiban pemerintah tetap dibiayai melalui APBD dan berada di luar cakupan solusi ini."*

---

## 2. Jenis Donasi (Enum Tertutup — 4 Kategori)

Jenis kampanye bersifat **enum tertutup**: tidak dapat ditambah/dikurangi manual oleh yayasan. Setiap jenis memetakan pola milestone & jenis bukti yang spesifik. Hanya donasi **berbasis output fisik** yang diterima.

| # | Jenis | Output | Pola Milestone | Bukti Utama |
|---|---|---|---|---|
| 1 | **Pembangunan & Renovasi Fasilitas Sosial** | Bangunan | Per tahap konstruksi (fondasi → struktur → finishing) | Nota material + foto progres geotag |
| 2 | **Pengadaan Barang & Peralatan** | Barang | Per batch pembelian / serah-terima | Invoice + foto barang + bukti serah-terima |
| 3 | **Pengadaan Alat Bantu Disabilitas & Kesehatan** | Alat (barang) | Per unit/batch | Invoice + foto alat + bukti serah-terima |
| 4 | **Rekonstruksi Pasca-Bencana** | Bangunan/infrastruktur | Per tahap pemulihan | Nota + foto before/after geotag |

### 2.1 Yang Sengaja DIKELUARKAN (dan alasannya)

| Dikeluarkan | Alasan |
|---|---|
| **Beasiswa & Pelatihan** | Bukan output fisik; bukti (jasa/transfer ke orang) lemah & mudah dipalsukan; menyeret data pribadi (UU PDP). |
| **Donasi medis individu** | Bukti = rekam medis → data sensitif kesehatan. Ranah Kitabisa. |
| **Bantuan tunai / santunan langsung** | Uang *adalah* output-nya; tidak ada bukti pengeluaran untuk divalidasi. |
| **Donasi darurat bencana real-time** | UU justru mengecualikan dari izin; kecepatan > validasi bertahap. |
| **Dana operasional yayasan** | Tanpa RAB & milestone; tidak ada yang bisa divalidasi. |
| **Zakat & Wakaf** | Rezim hukum & lembaga sendiri (BAZNAS/BWI, UU Zakat 23/2011); di luar PUB. |

**Framing untuk proposal:** penyempitan ini adalah **fokus strategis MVP + roadmap ekspansi**, bukan keterbatasan. Kata kunci: *"sengaja tidak dimasukkan pada tahap ini"*.

---

## 3. Konsep Milestone (Jantung TrustFund)

### 3.1 Prinsip: "Dana Selalu Tertinggal"

Konsep anti-bawa-kabur hanya bekerja jika **di setiap titik, uang yang belum cair selalu lebih besar dari insentif untuk kabur.** Semua aturan milestone melayani satu tujuan ini.

### 3.2 Persenan: Pola Retensi Progresif (BUKAN rata)

Mengadopsi prinsip **retensi industri konstruksi**: kecil di depan, mengunci di belakang.

| Tahap | Porsi | Syarat cair | Logika |
|---|---|---|---|
| **DP / Modal Awal** | **10–15%** | RAB tervalidasi + ACC Dinsos | Cukup untuk memulai, terlalu kecil untuk jadi target penipuan |
| **Milestone tengah** | Sedang, progresif | Bukti tahap sebelumnya tervalidasi | Tiap pencairan mensyaratkan bukti tahap lalu → tak bisa lompat |
| **Milestone final** | **20–25% (ditahan terbesar)** | Bukti penyelesaian + serah-terima | "Retainer" — insentif terkuat untuk menyelesaikan, bukan kabur di 90% |

**Prinsip kunci: porsi yang ditahan di akhir harus yang TERBESAR** (kebalikan intuisi umum).

### 3.3 Jumlah Milestone: Rentang Dibatasi Sistem

Minimal **2**, maksimal **~6**, menyesuaikan jenis proyek:

| Jenis | Rentang wajar |
|---|---|
| Pengadaan barang | 2–3 (pesan → terima → serah-terima) |
| Pembangunan/renovasi | 3–5 (per tahap konstruksi) |

- Terlalu banyak (>6): tiap porsi kecil, beban validasi tinggi, "sandera" per tahap remeh.
- Terlalu sedikit (1): sama saja pencairan 100% sekaligus — model yang justru dilawan.

### 3.4 Siapa yang Menentukan: AI Menyusun, Yayasan Finalisasi (dalam pagar)

**Yayasan TIDAK menentukan struktur milestone secara bebas.** Struktur yang bisa diatur bebas oleh pihak yang diawasi = pengawasan yang dilucuti.

Alur **AI Planner → finalisasi berjenjang**:

```
STEP 1  Yayasan isi form RAB terstruktur (item, qty, harga satuan per baris)
              ↓
STEP 2  Yayasan isi konteks proyek (jenis, deskripsi, lokasi, durasi)
              ↓
STEP 3  AI PLANNER menyusun DRAF struktur milestone:
        jumlah tahap · alokasi dana (retensi progresif) · definition-of-done
        · jenis bukti per tahap · + ALASAN tiap keputusan (transparansi)
              ↓
STEP 4  Yayasan REVIEW & EDIT — dalam pagar sistem
        (DP ≤15%, retensi akhir terbesar, tak ada milestone >40%, 2–6 tahap)
        Edit menabrak pagar → warning + AI jelaskan alasannya
              ↓
STEP 5  AI cek kewajaran final → Dinsos ACC → LOCK ke smart contract (immutable)
```

**Immutability blockchain bermakna di sini:** begitu struktur di-*lock*, yayasan tidak bisa diam-diam mengubah porsi setelah dana masuk. *Inilah* alasan blockchain relevan — bukan sekadar "transparan".

**Kalimat kunci (hafalkan untuk pitch):** *"Fleksibilitas diberikan pada bentuk, bukan pada batas yang menjaga keamanan dana."*

---

## 4. Tiga Peran AI (Nama & Fungsi Berbeda — Jangan Dicampur)

| Peran AI | Sifat | Fungsi | Titik |
|---|---|---|---|
| **AI Planner** | Generatif (asistensi) | Menyusun draf struktur milestone dari RAB + konteks | Saat buat kampanye |
| **AI Validator RAB** | Deteksi anomali | Cek kewajaran harga item vs benchmark pasar | Sebelum kampanye tayang |
| **AI Validator Bukti** | Forensik + matching | Cek keaslian & kecocokan nota/foto dengan RAB | Tiap klaim milestone |

**Pemisahan penting:** AI Planner *menerima* RAB apa adanya & menyusun struktur; AI Validator RAB *menghakimi* kewajaran harga. Jangan digabung, atau tidak jelas di titik mana fraud harga tertangkap.

### 4.1 Pilihan Teknologi (waktu implementasi terbatas → hindari model custom di jalur kritis)

| Komponen | Pilihan | Alasan |
|---|---|---|
| AI Planner | **LLM (API)** | Tugas reasoning + generatif; zero-training |
| AI Validator RAB | **LLM (API) + rule/statistik** | Pemahaman konteks harga; rule sebagai pagar |
| OCR nota | **Pre-trained (PaddleOCR)** | OCR *solved problem*; latih dari nol = buang waktu |
| Matching nota↔RAB | **LLM (API)** | Reasoning, bukan klasifikasi |
| Forensik gambar | **ELA (OpenCV) + EXIF/metadata + human review** | Deterministik, ringan, tanpa training |

**Keputusan sadar:** deteksi manipulasi gambar berbasis *deep learning custom* (mis. EfficientNet-B4) **DITURUNKAN ke roadmap**, bukan MVP. Melatih model forensik andal dalam waktu hackathon dengan tim 2 orang berisiko gagal. Human-in-the-loop (Dinsos) membuat akurasi model sempurna **tidak diperlukan** untuk MVP.

> **Catatan konsistensi:** Proposal ke-1 mengklaim melatih EfficientNet-B4 + 3 dataset. **Revisi klaim ini** — guideline melarang melebih-lebihkan kesiapan. MVP = OCR pre-trained + ELA + EXIF + LLM; deep-learning forensik = roadmap.

---

## 5. Validasi Tiga Tahap

```
TAHAP 1: ONBOARDING       →  validasi KELAYAKAN LEMBAGA (dokumen legal ada & sah)
TAHAP 2: BUAT KAMPANYE     →  validasi KEWAJARAN RENCANA (RAB & struktur milestone masuk akal)
TAHAP 3: KLAIM MILESTONE   →  validasi KESESUAIAN REALISASI (bukti cocok rencana terkunci)
   (berulang tiap tahap)
```

**Logika besar:** Tahap 2 memvalidasi *janji*, Tahap 3 memvalidasi apakah *janji ditepati*. Tanpa Tahap 2 yang mengunci rencana, Tahap 3 tak punya patokan pembanding.

### 5.1 Tahap 1 — Onboarding (sekali)

Yang divalidasi: kelayakan lembaga.
- Keabsahan **SK badan hukum Kemenkumham** (nomor SK terverifikasi)
- Keberadaan & masa berlaku **izin PUB Dinsos** (aktif)
- Kecocokan identitas: SK = izin PUB = pendaftar
- *Verifikasi keberadaan dokumen*, bukan forensik berat. Keputusan akhir di Dinsos.

### 5.2 Tahap 2 — Pembuatan Kampanye (sebelum tayang)

Yang divalidasi: kewajaran **rencana**.

| Objek | Yang dicek |
|---|---|
| Item RAB | Kewajaran harga vs benchmark pasar (deteksi mark-up) |
| Kelengkapan RAB | Item masuk akal untuk tujuan? Ada yang ganjil? |
| Struktur milestone | Porsi patuh aturan (DP ≤15%, retensi terbesar di akhir, dst.) |
| Pemetaan item→milestone | Item dikelompokkan logis? |
| Kesesuaian jenis | Proyek cocok dengan jenis enum yang dipilih? |
| Legitimasi lapangan | Dinsos ACC: yayasan & proyek nyata ada |

### 5.3 Tahap 3 — Klaim Milestone (berulang)

Yang divalidasi: kesesuaian **realisasi** dengan rencana terkunci. RAB milestone = "kunci jawaban", bukti upload = "jawaban ujian".

**Empat lapis validasi:**

| Lapis | Yang divalidasi | Pertanyaan |
|---|---|---|
| 1. Keaslian bukti | Nota & foto asli, bukan editan | "Apakah dimanipulasi?" |
| 2. Kesegaran & lokasi | Foto diambil di lokasi & waktu benar | "Apakah baru & di tempat tepat?" |
| 3. Kecocokan isi (matching) | Isi nota = item RAB milestone ini | "Apakah yang dibeli sesuai janji?" |
| 4. Kelengkapan & jumlah | Semua item ada buktinya, total sesuai | "Apakah lengkap & jumlahnya benar?" |

---

## 6. Jenis Bukti per Milestone

Dua kategori: **bukti transaksi** (uang keluar untuk apa) + **bukti realisasi** (hasilnya nyata). Milestone sehat butuh keduanya.

| Bukti | Membuktikan | Divalidasi dengan |
|---|---|---|
| Nota/invoice/kwitansi | Uang dibelanjakan untuk item benar | OCR → cocokkan RAB |
| Foto lapangan (geotag) | Hasil nyata ada di lokasi | Web-capture + Geolocation |
| Bukti serah-terima | Barang sampai ke penerima | Dokumen + foto |
| Laporan naratif singkat | Konteks tahap | Teks pengikat |

### 6.1 Paket Bukti Wajib per Jenis (ditentukan sistem, bukan yayasan)

| Jenis | Paket bukti wajib |
|---|---|
| Pembangunan/Renovasi | Nota material + foto progres geotag (before/after) |
| Pengadaan Barang | Invoice + foto barang + bukti serah-terima |
| Alat Bantu Disabilitas/Kesehatan | Invoice + foto alat + bukti serah-terima |
| Rekonstruksi Pasca-Bencana | Nota + foto before/after geotag |

### 6.2 Kekuatan Inti: Konsistensi Silang

Bukan tiap bukti dinilai sendiri — **harus cocok satu sama lain**:
- Nominal nota ≈ target milestone ≈ item RAB
- Foto menunjukkan barang/hasil yang sama dengan nota
- Geotag foto = lokasi proyek terdaftar
- Foto milestone ini konsisten dengan foto milestone sebelumnya (progres masuk akal)

Memalsukan satu nota mudah; memalsukan nota + foto + serah-terima + laporan yang **semuanya konsisten & cocok RAB terkunci** jauh lebih sulit. Tiap ketidakcocokan → sinyal review Dinsos.

---

## 7. Keaslian Bukti & Anti-Gambar-Generate

### 7.1 Prinsip: Cegah Lewat Arsitektur, Bukan Menebak Piksel

**JANGAN klaim "mendeteksi gambar AI-generated"** — detektor semacam itu belum andal & mudah ditusuk juri. Sebaliknya, buat bukti sintetis **gagal secara struktural**.

### 7.2 Web-Based Capture (pertahanan utama)

Karena yayasan mengakses via **website** (bukan mobile app), bukti diambil lewat **browser di HP saat di lokasi**:
- **`getUserMedia` (MediaDevices API)** → foto diambil langsung di web (bukan upload galeri) → menutup jalur unggah gambar generate.
- **`Geolocation API`** → koordinat GPS perangkat diambil serentak, diikat ke sesi upload + timestamp server.

> **Catatan teknis KRITIS:** Foto dari kamera web (canvas) **TIDAK punya EXIF geotag** seperti foto kamera HP biasa. Geotag berasal dari **Geolocation API yang diikat ke sesi upload**, BUKAN tertanam di file gambar. Tulis ini benar di proposal. `getUserMedia` & `Geolocation` **hanya jalan di HTTPS**.

### 7.3 Pertahanan Berlapis

| Lapis | Fungsi |
|---|---|
| 1. Web-capture + Geolocation | Foto segar, lokasi terverifikasi; menutup upload galeri |
| 2. Konsistensi silang | Foto antar-milestone, foto vs nota vs RAB, geotag berkerumun |
| 3. ELA + pemeriksaan visual | Sinyal pendukung (bukan vonis) → angkat ke review |
| 4. Human-in-the-loop (Dinsos) | Vonis akhir kasus abu-abu |

### 7.4 Keterbatasan yang DIAKUI Jujur (jangan disembunyikan)

- **GPS spoofing** (fake GPS) — lebih mudah di web. Mitigasi: cross-check IP, review Dinsos.
- **Replay attack** (foto layar monitor yang menampilkan gambar AI) — kamera web tidak mengatasi ini. Mitigasi: konsistensi silang + Dinsos.
- **Ketergantungan izin/perangkat** — HP lawas / izin ditolak → fallback (lihat §8).
- **Akurasi GPS bervariasi** — di dalam beton bisa meleset; toleransi radius wajar.

---

## 8. Toleransi & Fallback Tahap 3

**Aturan emas:** sistem otomatis hanya di kasus sangat jelas; semua yang meragukan **naik ke Dinsos**, bukan ditolak mentah. Ini menjawab pertanyaan juri soal *false positive*.

### 8.1 Toleransi (kapan masih "lolos")

| Situasi | Aksi |
|---|---|
| Selisih nominal ≤10% (kurang/lebih) | ✅ Lolos otomatis |
| Selisih 10–25% | ⚠️ Review Dinsos |
| Selisih >25% | 🔴 Tahan + wajib penjelasan |
| **Asimetri:** realisasi lebih MURAH | Lebih ditoleransi (hemat = baik; mark-up = red flag) |
| Nota item besar (>30% nilai milestone) hilang | 🔴 Wajib nota / review |
| Nota item kecil hilang (≤15% nilai milestone) | ✅ Ganti surat pernyataan + foto |
| GPS dalam radius wajar (~100–200 m) | ✅ Lolos |
| GPS di luar radius | ⚠️ Flag → review (bukan tolak) |
| Foto buram/gelap | 🔄 Minta ambil ulang |

**Sisa dana** (rencana − realisasi saat lebih murah) tetap di escrow → dialihkan ke milestone lain atau refund proporsional.

### 8.2 Fallback (saat gagal/terhambat)

| Situasi | Aksi |
|---|---|
| Izin lokasi/kamera ditolak / HP tak mendukung | Submit diterima tapi **ditandai "lokasi tidak terverifikasi" → wajib review Dinsos** (bukan celah pintas) |
| Milestone gagal validasi | Beri **2–3x kesempatan submit ulang** sebelum eskalasi |
| Gagal berulang | Status **FROZEN → review Dinsos wajib** (bukan langsung refund) |
| Proyek gagal (putusan Dinsos) | **Refund proporsional** sisa dana (belum cair, termasuk retensi) ke donatur; dana milestone yang sudah tervalidasi tidak ditarik |
| Timeout milestone (tak ada aktivitas) | Auto-flag ke Dinsos: terlambat wajar atau ditinggalkan? |

> **Catatan:** angka ambang (10%, 15%, 100–200m, 2–3x) adalah **titik awal masuk akal** — boleh disesuaikan, tapi yang penting *punya ambang eksplisit*. Menyambung ke perbaikan `claimRefund()` proporsional pada smart contract.

---

## 9. Hak & Aksi Donatur

### 9.1 Transparansi Penuh (inti produk — WAJIB)

Donatur dapat melihat: status tiap milestone, bukti yang diupload (sesuai aturan publik/privat §10), kapan & berapa dana cair, dan **link transaksi on-chain (PolygonScan)**. Inilah yang mengaktifkan makna "immutable & auditable" — tanpa donatur yang benar-benar bisa mengaudit, transparansi on-chain hanya teori.

### 9.2 Confidence Score: Tampilkan STATUS, Bukan Angka Mentah

**JANGAN tampilkan skor numerik mentah ("87%") ke donatur:**
- Menyesatkan orang awam (memicu panik tak perlu).
- Membocorkan ambang keputusan ke penipu (risiko keamanan).
- Skor AI bisa salah; keputusan akhir di Dinsos, bukan angka.

**Tampilkan sebagai status:** ✅ "Bukti Terverifikasi" · 🔍 "Sedang Ditinjau Dinas Sosial" · ⚠️ "Perlu Perbaikan Bukti". Skor numerik mentah hanya di **dashboard Dinsos**.

### 9.3 Aksi Donatur: Audit & Lapor, BUKAN Vote

**Model mental:** donatur = **pemegang saham publik yang bisa mengaudit**, bukan **dewan direksi yang memutuskan operasional**.

| Aksi | Boleh? | Catatan |
|---|---|---|
| Berdonasi & pilih kampanye | ✅ | Aksi inti |
| Melihat seluruh proses & bukti | ✅ | Transparansi penuh |
| Melihat status validasi (bukan skor) | ✅ | §9.2 |
| Audit transaksi on-chain | ✅ | Link explorer |
| **Melaporkan/flag kecurigaan** | ✅ | **Kanal suara mereka** |
| Menerima notifikasi tiap update | ✅ | Mobile app cocok |
| Menarik kembali donasi sepihak | ❌ | Dana terkunci escrow; refund hanya via mekanisme kegagalan resmi |
| **Vote lanjut/hentikan kampanye** | ❌ | Menghancurkan objektivitas; buka manipulasi; melucuti otoritas Dinsos |
| Memutuskan pencairan | ❌ | Hanya bukti + Dinsos |

**Flag ≠ Vote:** flag *memicu peninjauan otoritas* (donatur = whistleblower terdistribusi, memperkuat sistem); vote *menggantikan otoritas* (hakim massa, merusak sistem). Keputusan tetap berbasis **bukti terverifikasi + Dinsos**.

---

## 10. Bukti Publik vs Privat (Transparansi ↔ Privasi / UU PDP)

**Prinsip pemilah:** publikkan yang membuktikan **dana terpakai benar**; sembunyikan yang mengungkap **identitas orang atau data yang bisa disalahgunakan**. Tiga tingkat: **publik**, **redaksi** (tampil sebagian), **privat** (Dinsos saja).

| Bukti | Tingkat | Alasan |
|---|---|---|
| Foto progres bangunan/barang | ✅ Publik | Objek fisik, tak ada identitas |
| Status milestone & tanggal | ✅ Publik | Transparansi proses |
| Transaksi on-chain (hash, nominal, waktu) | ✅ Publik | Inti auditability |
| Ringkasan RAB vs realisasi (agregat) | ✅ Publik | "Material Rp15jt sesuai rencana" |
| Nota/invoice | 🟡 Redaksi | Tampilkan item+nominal; **sensor** nama toko lengkap/NPWP/rekening/kontak |
| Bukti serah-terima | 🔴 Privat (Dinsos) | Memuat nama/tanda tangan penerima |
| Wajah/identitas penerima | 🔴 Privat/dilarang publik | UU PDP; lindungi penerima rentan |
| Data internal yayasan (rekening, kontak) | 🔴 Privat | Keamanan & privasi lembaga |

### 10.1 Tiga Poin Kritis

1. **Foto lapangan bisa "bocor" tanpa sengaja** (wajah pekerja di latar, plang beralamat). Mitigasi MVP: imbau foto objek bukan orang + tombol lapor. Blur wajah otomatis = roadmap.
2. **Geotag = data lokasi presisi — jangan publikkan mentah.** Ke donatur cukup "lokasi terverifikasi ✓" atau peta level kelurahan. Koordinat presisi hanya untuk Dinsos.
3. **On-chain permanen — JANGAN pernah taruh data pribadi di sana.** Hanya **hash bukti + nominal + status** yang naik; file asli di storage off-chain terkontrol. Data pribadi yang terlanjur on-chain = pelanggaran UU PDP permanen.

---

## 11. Alur End-to-End Final

```
ONBOARDING     Yayasan submit SK Kemenkumham + Izin PUB ──▶ Dinsos verifikasi keabsahan ──▶ akun aktif
   │                              (verifikasi keberadaan, BUKAN penerbitan izin)
   ▼
KAMPANYE       Yayasan isi RAB + konteks ──▶ AI Planner susun draf milestone ──▶ yayasan finalisasi (dalam pagar)
   │                       ──▶ AI Validator RAB cek kewajaran ──▶ Dinsos ACC ──▶ LOCK smart contract ──▶ tayang
   ▼
DONASI         Masyarakat donasi (QRIS) ──▶ dana terkunci Escrow (smart contract)
   │                              💰 Dinsos TIDAK di jalur uang
   ▼
PENYALURAN     DP 10–15% cair ──▶ yayasan jalankan program ──▶ web-capture bukti (foto geotag + nota) di lokasi
   │                              ▼
   │              AI Validator Bukti (4 lapis) + toleransi ──▶ hasil
   │                              ▼
   │        Jelas lolos → cair otomatis  ·  Abu-abu → review Dinsos  ·  Gagal → freeze/refund proporsional
   ▼
AUDIT          Semua event tercatat on-chain ──▶ donatur pantau real-time (status, bukti publik, explorer) + boleh flag
```

---

## 12. Peta Konsep → Kriteria Penilaian (Submission 3)

| Kriteria Juri | Bagaimana konsep ini menjawabnya |
|---|---|
| **Use Case Clarity & Alignment** | Aktor & peran berdasar hukum eksplisit (§1); jenis donasi fokus (§2); alur jelas (§11) |
| **Complexity** | Peta pemangku kepentingan regulasi berjenjang (§1.2); ketegangan transparansi↔privasi berlapis (§10); 3 peran AI terpilah (§4) |
| **Implementation Feasibility** | Scope MVP terkunci (§2, §4.1); kepatuhan hukum (§1); keamanan & privasi (§10); teknologi zero-training realistis untuk tim 2 orang (§4.1) |
| **Algorithm Quality & UX** | AI Planner beralasan/transparan (§3.4); validasi 4 lapis bisa ditelusuri (§5.3); toleransi anti-false-positive (§8) |
| **Team Readiness** | (dilengkapi di proposal — komposisi & pembagian peran) |
| **Business Plan & ROI** | (dilengkapi di proposal — pasar B2C donatur + B2B yayasan; fee platform; roadmap ekspansi jenis donasi) |

---

## 13. Daftar Revisi terhadap Proposal ke-1 (Konsistensi)

Hal-hal yang **berubah** dan wajib disesuaikan saat menulis proposal ke-3:

1. **Validator = Dinas Sosial**, bukan "Pemerintah Desa (Pemda)". (Proposal 1 Fase 1 & 3 salah secara hukum.)
2. **AI Fraud Detection = 2 titik** (Validator RAB + Validator Bukti), onboarding bukan AI forensik berat. Tambah **AI Planner** sebagai peran ketiga (asistensi, bukan fraud detection).
3. **Jenis donasi = 4 enum tertutup**; buang contoh "bantuan bencana" darurat & beasiswa. Ganti fokus ke pembangunan/pengadaan/rekonstruksi.
4. **Bukti via web-capture (`getUserMedia` + `Geolocation API`)**, bukan "kamera in-app membaca EXIF geotag". Geotag dari Geolocation API, bukan EXIF foto. (Proposal 1 baris ~279.)
5. **EfficientNet-B4 + 3 dataset → roadmap**, bukan MVP. MVP = PaddleOCR + ELA + EXIF/metadata + LLM. Jangan melebih-lebihkan kesiapan.
6. **Mobile app (Flutter) = donatur SAJA**; yayasan & Dinsos via website. (Proposal 1 baris ~258 menyebut mobile untuk "pengelola".)
7. **Confidence score → tampil sebagai status** untuk donatur, bukan angka mentah.
8. Tambah **retensi progresif** (porsi akhir terbesar) — belum ada di proposal 1 yang hanya menyebut "dana muka 10–20%".
9. Tambah dua **boilerplate** (batas peran pemerintah + batas aliran dana/APBD) — §1.4.

---

*Dokumen ini adalah landasan konsep. Angka ambang & detail teknis dapat disesuaikan seiring pengembangan, tetapi prinsip inti (retensi progresif, validasi berjenjang, Dinsos sebagai validator non-finansial, enum tertutup, transparansi berlapis) menjadi fondasi yang dipertahankan.*
