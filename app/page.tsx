"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { rpc, type CheckInResult } from "../lib/rpc";
import { toScreen, type Screen } from "../lib/messages";

const ID_LENGTH = 5;
const RESULT_MS = 4000;

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
      next = { tone: "warn", title: "เชื่อมต่อไม่ได้", lines: ["ลองใหม่อีกครั้ง หรือแจ้งครูบรรณารักษ์"] };
    }
    setBusy(false);
    setScreen(next);
    timer.current = setTimeout(reset, RESULT_MS);
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
        <div className="result-mark" aria-hidden>
          {screen.tone === "ok" ? "✓" : screen.tone === "stop" ? "✕" : "?"}
        </div>
        <h1>{screen.title}</h1>
        {screen.lines.map((l, i) => (
          <p key={i} className={i === 0 ? "result-lead" : undefined}>{l}</p>
        ))}
        <span className="result-hint">แตะหน้าจอเพื่อเช็กอินคนถัดไป</span>
      </main>
    );
  }

  return (
    <main className="kiosk">
      <header className="kiosk-top">
        <button className="ghost" onClick={fullscreen}>เต็มจอ</button>
        <Link className="ghost" href="/staff">สำหรับครู</Link>
      </header>

      <section className="kiosk-body">
        <h1>เช็กอินห้องสมุด</h1>
        <p className="kiosk-sub">กดรหัสนักเรียน 5 หลัก</p>

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
          <button className="key key-alt" disabled={locked} onClick={() => setDigits((c) => c.slice(0, -1))} aria-label="ลบ">⌫</button>
        </div>
      </section>
    </main>
  );
}
