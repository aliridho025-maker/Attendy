import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Clock, MapPin, Camera, CalendarDays, CheckCircle2, XCircle, LogIn, LogOut,
  User, FileText, Home, History, RefreshCw, ShieldCheck, Mail, Lock,
  Plane, Stethoscope, Briefcase, Hourglass, AlertTriangle, X,
  Image as ImageIcon, Users, ClipboardList, Pencil, Trash2, Plus, Search, ScanFace, Fingerprint, Timer, Download
} from "lucide-react";
import * as blazeface from "@tensorflow-models/blazeface";
import "@tensorflow/tfjs";
import * as XLSX from "xlsx";
import { supabase, configured } from "./supabaseClient";

/* ============================================================
   ATTENDY — Absensi Perusahaan (Supabase: multi-user + RLS)
   + Panel Admin/HR, deteksi wajah wajib, sapaan waktu.
   ============================================================ */

const JAM_MASUK = "08:00";
const JAM_PULANG = "17:00";

// ====== Identitas perusahaan (mudah diganti) ======
const COMPANY = { nama: "Casa Royal", sub: "Indonesia", logo: "/logo.png" };

const LEAVE_TYPES = [
  { id: "cuti", label: "Cuti Tahunan", icon: Plane },
  { id: "izin", label: "Izin", icon: FileText },
  { id: "sakit", label: "Sakit", icon: Stethoscope },
  { id: "dinas", label: "Dinas Luar", icon: Briefcase },
];

/* ---------- util ---------- */
const pad = (n) => String(n).padStart(2, "0");
const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtJam = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtTanggal = (iso) =>
  new Date(iso).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtTanggalPendek = (iso) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
const isTerlambat = (d) => fmtJam(d) > JAM_MASUK;
const initials = (nama) => (nama || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const salam = (h) => (h >= 5 && h < 11) ? "Selamat pagi" : (h >= 11 && h < 15) ? "Selamat siang" : (h >= 15 && h < 18) ? "Selamat sore" : "Selamat malam";
function jamKerja(masukJam, pulangJam, now) {
  if (!masukJam) return "--:--";
  const [mh, mm] = masukJam.split(":").map(Number);
  let end;
  if (pulangJam) { const [ph, pm] = pulangJam.split(":").map(Number); end = ph * 60 + pm; }
  else { end = now.getHours() * 60 + now.getMinutes(); }
  let diff = end - (mh * 60 + mm); if (diff < 0) diff += 1440;
  return `${pad(Math.floor(diff / 60))}:${pad(diff % 60)}`;
}
const pulangCepat = (jam) => !!jam && jam < JAM_PULANG;

/* ---------- map baris DB -> bentuk komponen ---------- */
const mapAtt = (r) => ({
  id: r.id, userId: r.user_id, nama: r.nama, nip: r.nip, divisi: r.divisi, tanggal: r.tanggal,
  masuk: r.masuk_jam ? { jam: r.masuk_jam, lat: r.masuk_lat, lng: r.masuk_lng } : null,
  pulang: r.pulang_jam ? { jam: r.pulang_jam, lat: r.pulang_lat, lng: r.pulang_lng } : null,
  terlambat: r.terlambat, foto: r.foto,
});
const mapLeave = (r) => ({
  id: r.id, userId: r.user_id, nama: r.nama, tipe: r.tipe, mulai: r.mulai, selesai: r.selesai,
  alasan: r.alasan, status: r.status, dibuat: r.created_at,
});

/* ---------- lokasi ---------- */
function getLokasi() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ ok: false });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ ok: true, lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => resolve({ ok: false }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

/* ---------- gambar -> dataURL kecil ---------- */
function frameToDataUrl(source, isVideo) {
  const SZ = 220;
  const canvas = document.createElement("canvas");
  canvas.width = SZ; canvas.height = SZ;
  const ctx = canvas.getContext("2d");
  const sw = isVideo ? source.videoWidth : source.naturalWidth;
  const sh = isVideo ? source.videoHeight : source.naturalHeight;
  if (!sw || !sh) return null;
  const side = Math.min(sw, sh);
  const sx = (sw - side) / 2, sy = (sh - side) / 2;
  if (isVideo) { ctx.translate(SZ, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, sx, sy, side, side, 0, 0, SZ, SZ);
  return canvas.toDataURL("image/jpeg", 0.6);
}

/* ---------- model deteksi wajah (dimuat sekali) ---------- */
let _facePromise = null;
function loadFaceModel() {
  if (!_facePromise) _facePromise = blazeface.load();
  return _facePromise;
}
async function adaWajah(model, source) {
  try {
    const preds = await model.estimateFaces(source, false);
    return Array.isArray(preds) && preds.length > 0;
  } catch (e) { return false; }
}

/* ============================================================ ROOT ============================================================ */
export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!configured) { setReady(true); return; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (!data.session) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) { setProfile(null); setReady(true); }
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
      if (!active) return;
      if (error || !data) setProfile({ id: session.user.id, nama: "Karyawan", nip: "", divisi: "", role: "karyawan" });
      else setProfile(data);
      setReady(true);
    })();
    return () => { active = false; };
  }, [session]);

  const logout = async () => { await supabase.auth.signOut(); };

  if (!configured) return <Frame><ConfigWarning /><Styles /></Frame>;
  if (!ready) return <Frame><Loader /><Styles /></Frame>;
  if (!session) return <Frame><AuthScreen /><Styles /></Frame>;
  if (!profile) return <Frame><Loader /><Styles /></Frame>;
  return <Frame><Dashboard profile={profile} onLogout={logout} /><Styles /></Frame>;
}

/* ---------------- LOGIN / DAFTAR ---------------- */
function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [nama, setNama] = useState("");
  const [nip, setNip] = useState("");
  const [divisi, setDivisi] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const submit = async () => {
    setBusy(true); setMsg("");
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password: pass, options: { data: { nama, nip, divisi } } });
        if (error) throw error;
        setMsg("Akun dibuat. Jika diminta verifikasi email, cek inbox dulu, lalu login.");
        setMode("login");
      }
    } catch (e) { setMsg(e.message || "Terjadi kesalahan."); }
    finally { setBusy(false); }
  };

  const valid = email.includes("@") && pass.length >= 6 && (mode === "login" || nama.trim().length >= 2);

  return (
    <div className="auth-wrap">
      <img className="auth-logo" src={COMPANY.logo} alt={COMPANY.nama} />
      <div className="auth-brand">{COMPANY.nama}</div>
      <div className="auth-sub">{COMPANY.sub} — Absensi Perusahaan</div>
      <div className="auth-card">
        <div className="auth-tabs">
          <button className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setMsg(""); }}>Masuk</button>
          <button className={mode === "daftar" ? "on" : ""} onClick={() => { setMode("daftar"); setMsg(""); }}>Daftar</button>
        </div>
        {mode === "daftar" && (
          <>
            <label className="fld-lbl">Nama lengkap</label>
            <input className="inp" value={nama} onChange={(e) => setNama(e.target.value)} placeholder="cth. Andi Pratama" />
            <div className="fld-row">
              <div><label className="fld-lbl">NIP</label><input className="inp" value={nip} onChange={(e) => setNip(e.target.value)} placeholder="EMP-1024" /></div>
              <div><label className="fld-lbl">Divisi</label><input className="inp" value={divisi} onChange={(e) => setDivisi(e.target.value)} placeholder="Teknologi" /></div>
            </div>
          </>
        )}
        <label className="fld-lbl">Email</label>
        <div className="inp-ic"><Mail size={15} /><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@email.com" type="email" /></div>
        <label className="fld-lbl">Kata sandi</label>
        <div className="inp-ic"><Lock size={15} /><input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="min. 6 karakter" type="password" /></div>
        {msg && <div className="auth-msg">{msg}</div>}
        <button className={`big-btn masuk ${!valid || busy ? "off" : ""}`} disabled={!valid || busy} onClick={submit}>
          {busy ? <RefreshCw size={18} className="spin" /> : (mode === "login" ? <LogIn size={18} /> : <User size={18} />)}
          {mode === "login" ? "Masuk" : "Buat Akun"}
        </button>
      </div>
      <div className="auth-foot">Karyawan baru? Pilih “Daftar”. Peran admin diatur oleh pengelola.</div>
    </div>
  );
}

