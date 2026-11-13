"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { rpc, type CheckInResult } from "../lib/rpc";
import { toScreen, type Screen } from "../lib/messages";

const ID_LENGTH = 5;
const RESULT_MS = 4000; // จอคอม/kiosk เท่านั้น บนมือถือผลค้างไว้ให้ครูดู

export default function Kiosk() {
  const [digits, setDigits] = useState("");
  const [screen, setScreen] = useState<Screen | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const locked = busy || screen !== null;

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    setScreen(null);
    setDigits("");
  }, []);

  const submit = useCallback(async (id: string) => {
    setBusy(true);
    let next: Screen;
    try {
      next = toScreen(await rpc<CheckInResult>("check_in", { p_id: id }));
    } catch {
      next = { tone: "warn", title: "เชื่อมต่อไม่ได้", lines: ["ตรวจอินเทอร์เน็ตแล้วลองใหม่ หรือแจ้งครู"] };
    }
    setBusy(false);
    setScreen(next);
    if (window.matchMedia("(min-width: 900px)").matches) timer.current = setTimeout(reset, RESULT_MS);
  }, [reset]);

  const press = useCallback((d: string) => {
    setDigits((cur) => (cur.length >= ID_LENGTH ? cur : cur + d));
  }, []);

  // ส่งอัตโนมัติเมื่อครบ 5 หลัก
  useEffect(() => {
    if (digits.length === ID_LENGTH && !locked) submit(digits);
  }, [digits, locked, submit]);

  // คีย์บอร์ดและเครื่องสแกนบาร์โค้ด (พิมพ์ตัวเลขเร็วๆ แล้วตามด้วย Enter)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (screen) {
        if (e.key === "Enter" || e.key === "Escape") reset();
        return;
      }
      if (busy) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setDigits((c) => c.slice(0, -1));
      else if (e.key === "Escape") setDigits("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, busy, press, reset]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  if (screen) {
    return (
      <main className={`result result-${screen.tone}`} onClick={reset} role="status" aria-live="assertive">
        <div className="result-body">
          <span className="result-mark" aria-hidden>
            {screen.tone === "ok" ? "✓" : screen.tone === "stop" ? "✕" : "?"}
          </span>
          <h1>{screen.title}</h1>
          {screen.lines.map((l, i) => (
            <p key={i} className={i === 0 ? "result-lead" : undefined}>{l}</p>
          ))}
        </div>
        <div className="result-foot">
          <Clock compact />
          <span className="result-hint">แตะหน้าจอเพื่อกลับ</span>
        </div>
      </main>
    );
  }

  return (
    <main className="kiosk">
      <aside className="kiosk-side">
        <div className="kiosk-title">
          <span className="kicker">ห้องสมุด</span>
          <h1>เช็กอินเข้าใช้</h1>
        </div>
        <Clock />
        <ol className="steps">
          <li>กดรหัสนักเรียน 5 หลัก หรือสแกนบัตร</li>
          <li>ระบบตรวจให้อัตโนมัติเมื่อครบ 5 หลัก</li>
          <li>ดูผลบนจอ แล้วเข้าใช้ได้เลย</li>
        </ol>
        <div className="kiosk-links">
          <button className="link" onClick={fullscreen}>เต็มจอ</button>
          <Link className="link" href="/staff">สำหรับครู</Link>
        </div>
      </aside>

      <section className="kiosk-pad">
        <p className="pad-label">รหัสนักเรียน</p>
        <div className="slots" aria-label={`รหัสที่กด ${digits || "ว่าง"}`}>
          {Array.from({ length: ID_LENGTH }, (_, i) => (
            <span key={i} className={`slot${digits[i] ? " filled" : ""}${i === digits.length && !busy ? " next" : ""}`}>
              {digits[i] ?? ""}
            </span>
          ))}
        </div>
        <p className="kiosk-status">{busy ? "กำลังตรวจสอบ…" : " "}</p>

        <div className="keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} className="key" disabled={locked} onClick={() => press(d)}>{d}</button>
          ))}
          <button className="key key-alt" disabled={locked} onClick={() => setDigits("")}>ล้าง</button>
          <button className="key" disabled={locked} onClick={() => press("0")}>0</button>
          <button className="key key-alt" disabled={locked} onClick={() => setDigits((c) => c.slice(0, -1))} aria-label="ลบ">ลบ</button>
        </div>
      </section>
    </main>
  );
}

function Clock({ compact = false }: { compact?: boolean }) {
  // เริ่มจากค่าว่างเพื่อให้ HTML ฝั่งเซิร์ฟเวอร์กับเบราว์เซอร์ตรงกัน แล้วค่อยเดินเวลาหลังโหลด
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const time = now
    ? now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: compact ? "2-digit" : undefined, hour12: false, timeZone: "Asia/Bangkok" })
    : "--:--";
  const date = now
    ? now.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" })
    : "\u00a0";
  return (
    <div className={compact ? "clock clock-compact" : "clock"}>
      <span className="clock-time">{time}</span>
      <span className="clock-date">{date}</span>
    </div>
  );
}
