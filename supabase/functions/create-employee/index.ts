// Supabase Edge Function: create-employee
// Membuat akun karyawan baru dengan aman. service_role hanya hidup di server ini,
// tidak pernah dikirim ke browser. Hanya admin yang boleh memanggilnya.
//
// Deploy (lihat README). Setelah deploy, MATIKAN "Verify JWT" untuk fungsi ini
// (kita verifikasi admin secara manual di dalam kode + butuh preflight CORS).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // 1) Siapa pemanggilnya? (pakai token sesi yang dikirim dari aplikasi)
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uErr } = await caller.auth.getUser();
    if (uErr || !user) return json({ error: "Tidak terautentikasi." }, 401);

    // 2) Klien admin (service_role) — cek peran pemanggil
    const admin = createClient(url, service);
    const { data: prof } = await admin
      .from("profiles").select("role").eq("id", user.id).single();
    if (!prof || prof.role !== "admin") {
      return json({ error: "Hanya admin yang boleh menambah karyawan." }, 403);
    }

    // 3) Validasi input
    const { email, password, nama, nip, divisi, role } = await req.json();
    if (!email || !password || String(password).length < 6) {
      return json({ error: "Email & kata sandi (min. 6 karakter) wajib diisi." }, 400);
    }

    // 4) Buat akun (email langsung terkonfirmasi)
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nama, nip, divisi },
    });
    if (cErr) return json({ error: cErr.message }, 400);

    // 5) Pastikan profil terisi (trigger sudah membuat baris; set field & peran)
    await admin.from("profiles").update({
      nama: nama || "Karyawan", nip: nip || "", divisi: divisi || "", role: role === "admin" ? "admin" : "karyawan",
    }).eq("id", created.user!.id);

    return json({ ok: true, id: created.user!.id });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