/* ---------------- DASHBOARD ---------------- */
function Dashboard({ profile, onLogout }) {
  const [tab, setTab] = useState("beranda");
  const [now, setNow] = useState(new Date());
  const [attendance, setAttendance] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [capture, setCapture] = useState(null);
  const [showCuti, setShowCuti] = useState(false);
  const [attModal, setAttModal] = useState(null);
  const [profModal, setProfModal] = useState(null);
  const [detailRec, setDetailRec] = useState(null);
  const [karyawanModal, setKaryawanModal] = useState(false);

  const role = profile.role === "admin" ? "admin" : "karyawan";

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const refresh = useCallback(async () => {
    try {
      setErr("");
      const [a, l, p] = await Promise.all([
        supabase.from("attendance").select("*").order("created_at", { ascending: false }),
        supabase.from("leaves").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("*").order("nama", { ascending: true }),
      ]);
      if (a.error) throw a.error;
      if (l.error) throw l.error;
      if (p.error) throw p.error;
      setAttendance((a.data || []).map(mapAtt));
      setLeaves((l.data || []).map(mapLeave));
      setProfiles(p.data || []);
    } catch (e) { setErr(e.message || "Gagal memuat data."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const absenHariIni = attendance.find((a) => a.userId === profile.id && a.tanggal === todayKey());

  const submitCapture = async ({ mode, lokasi, foto }) => {
    const d = new Date(); setCapture(null);
    try {
      if (mode === "masuk") {
        const { error } = await supabase.from("attendance").insert({
          user_id: profile.id, nama: profile.nama, nip: profile.nip, divisi: profile.divisi,
          tanggal: todayKey(d), masuk_jam: fmtJam(d), masuk_lat: lokasi.lat, masuk_lng: lokasi.lng,
          terlambat: isTerlambat(d), foto,
        });
        if (error) throw error;
      } else if (absenHariIni) {
        const { error } = await supabase.from("attendance").update({
          pulang_jam: fmtJam(d), pulang_lat: lokasi.lat, pulang_lng: lokasi.lng,
        }).eq("id", absenHariIni.id);
        if (error) throw error;
      }
      await refresh();
    } catch (e) { setErr(e.message); }
  };

  const ajukanCuti = async (form) => {
    setShowCuti(false);
    try {
      const { error } = await supabase.from("leaves").insert({ user_id: profile.id, nama: profile.nama, ...form, status: "menunggu" });
      if (error) throw error; await refresh();
    } catch (e) { setErr(e.message); }
  };

  const putusanCuti = async (id, status) => {
    try { const { error } = await supabase.from("leaves").update({ status }).eq("id", id); if (error) throw error; await refresh(); }
    catch (e) { setErr(e.message); }
  };
  const hapusCuti = async (id) => {
    if (!confirm("Hapus pengajuan ini?")) return;
    try { const { error } = await supabase.from("leaves").delete().eq("id", id); if (error) throw error; await refresh(); }
    catch (e) { setErr(e.message); }
  };
  const simpanAbsen = async (data) => {
    setAttModal(null);
    try {
      if (data.id) {
        const { error } = await supabase.from("attendance").update({
          tanggal: data.tanggal, masuk_jam: data.masuk_jam, pulang_jam: data.pulang_jam, terlambat: data.terlambat,
        }).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("attendance").insert({
          user_id: data.user_id, nama: data.nama, nip: data.nip, divisi: data.divisi,
          tanggal: data.tanggal, masuk_jam: data.masuk_jam, pulang_jam: data.pulang_jam, terlambat: data.terlambat,
        });
        if (error) throw error;
      }
      await refresh();
    } catch (e) { setErr(e.message); }
  };
  const hapusAbsen = async (id) => {
    if (!confirm("Hapus data absensi ini?")) return;
    try { const { error } = await supabase.from("attendance").delete().eq("id", id); if (error) throw error; await refresh(); }
    catch (e) { setErr(e.message); }
  };
  const simpanProfil = async (id, patch) => {
    setProfModal(null);
    try { const { error } = await supabase.from("profiles").update(patch).eq("id", id); if (error) throw error; await refresh(); }
    catch (e) { setErr(e.message); }
  };
  const tambahKaryawan = async (payload) => {
    try {
      const { data, error } = await supabase.functions.invoke("create-employee", { body: payload });
      if (error) {
        let m = error.message;
        try { const ctx = await error.context?.json?.(); if (ctx?.error) m = ctx.error; } catch (_) {}
        return m || "Gagal menambah karyawan.";
      }
      if (data?.error) return data.error;
      setKaryawanModal(false);
      await refresh();
      return null;
    } catch (e) { return e.message || "Gagal menambah karyawan."; }
  };

  const exportExcel = () => {
    try {
      const attRows = [...attendance]
        .sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1))
        .map((a) => ({
          Nama: a.nama || "", NIP: a.nip || "", Divisi: a.divisi || "",
          Tanggal: a.tanggal,
          "Jam Masuk": a.masuk?.jam || "",
          "Jam Pulang": a.pulang?.jam || "",
          "Jam Kerja": a.pulang ? jamKerja(a.masuk?.jam, a.pulang?.jam, new Date()) : "",
          Terlambat: a.terlambat ? "Ya" : "Tidak",
          "Lokasi Masuk": (a.masuk?.lat != null) ? `${a.masuk.lat}, ${a.masuk.lng}` : "",
        }));
      const leaveRows = leaves.map((l) => ({
        Nama: l.nama || "",
        Jenis: (LEAVE_TYPES.find((t) => t.id === l.tipe) || {}).label || l.tipe,
        "Tgl Mulai": l.mulai, "Tgl Selesai": l.selesai,
        Alasan: l.alasan || "", Status: l.status,
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(attRows.length ? attRows : [{ Info: "Belum ada data" }]), "Absensi");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(leaveRows.length ? leaveRows : [{ Info: "Belum ada data" }]), "Cuti");
      XLSX.writeFile(wb, `attendy_export_${todayKey()}.xlsx`);
    } catch (e) { setErr(e.message || "Gagal membuat file Excel."); }
  };

  const navItems = role === "karyawan"
    ? [{ id: "beranda", label: "Absen", icon: Home }, { id: "riwayat", label: "Riwayat", icon: History }, { id: "cuti", label: "Cuti", icon: CalendarDays }]
    : [{ id: "beranda", label: "Monitoring", icon: ClipboardList }, { id: "karyawan", label: "Karyawan", icon: Users }, { id: "cuti", label: "Cuti", icon: CalendarDays }];

  return (
    <>
      <header className="hdr">
        <div className="brand-wrap">
          <img className="logo-img" src={COMPANY.logo} alt={COMPANY.nama} />
          <div className="brand-txt"><b>{COMPANY.nama}</b><span>{COMPANY.sub}</span></div>
        </div>
        <div className="hdr-right">
          <span className="role-pill">{role === "admin" ? <><ShieldCheck size={12} /> Admin</> : <><User size={12} /> Karyawan</>}</span>
          <div className="avatar">{initials(profile.nama)}</div>
          <button className="logout-btn" onClick={onLogout} title="Keluar"><LogOut size={16} /></button>
        </div>
      </header>

      {err && <div className="err-banner"><AlertTriangle size={14} /> {err} <button onClick={() => setErr("")}><X size={13} /></button></div>}

      <main className="scroll">
        {loading ? <Loader inline /> : (
          <>
            {role === "karyawan" && tab === "beranda" && <Beranda now={now} nama={profile.nama} absen={absenHariIni} onAbsen={(mode) => setCapture({ mode })} />}
            {role === "karyawan" && tab === "riwayat" && <Riwayat list={attendance.filter((a) => a.userId === profile.id)} />}
            {role === "karyawan" && tab === "cuti" && <CutiKaryawan list={leaves.filter((l) => l.userId === profile.id)} onAjukan={() => setShowCuti(true)} />}

            {role === "admin" && tab === "beranda" && (
              <AdminMonitoring list={attendance} onAdd={() => setAttModal("new")} onEdit={(r) => setAttModal(r)} onDelete={hapusAbsen} onView={(r) => setDetailRec(r)} onExport={exportExcel} />
            )}
            {role === "admin" && tab === "karyawan" && (
              <AdminKaryawan profiles={profiles} attendance={attendance} onEdit={(p) => setProfModal(p)} onAdd={() => setKaryawanModal(true)} />
            )}
            {role === "admin" && tab === "cuti" && <AdminCuti list={leaves} onPutusan={putusanCuti} onDelete={hapusCuti} />}
          </>
        )}
      </main>

      <nav className="nav">
        {navItems.map((it) => {
          const Ic = it.icon, aktif = tab === it.id;
          return (
            <button key={it.id} className={`nav-btn ${aktif ? "on" : ""}`} onClick={() => setTab(it.id)}>
              <Ic size={20} strokeWidth={aktif ? 2.4 : 1.8} /><span>{it.label}</span>
            </button>
          );
        })}
      </nav>

      {capture && <CaptureModal mode={capture.mode} onClose={() => setCapture(null)} onSubmit={submitCapture} />}
      {showCuti && <CutiForm onClose={() => setShowCuti(false)} onSubmit={ajukanCuti} />}
      {attModal && <AbsenModal rec={attModal === "new" ? null : attModal} profiles={profiles} onClose={() => setAttModal(null)} onSave={simpanAbsen} />}
      {profModal && <ProfilModal prof={profModal} onClose={() => setProfModal(null)} onSave={simpanProfil} />}
      {detailRec && <DetailAbsen rec={detailRec} onClose={() => setDetailRec(null)} />}
      {karyawanModal && <KaryawanBaruModal onClose={() => setKaryawanModal(false)} onSave={tambahKaryawan} />}
    </>
  );
}

/* ---------------- BERANDA KARYAWAN ---------------- */
function Beranda({ now, nama, absen, onAbsen }) {
  const sudahMasuk = !!absen;
  const sudahPulang = !!(absen && absen.pulang);
  const namaDepan = (nama || "").split(" ")[0] || "Karyawan";
  const kerja = jamKerja(absen?.masuk?.jam, absen?.pulang?.jam, now);
  const cepat = sudahPulang && pulangCepat(absen.pulang.jam);
  return (
    <div className="page home">
      <div className="greet-line">{salam(now.getHours())}, <b>{namaDepan} 👋</b></div>
      <div className="home-clock">
        <div className="hc-time">{pad(now.getHours())}:{pad(now.getMinutes())}<span className="hc-sec">:{pad(now.getSeconds())}</span></div>
        <div className="hc-date">{fmtTanggal(now.toISOString())}</div>
        <div className="hc-sched"><Clock size={11} /> Jam kerja {JAM_MASUK} – {JAM_PULANG}</div>
      </div>

      {!sudahMasuk && (
        <button className="hero-btn in" onClick={() => onAbsen("masuk")}>
          <div className="hero-ring"><Fingerprint size={30} /></div>
          <div className="hero-label">Clock In</div>
        </button>
      )}
      {sudahMasuk && !sudahPulang && (
        <button className="hero-btn out" onClick={() => onAbsen("pulang")}>
          <div className="hero-ring"><Fingerprint size={30} /></div>
          <div className="hero-label">Clock Out</div>
        </button>
      )}
      {sudahPulang && <div className="hero-done"><CheckCircle2 size={26} /><span>Selesai untuk hari ini</span></div>}

      <div className="stat3">
        <div className="s3"><div className="s3-ic"><LogIn size={19} /></div><div className="s3-val">{absen?.masuk?.jam || "--:--"}</div><div className="s3-lbl">Clock In</div></div>
        <div className="s3"><div className="s3-ic"><LogOut size={19} /></div><div className="s3-val">{absen?.pulang?.jam || "--:--"}</div><div className="s3-lbl">Clock Out</div></div>
        <div className="s3"><div className="s3-ic"><Timer size={19} /></div><div className="s3-val">{kerja}</div><div className="s3-lbl">Working Hrs</div></div>
      </div>

      {sudahMasuk && absen.terlambat && <div className="late-note"><AlertTriangle size={13} /> Tercatat terlambat (lewat {JAM_MASUK})</div>}
      {cepat && <div className="late-note"><AlertTriangle size={13} /> Pulang lebih awal (sebelum {JAM_PULANG})</div>}
      <div className="hint"><ScanFace size={12} /> Wajib selfie wajah & lokasi aktif saat absen.</div>
    </div>
  );
}

/* ---------------- CAPTURE MODAL (deteksi wajah wajib) ---------------- */
function CaptureModal({ mode, onClose, onSubmit }) {
  const [lokasi, setLokasi] = useState(null);
  const [foto, setFoto] = useState(null);
  const [camErr, setCamErr] = useState(false);
  const [model, setModel] = useState(null);
  const [prep, setPrep] = useState(true);
  const [checking, setChecking] = useState(false);
  const [faceMsg, setFaceMsg] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => { getLokasi().then(setLokasi); }, []);

  useEffect(() => {
    let active = true;
    loadFaceModel().then((m) => { if (active) setModel(m); }).catch(() => {}).finally(() => { if (active) setPrep(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        if (!mounted) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play().catch(() => {}); }
      } catch (e) { setCamErr(true); }
    })();
    return () => { mounted = false; if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop()); };
  }, []);

  const verifikasi = async (source, isVideo) => {
    if (!model) { setFaceMsg("Deteksi wajah belum siap. Periksa koneksi, lalu coba lagi."); return; }
    setFaceMsg(""); setChecking(true);
    const ok = await adaWajah(model, source);
    if (!ok) { setChecking(false); setFaceMsg("Wajah tidak terdeteksi. Pastikan wajahmu terlihat jelas di dalam bingkai."); return; }
    const url = frameToDataUrl(source, isVideo);
    setFoto(url);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    setChecking(false);
  };

  const ambilFoto = () => { if (videoRef.current) verifikasi(videoRef.current, true); };
  const onFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const img = new Image(); img.onload = () => verifikasi(img, false); img.src = URL.createObjectURL(f);
  };

  const ulangi = () => { setFoto(null); setFaceMsg(""); setCamErr(true); };

  const lokasiSiap = lokasi !== null;
  const bisaSubmit = lokasiSiap && !!foto;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal cap" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <h3>{mode === "masuk" ? "Absen Masuk" : "Absen Pulang"}</h3>
          <button className="x" onClick={onClose}><X size={18} /></button>
        </div>

        <div className={`cam-wrap ${foto ? "done" : ""}`}>
          {foto ? <img src={foto} alt="selfie" className="cam-shot" />
            : camErr ? (
              <div className="cam-fallback">
                <ImageIcon size={30} /><p>Kamera tidak tersedia / izin ditolak.</p>
                <button className="mini-btn" onClick={() => fileRef.current?.click()}>Pilih / Ambil Foto</button>
                <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={onFile} />
              </div>
            ) : <video ref={videoRef} className="cam-video" playsInline muted />}
          {!foto && !camErr && <div className="face-ring" />}
        </div>

        {foto ? (
          <div className="face-ok"><CheckCircle2 size={14} /> Wajah terverifikasi</div>
        ) : (
          <div className="face-hint">
            {prep ? <><RefreshCw size={13} className="spin" /> Menyiapkan deteksi wajah…</>
              : <><ScanFace size={13} /> Posisikan wajah di dalam bingkai</>}
          </div>
        )}
        {faceMsg && <div className="face-err"><AlertTriangle size={13} /> {faceMsg}</div>}

        {!foto && !camErr && (
          <button className={`mini-btn shoot ${prep || checking ? "off" : ""}`} disabled={prep || checking} onClick={ambilFoto}>
            {checking ? <RefreshCw size={15} className="spin" /> : <Camera size={15} />} {checking ? "Memeriksa…" : "Ambil Selfie"}
          </button>
        )}
        {foto && <button className="mini-btn ghost" onClick={ulangi}>Ulangi foto</button>}

        <div className={`loc-box ${lokasiSiap ? (lokasi.ok ? "ok" : "warn") : ""}`}>
          <MapPin size={16} />
          {!lokasiSiap && <span>Mengambil lokasi…</span>}
          {lokasiSiap && lokasi.ok && <span>{lokasi.lat.toFixed(5)}, {lokasi.lng.toFixed(5)} · ±{Math.round(lokasi.acc)}m</span>}
          {lokasiSiap && !lokasi.ok && <span>Lokasi tidak tersedia</span>}
        </div>

        <button className={`big-btn ${mode === "masuk" ? "masuk" : "pulang"} ${!bisaSubmit ? "off" : ""}`} disabled={!bisaSubmit}
          onClick={() => onSubmit({ mode, lokasi: lokasi.ok ? lokasi : { lat: null, lng: null }, foto })}>
          {mode === "masuk" ? <LogIn size={20} /> : <LogOut size={20} />} Konfirmasi
        </button>
        {!foto && <div className="req-note">Selfie wajah wajib untuk melanjutkan.</div>}
      </div>
    </div>
  );
}

