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
