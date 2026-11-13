"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { VisitsData } from "../../lib/rpc";

const todayInBangkok = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

// CSV ใส่ BOM เพื่อให้ Excel อ่านภาษาไทยถูก
function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Visits({ load }: { load: (day: string) => Promise<VisitsData | null> }) {
  const [day, setDay] = useState(todayInBangkok);
  const [data, setData] = useState<VisitsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [klass, setKlass] = useState("");

  const refresh = useCallback(
    async (d: string) => {
      setLoading(true);
      const res = await load(d);
      if (res) setData(res);
      setLoading(false);
    },
    [load],
  );

  useEffect(() => {
    refresh(day);
  }, [day, refresh]);

  const classes = useMemo(
    () =>
      Array.from(new Set((data?.items ?? []).map((i) => i.class_name ?? ""))).filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "th", { numeric: true })),
    [data],
  );
  const items = (data?.items ?? []).filter((i) => !klass || i.class_name === klass);
  const blocked = data?.blocked ?? [];

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(`library-visits-${data.day}${klass ? "-" + klass.replace("ม.", "M").replace(/[^A-Za-z0-9]+/g, "-") : ""}.csv`, [
      ["วันที่", "เวลา", "รหัส", "ชื่อ-นามสกุล", "ห้อง", "เลขที่"],
      ...items.map((i) => [data.day, i.time, i.student_id, i.full_name, i.class_name, i.class_no]),
    ]);
  };

  return (
    <section className={`visits${loading ? " stats-loading" : ""}`}>
      <div className="visits-bar">
        <label className="visits-day">
          <span className="label">วันที่</span>
          <input className="field" type="date" value={day} max={todayInBangkok()} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
        <label className="visits-day">
          <span className="label">ห้อง</span>
          <select className="field" value={klass} onChange={(e) => setKlass(e.target.value)}>
            <option value="">ทุกห้อง</option>
            {classes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={() => refresh(day)} disabled={loading}>รีเฟรช</button>
        <button className="btn btn-primary" onClick={exportCsv} disabled={!items.length}>ดาวน์โหลด Excel</button>
      </div>

      {data && (
        <p className="visits-count">
          <strong>{items.length}</strong> คน · {longDate(data.day)}
        </p>
      )}

      {data && items.length > 0 && (
        <div className="table table-visits">
          <div className="thead">
            <span>เวลา</span>
            <span>รหัส</span>
            <span>ชื่อ</span>
            <span>ห้อง</span>
            <span>เลขที่</span>
          </div>
          <ul className="list">
            {items.map((i) => (
              <li key={i.student_id} className="row">
                <span className="v-time">{i.time}</span>
                <span className="v-id">
                  {i.student_id}
                  <span className="v-class-inline">{i.class_name ? ` · ${i.class_name}` : ""}{i.class_no ? ` เลขที่ ${i.class_no}` : ""}</span>
                </span>
                <strong className="v-name">{i.full_name ?? "(ไม่พบชื่อ)"}</strong>
                <span className="v-class">{i.class_name ?? ""}</span>
                <span className="v-no">{i.class_no ?? ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data && items.length === 0 && !loading && <p className="empty">ยังไม่มีนักเรียนเช็กอินในวันนี้</p>}

      {blocked.length > 0 && (
        <div className="panel">
          <h2>นักเรียนในรายชื่อห้ามเข้าที่มาพยายามเช็กอิน ({blocked.length} คน)</h2>
          <ul className="attempts">
            {blocked.map((b) => (
              <li key={b.student_id}>
                <span className="v-time">{b.time}</span>
                <span>
                  <strong>{b.full_name ?? b.student_id}</strong>
                  <span className="muted"> · {b.student_id}{b.class_name ? ` · ${b.class_name}` : ""}{b.tries > 1 ? ` · ${b.tries} ครั้ง` : ""}</span>
                  {b.reason && <span className="reason attempts-reason">{b.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