/* ---------------- RIWAYAT ---------------- */
function Riwayat({ list }) {
  const masuk = list;
  const keluar = list.filter((a) => a.pulang);
  return (
    <div className="page">
      <h2 className="page-title">Riwayat Absensi</h2>

      <div className="rw-sec">
        <div className="rw-sec-head in"><LogIn size={15} /> Absen Masuk</div>
        {!masuk.length ? <div className="rw-empty">Belum ada data.</div> : (
          <>
            <div className="rw-thead"><span>Tanggal</span><span>Jam</span><span>Status</span></div>
            {masuk.map((a) => (
              <div key={a.id} className="rw-row">
                <span className="rw-date2"><CalendarDays size={13} /> {fmtTanggalPendek(a.tanggal)}</span>
                <span className="rw-jam">{a.masuk?.jam || "--:--"}</span>
                <span>{a.terlambat ? <span className="badge late">Telat</span> : <span className="badge ok">Tepat</span>}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="rw-sec">
        <div className="rw-sec-head out"><LogOut size={15} /> Absen Keluar</div>
        {!keluar.length ? <div className="rw-empty">Belum ada data.</div> : (
          <>
            <div className="rw-thead"><span>Tanggal</span><span>Jam</span><span>Status</span></div>
            {keluar.map((a) => (
              <div key={a.id} className="rw-row">
                <span className="rw-date2"><CalendarDays size={13} /> {fmtTanggalPendek(a.tanggal)}</span>
                <span className="rw-jam">{a.pulang?.jam || "--:--"}</span>
                <span>{pulangCepat(a.pulang?.jam) ? <span className="badge late">Cepat</span> : <span className="badge ok">Normal</span>}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- CUTI (KARYAWAN) ---------------- */
function CutiKaryawan({ list, onAjukan }) {
  return (
    <div className="page">
      <div className="page-head">
        <h2 className="page-title">Pengajuan Cuti / Izin</h2>
        <button className="add-btn" onClick={onAjukan}>+ Ajukan</button>
      </div>
      {!list.length ? <Empty icon={CalendarDays} teks="Belum ada pengajuan." /> : list.map((l) => <CutiCard key={l.id} l={l} />)}
    </div>
  );
}

function CutiCard({ l, admin, onPutusan, onDelete }) {
  const tipe = LEAVE_TYPES.find((t) => t.id === l.tipe) || LEAVE_TYPES[1];
  const Ic = tipe.icon;
  return (
    <div className="ct-card">
      <div className="ct-top">
        <div className="ct-tipe"><span className="ct-ic"><Ic size={15} /></span>{tipe.label}</div>
        <StatusPill status={l.status} />
      </div>
      {admin && <div className="ct-nama"><User size={12} /> {l.nama}</div>}
      <div className="ct-tgl"><CalendarDays size={13} /> {fmtTanggalPendek(l.mulai)}{l.selesai !== l.mulai ? ` – ${fmtTanggalPendek(l.selesai)}` : ""}</div>
      <div className="ct-alasan">{l.alasan}</div>
      {admin && l.status === "menunggu" && (
        <div className="ct-actions">
          <button className="act tolak" onClick={() => onPutusan(l.id, "ditolak")}><XCircle size={15} /> Tolak</button>
          <button className="act setuju" onClick={() => onPutusan(l.id, "disetujui")}><CheckCircle2 size={15} /> Setujui</button>
        </div>
      )}
      {admin && l.status !== "menunggu" && (
        <button className="act-del" onClick={() => onDelete(l.id)}><Trash2 size={13} /> Hapus</button>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    menunggu: { t: "Menunggu", c: "wait", I: Hourglass },
    disetujui: { t: "Disetujui", c: "ok", I: CheckCircle2 },
    ditolak: { t: "Ditolak", c: "no", I: XCircle },
  };
  const s = map[status] || map.menunggu; const I = s.I;
  return <span className={`pill ${s.c}`}><I size={11} /> {s.t}</span>;
}

/* ---------------- FORM CUTI ---------------- */
function CutiForm({ onClose, onSubmit }) {
  const [tipe, setTipe] = useState("cuti");
  const [mulai, setMulai] = useState(todayKey());
  const [selesai, setSelesai] = useState(todayKey());
  const [alasan, setAlasan] = useState("");
  const valid = alasan.trim().length >= 5 && mulai && selesai && selesai >= mulai;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top"><h3>Ajukan Cuti / Izin</h3><button className="x" onClick={onClose}><X size={18} /></button></div>
        <label className="fld-lbl">Jenis</label>
        <div className="tipe-grid">
          {LEAVE_TYPES.map((t) => { const Ic = t.icon; return (
            <button key={t.id} className={`tipe-opt ${tipe === t.id ? "on" : ""}`} onClick={() => setTipe(t.id)}><Ic size={16} /> {t.label}</button>
          ); })}
        </div>
        <div className="fld-row">
          <div><label className="fld-lbl">Mulai</label><input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} className="inp" /></div>
          <div><label className="fld-lbl">Selesai</label><input type="date" value={selesai} min={mulai} onChange={(e) => setSelesai(e.target.value)} className="inp" /></div>
        </div>
        <label className="fld-lbl">Alasan</label>
        <textarea className="inp ta" rows={3} value={alasan} placeholder="Tuliskan alasan…" onChange={(e) => setAlasan(e.target.value)} />
        <button className={`big-btn masuk ${!valid ? "off" : ""}`} disabled={!valid} onClick={() => onSubmit({ tipe, mulai, selesai, alasan: alasan.trim() })}>Kirim Pengajuan</button>
      </div>
    </div>
  );
}

/* ---------------- ADMIN: MONITORING ---------------- */
function AdminMonitoring({ list, onAdd, onEdit, onDelete, onView, onExport }) {
  const [tgl, setTgl] = useState(todayKey());
  const [q, setQ] = useState("");
  const dateRecs = list.filter((a) => a.tanggal === tgl);
  const tampil = dateRecs.filter((a) => !q || (a.nama || "").toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <div className="page-head">
        <h2 className="page-title">Monitoring</h2>
        <div className="head-btns">
          <button className="ghost-btn" onClick={onExport}><Download size={14} /> Export</button>
          <button className="add-btn" onClick={onAdd}><Plus size={14} /> Tambah</button>
        </div>
      </div>
      <input type="date" className="inp" value={tgl} onChange={(e) => setTgl(e.target.value)} />
      <div className="stat-row">
        <Stat n={dateRecs.length} l="Hadir" c="primary" />
        <Stat n={dateRecs.filter((a) => a.terlambat).length} l="Terlambat" c="amber" />
        <Stat n={dateRecs.filter((a) => a.pulang).length} l="Pulang" c="ink" />
      </div>
      <div className="search-box"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama karyawan…" /></div>
      {!tampil.length ? <Empty icon={ClipboardList} teks="Tidak ada data pada tanggal ini." /> : tampil.map((a) => (
        <div key={a.id} className="mon-card">
          <button className="mon-main tap" onClick={() => onView(a)}>
            {a.foto ? <img src={a.foto} alt="" className="mon-foto" /> : <div className="adm-ava">{initials(a.nama)}</div>}
            <div className="adm-info">
              <div className="adm-nama">{a.nama}</div>
              <div className="adm-sub">{a.divisi || "—"} · masuk {a.masuk?.jam || "--:--"}{a.pulang ? ` · pulang ${a.pulang.jam}` : ""}</div>
              {(a.masuk?.lat != null) && <div className="adm-loc"><MapPin size={10} /> {a.masuk.lat.toFixed(4)}, {a.masuk.lng.toFixed(4)}</div>}
            </div>
            {a.terlambat ? <span className="badge late">Telat</span> : <span className="badge ok">Tepat</span>}
          </button>
          <div className="mon-actions">
            <button className="icon-btn" onClick={() => onEdit(a)} title="Edit"><Pencil size={15} /></button>
            <button className="icon-btn danger" onClick={() => onDelete(a.id)} title="Hapus"><Trash2 size={15} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
function Stat({ n, l, c }) { return <div className={`stat ${c}`}><div className="stat-n">{n}</div><div className="stat-l">{l}</div></div>; }

/* ---------------- DETAIL ABSENSI (foto + lokasi) ---------------- */
function DetailAbsen({ rec, onClose }) {
  const mapsUrl = (p) => `https://www.google.com/maps?q=${p.lat},${p.lng}`;
  const LocBlock = ({ label, jam, loc }) => (
    <div className="det-sesi">
      <div className="det-sesi-head"><span className="det-lbl">{label}</span><b>{jam || "--:--"}</b></div>
      {loc && loc.lat != null ? (
        <a className="maps-btn" href={mapsUrl(loc)} target="_blank" rel="noreferrer">
          <MapPin size={14} /> {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)} · Buka di Maps
        </a>
      ) : <div className="det-noloc"><MapPin size={13} /> Lokasi tidak tersedia</div>}
    </div>
  );
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top"><h3>Detail Absensi</h3><button className="x" onClick={onClose}><X size={18} /></button></div>
        <div className="det-id">
          <div className="adm-nama">{rec.nama}</div>
          <div className="adm-sub">{[rec.nip, rec.divisi].filter(Boolean).join(" · ") || "—"} · {fmtTanggalPendek(rec.tanggal)}</div>
        </div>
        {rec.foto
          ? <img src={rec.foto} alt="selfie" className="det-foto" />
          : <div className="det-nofoto"><ImageIcon size={28} /><span>Tanpa foto (input manual)</span></div>}
        <div className="det-status">
          {rec.terlambat ? <span className="badge late"><AlertTriangle size={11} /> Terlambat</span> : <span className="badge ok"><CheckCircle2 size={11} /> Tepat waktu</span>}
          {pulangCepat(rec.pulang?.jam) && <span className="badge late"><AlertTriangle size={11} /> Pulang cepat</span>}
        </div>
        <LocBlock label="Masuk" jam={rec.masuk?.jam} loc={rec.masuk} />
        <LocBlock label="Pulang" jam={rec.pulang?.jam} loc={rec.pulang} />
      </div>
    </div>
  );
}

/* ---------------- MODAL TAMBAH/EDIT ABSEN ---------------- */
function AbsenModal({ rec, profiles, onClose, onSave }) {
  const edit = !!rec;
  const [userId, setUserId] = useState(rec?.userId || profiles[0]?.id || "");
  const [tanggal, setTanggal] = useState(rec?.tanggal || todayKey());
  const [masuk, setMasuk] = useState(rec?.masuk?.jam || "08:00");
  const [pulang, setPulang] = useState(rec?.pulang?.jam || "");
  const prof = profiles.find((p) => p.id === userId);
  const valid = userId && tanggal && masuk;
  const save = () => onSave({
    id: rec?.id, user_id: userId, nama: prof?.nama, nip: prof?.nip, divisi: prof?.divisi,
    tanggal, masuk_jam: masuk || null, pulang_jam: pulang || null, terlambat: masuk ? masuk > JAM_MASUK : false,
  });
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top"><h3>{edit ? "Edit Absensi" : "Tambah Absensi"}</h3><button className="x" onClick={onClose}><X size={18} /></button></div>
        <label className="fld-lbl">Karyawan</label>
        {edit ? <div className="inp readonly">{rec.nama}</div> : (
          <select className="inp" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.nama} {p.nip ? `(${p.nip})` : ""}</option>)}
          </select>
        )}
        <label className="fld-lbl">Tanggal</label>
        <input type="date" className="inp" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        <div className="fld-row">
          <div><label className="fld-lbl">Jam Masuk</label><input type="time" className="inp" value={masuk} onChange={(e) => setMasuk(e.target.value)} /></div>
          <div><label className="fld-lbl">Jam Pulang</label><input type="time" className="inp" value={pulang} onChange={(e) => setPulang(e.target.value)} /></div>
        </div>
        {masuk && (masuk > JAM_MASUK
          ? <div className="hint-box late"><AlertTriangle size={13} /> Lebih dari {JAM_MASUK} → ditandai terlambat</div>
          : <div className="hint-box ok"><CheckCircle2 size={13} /> Tepat waktu (≤ {JAM_MASUK})</div>)}
        <button className={`big-btn masuk ${!valid ? "off" : ""}`} disabled={!valid} onClick={save}>{edit ? "Simpan Perubahan" : "Tambah Data"}</button>
      </div>
    </div>
  );
}

/* ---------------- ADMIN: KARYAWAN ---------------- */
function AdminKaryawan({ profiles, attendance, onEdit, onAdd }) {
  const [q, setQ] = useState("");
  const list = profiles.filter((p) => !q || (p.nama || "").toLowerCase().includes(q.toLowerCase()));
  const hadirHariIni = (id) => attendance.some((a) => a.userId === id && a.tanggal === todayKey());
  return (
    <div className="page">
      <div className="page-head">
        <h2 className="page-title">Manajemen Karyawan</h2>
        <button className="add-btn" onClick={onAdd}><Plus size={14} /> Tambah</button>
      </div>
      <div className="search-box"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama…" /></div>
      {!list.length ? <Empty icon={Users} teks="Belum ada karyawan." /> : list.map((p) => (
        <div key={p.id} className="mon-card">
          <div className="mon-main">
            <div className="adm-ava">{initials(p.nama)}</div>
            <div className="adm-info">
              <div className="adm-nama">{p.nama} {p.role === "admin" && <span className="mini-pill">Admin</span>}</div>
              <div className="adm-sub">{[p.nip, p.divisi].filter(Boolean).join(" · ") || "—"}</div>
            </div>
            {hadirHariIni(p.id) ? <span className="badge ok">Hadir</span> : <span className="badge off-b">Belum</span>}
          </div>
          <div className="mon-actions">
            <button className="icon-btn" onClick={() => onEdit(p)} title="Edit"><Pencil size={15} /></button>
          </div>
        </div>
      ))}
      <div className="info-note">Tambahkan karyawan lewat tombol <b>Tambah</b> (akun langsung jadi & bisa login), atau biarkan mereka mendaftar sendiri di halaman <b>Daftar</b>. Ketuk <b>edit</b> untuk ubah data & peran.</div>
    </div>
  );
}

/* ---------------- MODAL EDIT PROFIL ---------------- */
function ProfilModal({ prof, onClose, onSave }) {
  const [nama, setNama] = useState(prof.nama || "");
  const [nip, setNip] = useState(prof.nip || "");
  const [divisi, setDivisi] = useState(prof.divisi || "");
  const [role, setRole] = useState(prof.role || "karyawan");
  const valid = nama.trim().length >= 2;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top"><h3>Edit Karyawan</h3><button className="x" onClick={onClose}><X size={18} /></button></div>
        <label className="fld-lbl">Nama lengkap</label>
        <input className="inp" value={nama} onChange={(e) => setNama(e.target.value)} />
        <div className="fld-row">
          <div><label className="fld-lbl">NIP</label><input className="inp" value={nip} onChange={(e) => setNip(e.target.value)} /></div>
          <div><label className="fld-lbl">Divisi</label><input className="inp" value={divisi} onChange={(e) => setDivisi(e.target.value)} /></div>
        </div>
        <label className="fld-lbl">Peran</label>
        <div className="tipe-grid">
          <button className={`tipe-opt ${role === "karyawan" ? "on" : ""}`} onClick={() => setRole("karyawan")}><User size={16} /> Karyawan</button>
          <button className={`tipe-opt ${role === "admin" ? "on" : ""}`} onClick={() => setRole("admin")}><ShieldCheck size={16} /> Admin</button>
        </div>
        <button className={`big-btn masuk ${!valid ? "off" : ""}`} disabled={!valid} onClick={() => onSave(prof.id, { nama: nama.trim(), nip, divisi, role })}>Simpan</button>
      </div>
    </div>
  );
}

/* ---------------- MODAL KARYAWAN BARU ---------------- */
function KaryawanBaruModal({ onClose, onSave }) {
  const [nama, setNama] = useState("");
  const [nip, setNip] = useState("");
  const [divisi, setDivisi] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [role, setRole] = useState("karyawan");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const valid = nama.trim().length >= 2 && email.includes("@") && pass.length >= 6;

  const submit = async () => {
    setBusy(true); setMsg("");
    const err = await onSave({ nama: nama.trim(), nip, divisi, email: email.trim(), password: pass, role });
    if (err) { setMsg(err); setBusy(false); } // sukses → modal ditutup oleh induk
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top"><h3>Tambah Karyawan</h3><button className="x" onClick={onClose}><X size={18} /></button></div>
        <label className="fld-lbl">Nama lengkap</label>
        <input className="inp" value={nama} onChange={(e) => setNama(e.target.value)} placeholder="cth. Siti Rahma" />
        <div className="fld-row">
          <div><label className="fld-lbl">NIP</label><input className="inp" value={nip} onChange={(e) => setNip(e.target.value)} placeholder="EMP-1011" /></div>
          <div><label className="fld-lbl">Divisi</label><input className="inp" value={divisi} onChange={(e) => setDivisi(e.target.value)} placeholder="Keuangan" /></div>
        </div>
        <label className="fld-lbl">Email (untuk login)</label>
        <div className="inp-ic"><Mail size={15} /><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@email.com" type="email" /></div>
        <label className="fld-lbl">Kata sandi awal</label>
        <div className="inp-ic"><Lock size={15} /><input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="min. 6 karakter" type="text" /></div>
        <label className="fld-lbl">Peran</label>
        <div className="tipe-grid">
          <button className={`tipe-opt ${role === "karyawan" ? "on" : ""}`} onClick={() => setRole("karyawan")}><User size={16} /> Karyawan</button>
          <button className={`tipe-opt ${role === "admin" ? "on" : ""}`} onClick={() => setRole("admin")}><ShieldCheck size={16} /> Admin</button>
        </div>
        {msg && <div className="auth-msg">{msg}</div>}
        <button className={`big-btn masuk ${!valid || busy ? "off" : ""}`} disabled={!valid || busy} onClick={submit}>
          {busy ? <RefreshCw size={18} className="spin" /> : <Plus size={18} />} Buat Akun Karyawan
        </button>
        <div className="req-note">Sampaikan email & kata sandi awal ini ke karyawan agar bisa login.</div>
      </div>
    </div>
  );
}

/* ---------------- ADMIN: CUTI ---------------- */
function AdminCuti({ list, onPutusan, onDelete }) {
  const menunggu = list.filter((l) => l.status === "menunggu");
  const lain = list.filter((l) => l.status !== "menunggu");
  return (
    <div className="page">
      <h2 className="page-title">Pengajuan Cuti / Izin</h2>
      {menunggu.length > 0 && <div className="sec-lbl"><Hourglass size={13} /> Menunggu persetujuan ({menunggu.length})</div>}
      {menunggu.map((l) => <CutiCard key={l.id} l={l} admin onPutusan={onPutusan} onDelete={onDelete} />)}
      {lain.length > 0 && <div className="sec-lbl">Riwayat</div>}
      {lain.map((l) => <CutiCard key={l.id} l={l} admin onPutusan={onPutusan} onDelete={onDelete} />)}
      {!list.length && <Empty icon={CalendarDays} teks="Belum ada pengajuan." />}
    </div>
  );
}

/* ---------------- shared ---------------- */
function Empty({ icon: Ic, teks }) { return <div className="empty"><Ic size={30} /><p>{teks}</p></div>; }
function Loader({ inline }) { return <div className={`center-load ${inline ? "inline" : ""}`}><RefreshCw className="spin" size={26} /><span>Memuat…</span></div>; }
function ConfigWarning() {
  return (
    <div className="cfg">
      <AlertTriangle size={34} />
      <h3>Supabase belum dikonfigurasi</h3>
      <p>Isi <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code> di <code>.env</code> (lokal) atau di Environment Variables Vercel, lalu redeploy.</p>
    </div>
  );
}
function Frame({ children }) { return <div className="stage"><div className="device"><div className="screen">{children}</div></div></div>; }

/* ============================================================ STYLES ============================================================ */
function Styles() {
  return (
    <style>{`
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root{
      --font:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","SF Pro Icons","Helvetica Neue",Helvetica,Arial,sans-serif;
      --bg:#F5F6F8; --card:#FFFFFF; --ink:#1A1D21; --ink2:#3A4046; --muted:#959BA5; --line:#ECEEF1;
      --green:#15663F; --green-d:#0C4A2E; --green-l:#E7F1EC;
      --gold:#C49A3F; --gold-d:#8A6420;
      --amber:#D08A1E; --amber-l:#FBF1DE; --red:#E1493D; --red-l:#FCEBE9;
    }
    .stage{ font-family:var(--font); color:var(--ink); min-height:100dvh; display:flex; -webkit-font-smoothing:antialiased; }
    .device{ width:100%; min-height:100dvh; background:var(--bg); }
    .screen{ width:100%; min-height:100dvh; background:var(--bg); display:flex; flex-direction:column; position:relative; overflow:hidden; }
    @media (min-width:600px){
      .stage{ justify-content:center; align-items:flex-start; padding:18px 10px 40px;
        background:radial-gradient(circle at 15% 0%, #E7F1FB 0, transparent 42%), radial-gradient(circle at 92% 96%, #EDE9FB 0, transparent 38%), #EDEFF2; }
      .device{ width:418px; min-height:auto; height:812px; background:#1c2126; border-radius:46px; padding:11px; box-shadow:0 32px 60px -20px rgba(30,40,55,.4), inset 0 0 0 2px #2c333b; }
      .screen{ min-height:auto; height:100%; border-radius:36px; }
    }
    .screen::before{ content:""; position:absolute; top:-60px; right:-40px; width:200px; height:200px; border-radius:50%;
      background:radial-gradient(circle, rgba(21,102,63,.10), transparent 70%); pointer-events:none; }
    .hdr{ position:relative; z-index:1; background:var(--card); color:var(--ink); padding:max(16px,env(safe-area-inset-top)) 18px 16px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; }
    @media (min-width:600px){ .hdr{ padding:18px 18px 16px; } }
    .brand-wrap{ display:flex; align-items:center; gap:10px; }
    .logo-mark{ width:38px; height:38px; border-radius:12px; background:var(--green-l); color:var(--green-d); display:grid; place-items:center; }
    .brand-txt b{ display:block; font-size:18px; font-weight:800; letter-spacing:-.4px; line-height:1.05; color:var(--green-d); }
    .brand-txt span{ font-size:9.5px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; color:var(--muted); }
    .hdr-right{ display:flex; align-items:center; gap:8px; }
    .role-pill{ display:flex; align-items:center; gap:4px; background:var(--green-l); color:var(--green-d); padding:5px 10px; border-radius:30px; font-size:11px; font-weight:600; }
    .avatar{ width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg,#1A7A4D,var(--green-d)); color:#fff; display:grid; place-items:center; font-weight:700; font-size:13px; }
    .logout-btn{ background:var(--bg); border:1px solid var(--line); color:var(--muted); width:34px; height:34px; border-radius:11px; display:grid; place-items:center; cursor:pointer; }
    .logout-btn:hover{ color:var(--red); background:var(--red-l); border-color:transparent; }

    .err-banner{ display:flex; align-items:center; gap:8px; background:var(--red-l); color:var(--red); padding:10px 16px; font-size:12.5px; font-weight:600; }
    .err-banner button{ margin-left:auto; background:none; border:none; color:var(--red); cursor:pointer; display:grid; place-items:center; }

    .scroll{ flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; }
    .scroll::-webkit-scrollbar{ width:0; }
    .page{ padding:18px 18px 22px; display:flex; flex-direction:column; gap:14px; }
    .page-title{ font-size:20px; font-weight:700; letter-spacing:-.3px; }
    .page-head{ display:flex; justify-content:space-between; align-items:center; }
    .add-btn{ display:flex; align-items:center; gap:4px; background:var(--green); color:#fff; border:none; padding:8px 14px; border-radius:20px; font-weight:600; font-size:13px; cursor:pointer; font-family:inherit; }
    .head-btns{ display:flex; gap:8px; }
    .ghost-btn{ display:flex; align-items:center; gap:4px; background:var(--card); color:var(--ink2); border:1px solid var(--line); padding:8px 12px; border-radius:20px; font-weight:600; font-size:13px; cursor:pointer; font-family:inherit; }
    .ghost-btn:hover{ background:var(--green-l); color:var(--green-d); border-color:transparent; }

    .greet-line{ font-size:14.5px; color:var(--muted); font-weight:500; }
    .greet-line b{ color:var(--ink); font-weight:700; }
    .home{ gap:16px; }
    .home-clock{ text-align:center; padding:10px 0 2px; }
    .hc-time{ font-size:52px; font-weight:800; letter-spacing:-2px; line-height:1; color:var(--ink); }
    .hc-sec{ font-size:22px; font-weight:600; color:var(--muted); letter-spacing:0; }
    .hc-sched{ display:inline-flex; align-items:center; gap:5px; margin-top:8px; font-size:11.5px; font-weight:600; color:var(--green-d); background:var(--green-l); padding:4px 10px; border-radius:20px; }
    .hc-date{ font-size:14px; font-weight:700; color:var(--ink2); margin-top:8px; }

    .hero-btn{ width:208px; height:208px; align-self:center; border:none; border-radius:42px; color:#fff; cursor:pointer;
      display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; margin:6px auto 2px; font-family:inherit; transition:transform .15s; }
    .hero-btn:active{ transform:scale(.97); }
    .hero-btn.in{ background:linear-gradient(155deg,#2E9E63 0%,#0E4A2D 100%); box-shadow:0 24px 46px -16px rgba(21,102,63,.7); }
    .hero-btn.out{ background:linear-gradient(155deg,#CDA040 0%,#8A6420 100%); box-shadow:0 24px 46px -16px rgba(160,120,40,.6); }
    .hero-ring{ width:68px; height:68px; border-radius:50%; border:2.5px solid rgba(255,255,255,.75); display:grid; place-items:center; }
    .hero-label{ font-size:18px; font-weight:700; letter-spacing:-.2px; }
    .hero-done{ align-self:center; width:208px; height:208px; border-radius:42px; background:var(--green-l); color:var(--green-d);
      display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; font-weight:700; font-size:15px; text-align:center; padding:20px; margin:6px auto 2px; }

    .stat3{ display:flex; gap:8px; }
    .s3{ flex:1; display:flex; flex-direction:column; align-items:center; gap:7px; }
    .s3-ic{ width:48px; height:48px; border-radius:50%; border:1.5px solid var(--line); background:var(--card); color:var(--green-d); display:grid; place-items:center; }
    .s3-val{ font-size:16px; font-weight:800; color:var(--ink); letter-spacing:-.3px; }
    .s3-lbl{ font-size:11px; color:var(--muted); font-weight:500; }
    .late-note{ display:flex; align-items:center; justify-content:center; gap:7px; background:var(--amber-l); color:var(--amber); padding:9px; border-radius:12px; font-size:12px; font-weight:600; }

    .badge{ display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:600; padding:3px 9px; border-radius:20px; white-space:nowrap; }
    .badge.ok{ background:var(--green-l); color:var(--green-d); }
    .badge.late{ background:var(--amber-l); color:var(--amber); }
    .badge.off-b{ background:#EFEDE6; color:var(--muted); }

    .big-btn{ display:flex; align-items:center; justify-content:center; gap:10px; width:100%; border:none; padding:17px; border-radius:18px; font-size:16.5px; font-weight:700; cursor:pointer; color:#fff; font-family:inherit; transition:transform .12s, box-shadow .2s; margin-top:4px; }
    .big-btn:active{ transform:scale(.98); }
    .big-btn.masuk{ background:linear-gradient(135deg,var(--green),var(--green-d)); box-shadow:0 12px 24px -10px rgba(31,111,84,.7); }
    .big-btn.pulang{ background:linear-gradient(135deg,#C98A2B,#A66E1C); box-shadow:0 12px 24px -10px rgba(201,138,43,.6); }
    .big-btn.off{ opacity:.45; cursor:not-allowed; box-shadow:none; }
    .done-card{ display:flex; align-items:center; gap:10px; background:var(--green-l); color:var(--green-d); padding:16px; border-radius:18px; font-weight:600; font-size:14px; }
    .hint{ display:flex; align-items:center; justify-content:center; gap:6px; color:var(--muted); font-size:11.5px; margin-top:2px; }

    .rw-sec{ background:var(--card); border:1px solid var(--line); border-radius:18px; overflow:hidden; }
    .rw-sec-head{ display:flex; align-items:center; gap:8px; padding:13px 15px; font-weight:700; font-size:14px; border-bottom:1px solid var(--line); }
    .rw-sec-head.in{ color:var(--green-d); }
    .rw-sec-head.out{ color:var(--gold-d); }
    .rw-thead{ display:grid; grid-template-columns:1fr auto auto; gap:12px; padding:8px 15px; font-size:10.5px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:var(--muted); background:#FAFBFC; }
    .rw-row{ display:grid; grid-template-columns:1fr auto auto; gap:12px; align-items:center; padding:11px 15px; border-top:1px solid var(--line); }
    .rw-thead span:nth-child(2), .rw-row > :nth-child(2),
    .rw-thead span:nth-child(3), .rw-row > :nth-child(3){ text-align:right; justify-self:end; }
    .rw-date2{ display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; color:var(--ink2); }
    .rw-jam{ font-size:15px; font-weight:800; font-variant-numeric:tabular-nums; }
    .rw-empty{ padding:18px 15px; text-align:center; color:var(--muted); font-size:12.5px; }

    .ct-card{ background:var(--card); border:1px solid var(--line); border-radius:18px; padding:15px; display:flex; flex-direction:column; gap:9px; }
    .ct-top{ display:flex; justify-content:space-between; align-items:center; }
    .ct-tipe{ display:flex; align-items:center; gap:9px; font-weight:700; font-size:14.5px; }
    .ct-ic{ width:30px; height:30px; border-radius:10px; background:var(--green-l); color:var(--green-d); display:grid; place-items:center; }
    .ct-nama{ display:flex; align-items:center; gap:5px; font-size:12.5px; color:var(--muted); font-weight:600; }
    .ct-tgl{ display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--muted); }
    .ct-alasan{ font-size:13.5px; line-height:1.5; color:#39433c; }
    .ct-actions{ display:flex; gap:9px; margin-top:3px; }
    .act{ flex:1; display:flex; align-items:center; justify-content:center; gap:6px; padding:10px; border-radius:12px; font-weight:600; font-size:13.5px; cursor:pointer; border:1px solid var(--line); font-family:inherit; }
    .act.setuju{ background:var(--green); color:#fff; border-color:var(--green); }
    .act.tolak{ background:var(--red-l); color:var(--red); border-color:transparent; }
    .act-del{ display:flex; align-items:center; justify-content:center; gap:6px; background:none; border:none; color:var(--muted); font-size:12px; font-weight:600; cursor:pointer; font-family:inherit; padding:4px; }
    .act-del:hover{ color:var(--red); }

    .pill{ display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:700; padding:4px 10px; border-radius:20px; }
    .pill.wait{ background:var(--amber-l); color:var(--amber); }
    .pill.ok{ background:var(--green-l); color:var(--green-d); }
    .pill.no{ background:var(--red-l); color:var(--red); }
    .mini-pill{ font-size:9.5px; font-weight:700; background:var(--green-l); color:var(--green-d); padding:2px 7px; border-radius:20px; vertical-align:middle; margin-left:6px; }

    .stat-row{ display:flex; gap:10px; }
    .stat{ flex:1; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:13px; text-align:center; }
    .stat-n{ font-size:26px; font-weight:800; letter-spacing:-.5px; }
    .stat-l{ font-size:11.5px; color:var(--muted); font-weight:500; margin-top:2px; }
    .stat.primary .stat-n{ color:var(--green); } .stat.amber .stat-n{ color:var(--amber); }

    .search-box{ display:flex; align-items:center; gap:8px; background:var(--card); border:1.5px solid var(--line); border-radius:12px; padding:0 12px; color:var(--muted); }
    .search-box:focus-within{ border-color:var(--green); }
    .search-box input{ flex:1; border:none; outline:none; padding:11px 0; font-size:13.5px; font-family:inherit; background:transparent; color:var(--ink); }

    .mon-card{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:12px 14px; display:flex; align-items:center; gap:10px; }
    .mon-main{ display:flex; align-items:center; gap:11px; flex:1; min-width:0; background:none; border:none; font-family:inherit; text-align:left; padding:0; cursor:default; color:inherit; }
    .mon-main.tap{ cursor:pointer; }
    .mon-foto{ width:38px; height:38px; border-radius:12px; object-fit:cover; flex-shrink:0; }
    .adm-loc{ display:flex; align-items:center; gap:4px; font-size:10.5px; color:var(--muted); margin-top:2px; }
    .det-id{ text-align:center; } .det-id .adm-nama{ font-size:16px; } .det-id .adm-sub{ white-space:normal; }
    .det-foto{ width:170px; height:170px; border-radius:20px; object-fit:cover; align-self:center; border:1px solid var(--line); }
    .det-nofoto{ width:170px; height:170px; border-radius:20px; align-self:center; background:var(--card); border:1px dashed var(--line); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; color:var(--muted); font-size:11.5px; }
    .det-status{ display:flex; justify-content:center; gap:8px; flex-wrap:wrap; }
    .det-sesi{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px 14px; display:flex; flex-direction:column; gap:9px; }
    .det-sesi-head{ display:flex; justify-content:space-between; align-items:center; }
    .det-sesi-head b{ font-size:17px; font-weight:700; }
    .det-lbl{ font-size:12.5px; color:var(--muted); font-weight:600; }
    .maps-btn{ display:flex; align-items:center; gap:7px; background:var(--green-l); color:var(--green-d); text-decoration:none; padding:10px 12px; border-radius:11px; font-size:12.5px; font-weight:600; }
    .maps-btn:hover{ background:#D8EBE2; }
    .det-noloc{ display:flex; align-items:center; gap:7px; color:var(--muted); font-size:12px; padding:4px 0; }
    .mon-actions{ display:flex; gap:6px; }
    .adm-ava{ width:38px; height:38px; border-radius:12px; background:var(--green-l); color:var(--green-d); display:grid; place-items:center; font-weight:700; font-size:13px; flex-shrink:0; }
    .adm-info{ flex:1; min-width:0; } .adm-nama{ font-weight:700; font-size:13.5px; } .adm-sub{ font-size:11px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .icon-btn{ width:34px; height:34px; border-radius:10px; border:1px solid var(--line); background:var(--card); color:var(--muted); display:grid; place-items:center; cursor:pointer; transition:all .15s; }
    .icon-btn:hover{ background:var(--green-l); color:var(--green-d); border-color:transparent; }
    .icon-btn.danger:hover{ background:var(--red-l); color:var(--red); }
    .info-note{ font-size:11.5px; color:var(--muted); line-height:1.6; background:var(--card); border:1px dashed var(--line); border-radius:14px; padding:12px 14px; }

    .sec-lbl{ display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; color:var(--muted); margin-top:4px; }

    .nav{ display:flex; background:var(--card); border-top:1px solid var(--line); padding:9px 8px max(14px,env(safe-area-inset-bottom)); }
    @media (min-width:600px){ .nav{ padding:9px 8px 14px; } }
    .nav-btn{ flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; background:none; border:none; color:var(--muted); font-size:11px; font-weight:600; cursor:pointer; font-family:inherit; transition:color .2s; padding:4px; }
    .nav-btn.on{ color:var(--green); }

    .modal-bg{ position:absolute; inset:0; background:rgba(15,25,20,.5); backdrop-filter:blur(3px); display:flex; align-items:flex-end; z-index:50; animation:fade .2s; }
    .modal{ background:var(--bg); width:100%; border-radius:28px 28px 0 0; padding:20px 18px max(24px,env(safe-area-inset-bottom)); display:flex; flex-direction:column; gap:12px; max-height:92%; overflow-y:auto; animation:up .26s cubic-bezier(.2,.8,.2,1); }
    .modal.cap{ gap:10px; }
    .modal-top{ display:flex; justify-content:space-between; align-items:center; }
    .modal-top h3{ font-size:18px; font-weight:700; letter-spacing:-.3px; }
    .x{ background:rgba(0,0,0,.06); border:none; border-radius:10px; padding:6px; cursor:pointer; color:var(--ink); display:grid; place-items:center; }

    .cam-wrap{ position:relative; width:180px; height:180px; border-radius:50%; overflow:hidden; align-self:center; background:#0c130f; display:grid; place-items:center; border:3px solid var(--line); }
    .cam-wrap.done{ border-color:var(--green); }
    .cam-video{ width:100%; height:100%; object-fit:cover; transform:scaleX(-1); }
    .cam-shot{ width:100%; height:100%; object-fit:cover; }
    .face-ring{ position:absolute; inset:18px; border:2px dashed rgba(255,255,255,.5); border-radius:50%; pointer-events:none; }
    .cam-fallback{ color:#cfd6d0; text-align:center; padding:14px; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:11px; }
    .face-hint{ display:flex; align-items:center; justify-content:center; gap:6px; color:var(--muted); font-size:12px; font-weight:500; }
    .face-ok{ display:flex; align-items:center; justify-content:center; gap:6px; color:var(--green-d); font-size:12.5px; font-weight:600; }
    .face-err{ display:flex; align-items:center; gap:7px; background:var(--red-l); color:var(--red); padding:9px 12px; border-radius:11px; font-size:12px; font-weight:600; }
    .req-note{ text-align:center; color:var(--muted); font-size:11px; }
    .mini-btn{ display:inline-flex; align-items:center; gap:6px; align-self:center; background:var(--green); color:#fff; border:none; padding:9px 16px; border-radius:22px; font-weight:600; font-size:13px; cursor:pointer; font-family:inherit; }
    .mini-btn.off{ opacity:.5; cursor:not-allowed; }
    .mini-btn.ghost{ background:rgba(0,0,0,.06); color:var(--ink); }
    .mini-btn.shoot{ margin-top:2px; }

    .loc-box{ display:flex; align-items:center; gap:8px; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px 14px; font-size:12.5px; font-weight:500; color:var(--muted); }
    .loc-box.ok{ background:var(--green-l); border-color:transparent; color:var(--green-d); }
    .loc-box.warn{ background:var(--amber-l); border-color:transparent; color:var(--amber); }

    .fld-lbl{ font-size:12.5px; font-weight:600; color:var(--muted); }
    .tipe-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .tipe-opt{ display:flex; align-items:center; gap:8px; padding:11px 12px; border-radius:13px; cursor:pointer; border:1.5px solid var(--line); background:var(--card); font-size:12.5px; font-weight:600; color:var(--ink); font-family:inherit; }
    .tipe-opt.on{ border-color:var(--green); background:var(--green-l); color:var(--green-d); }
    .fld-row{ display:flex; gap:10px; } .fld-row > div{ flex:1; display:flex; flex-direction:column; gap:5px; }
    .inp{ width:100%; border:1.5px solid var(--line); border-radius:12px; padding:11px 12px; font-size:13.5px; font-family:inherit; background:var(--card); color:var(--ink); }
    .inp:focus{ outline:none; border-color:var(--green); }
    select.inp{ appearance:none; -webkit-appearance:none; }
    .inp.readonly{ background:#F3F1EA; color:var(--muted); }
    .ta{ resize:none; }
    .inp-ic{ display:flex; align-items:center; gap:8px; border:1.5px solid var(--line); border-radius:12px; padding:0 12px; background:var(--card); color:var(--muted); }
    .inp-ic:focus-within{ border-color:var(--green); }
    .inp-ic input{ flex:1; border:none; outline:none; padding:11px 0; font-size:13.5px; font-family:inherit; background:transparent; color:var(--ink); }
    .hint-box{ display:flex; align-items:center; gap:7px; font-size:12px; font-weight:600; padding:9px 12px; border-radius:11px; }
    .hint-box.ok{ background:var(--green-l); color:var(--green-d); }
    .hint-box.late{ background:var(--amber-l); color:var(--amber); }

    .empty{ text-align:center; color:#A9B2AC; padding:50px 20px; display:flex; flex-direction:column; align-items:center; gap:12px; }
    .empty p{ font-size:13.5px; }
    .center-load{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; color:var(--muted); min-height:100dvh; }
    .center-load.inline{ min-height:240px; }
    .spin{ animation:spin 1s linear infinite; }

    .auth-wrap{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:28px 22px; gap:4px; min-height:100dvh; }
    .logo-img{ height:36px; width:auto; display:block; }
    .auth-logo{ height:86px; width:auto; margin-bottom:8px; }
    .auth-brand{ font-weight:800; font-size:34px; color:var(--green-d); letter-spacing:-1px; }
    .auth-brand .dot{ color:var(--green); }
    .auth-sub{ color:var(--muted); font-size:13.5px; margin-bottom:18px; }
    .auth-card{ width:100%; max-width:360px; background:var(--card); border:1px solid var(--line); border-radius:22px; padding:20px; display:flex; flex-direction:column; gap:10px; box-shadow:0 18px 40px -24px rgba(20,40,30,.35); }
    .auth-tabs{ display:flex; background:var(--bg); border-radius:13px; padding:4px; margin-bottom:4px; }
    .auth-tabs button{ flex:1; border:none; background:none; padding:9px; border-radius:10px; font-weight:600; font-size:13.5px; color:var(--muted); cursor:pointer; font-family:inherit; transition:all .2s; }
    .auth-tabs button.on{ background:var(--card); color:var(--green-d); box-shadow:0 2px 6px -2px rgba(0,0,0,.12); }
    .auth-msg{ background:var(--amber-l); color:var(--amber); border-radius:10px; padding:9px 12px; font-size:12px; font-weight:500; }
    .auth-foot{ color:var(--muted); font-size:11.5px; text-align:center; margin-top:14px; max-width:320px; }

    .cfg{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; text-align:center; padding:30px; color:var(--muted); min-height:100dvh; }
    .cfg h3{ color:var(--ink); font-weight:700; }
    .cfg p{ font-size:13px; line-height:1.6; max-width:320px; }
    .cfg code{ background:var(--green-l); color:var(--green-d); padding:1px 5px; border-radius:5px; font-size:11.5px; }

    @keyframes spin{ to{ transform:rotate(360deg); } }
    @keyframes fade{ from{ opacity:0; } }
    @keyframes up{ from{ transform:translateY(40px); opacity:.5; } }
    `}</style>
  );
}
