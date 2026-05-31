# Attendy — Aplikasi Absensi Perusahaan (Supabase, multi-user)

Absensi dengan login per karyawan: clock in/out (GPS + foto selfie),
manajemen cuti/izin, dan mode Admin untuk persetujuan. Data tersimpan di
Supabase (PostgreSQL) dengan Row Level Security.

## 1. Siapkan Supabase
1. Buat akun & project baru di https://supabase.com (gratis untuk memulai).
2. Buka **SQL Editor** → tempel seluruh isi `supabase_setup.sql` → **Run**.
   (Ini membuat tabel profiles/attendance/leaves + kebijakan RLS + trigger.)
3. (Untuk testing cepat) Buka **Authentication → Sign In / Providers → Email**
   dan **matikan "Confirm email"**, supaya akun baru bisa langsung login.
4. Buka **Project Settings → API**, salin:
   - **Project URL**  → jadi `VITE_SUPABASE_URL`
   - **anon public**  → jadi `VITE_SUPABASE_ANON_KEY`

## 2. Jalankan lokal
```bash
npm install
cp .env.example .env      # lalu isi VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY
npm run dev
```

## 3. Deploy ke Vercel
- Push ke GitHub → import di Vercel (auto-detect Vite).
- **Penting:** di Vercel → Project → **Settings → Environment Variables**,
  tambahkan `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` (nilai sama
  seperti .env), lalu **Redeploy**.

## 4. Buat admin
1. Buka aplikasi → tab **Daftar** → buat akun untuk dirimu.
2. Di Supabase **SQL Editor**, jalankan (ganti emailnya):
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'kamu@email.com');
   ```
3. Logout & login lagi → sekarang masuk sebagai Admin.

## Catatan
- **RLS aktif**: karyawan hanya melihat datanya sendiri; admin melihat semua.
  Kunci `anon` aman dipakai di frontend selama RLS aktif.
- Foto selfie kini disimpan sebagai base64 di kolom `foto`. Untuk skala besar,
  pindahkan ke **Supabase Storage** (peningkatan opsional berikutnya).
- Kamera & GPS butuh HTTPS — URL Vercel sudah HTTPS.

## Update: Panel Admin/HR (CRUD)
Versi ini menambah halaman **Monitoring** (filter tanggal, cari nama, tambah/edit/hapus
absensi) dan **Manajemen Karyawan** (edit data + ubah peran jadi Admin dari UI).

Karena menambah hak akses admin, jalankan SQL tambahan **satu kali**:
1. Supabase → **SQL Editor** → tempel isi `supabase_admin_update.sql` → **Run**.
2. Update kode di GitHub seperti biasa → Vercel redeploy otomatis.

Setelah ini, kamu bisa menjadikan karyawan jadi Admin lewat menu **Karyawan → Edit**,
tanpa perlu menjalankan SQL `update profiles` lagi.

## Update: Tambah Karyawan dari Panel Admin (Edge Function)
Agar admin bisa membuat akun karyawan dengan aman, perlu satu Edge Function
(menyimpan service_role di server, bukan di browser).

Deploy lewat dashboard Supabase (tanpa CLI):
1. Supabase → menu kiri **Edge Functions** → **Create a function** (atau "Deploy a new function").
2. Beri nama persis: **`create-employee`**.
3. Buka file `supabase/functions/create-employee/index.ts` di proyek ini, salin
   seluruh isinya, tempel ke editor fungsi → **Deploy**.
4. Buka pengaturan fungsi tsb → **matikan "Verify JWT"** (kita verifikasi admin
   manual di dalam kode + perlu preflight CORS dari browser).

Tidak perlu set secret apa pun: Supabase otomatis menyediakan `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` ke Edge Function.

Cara CLI (alternatif, jika punya Supabase CLI):
```bash
supabase functions deploy create-employee --no-verify-jwt
```

Setelah itu: di app, masuk sebagai Admin → **Karyawan → Tambah** → isi data +
email + kata sandi awal → akun langsung jadi & bisa login. Sampaikan email &
sandinya ke karyawan terkait.

## Update: Jadikan Aplikasi Android (.apk) via PWABuilder
Attendy kini adalah PWA (ada manifest.json, ikon, dan service worker).

1. Upload perubahan ke GitHub (termasuk folder `public/` & `index.html`) → tunggu Vercel redeploy (status Ready).
2. (Opsional) Buka aplikasimu di Chrome Android → menu → "Install app" untuk memasang langsung sebagai PWA tanpa APK.
3. Untuk file .apk: buka https://www.pwabuilder.com → masukkan URL Vercel-mu → "Start".
   - PWABuilder akan mengecek manifest/ikon (harusnya lolos).
   - Pilih platform **Android** → **Generate Package** → unduh.
   - Untuk dibagikan langsung ke karyawan: pilih paket yang berisi **APK** (signed). Untuk Play Store: gunakan **AAB** + akun Google Play Developer.
4. Pasang APK di HP (izinkan "install dari sumber tak dikenal" bila diminta).

Catatan: aplikasi membungkus situs live-mu, jadi setiap update di Vercel otomatis
ikut terbarui di aplikasi. Kamera & lokasi tetap berfungsi (minta izin seperti biasa).
