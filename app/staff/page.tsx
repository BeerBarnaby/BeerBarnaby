"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rpc, thaiDate, type BlockItem, type StaffResult, type Student } from "../../lib/rpc";

// เหตุผลสำเร็จรูป — แก้รายการนี้ได้ตามที่ห้องสมุดใช้จริง
const PRESET_REASONS = [
  "ค้างส่งหนังสือ",
  "ทำผิดระเบียบห้องสมุด",
  "ส่งเสียงดังรบกวนผู้อื่น",
  "ทำหนังสือหรืออุปกรณ์เสียหาย",
];

const IDLE_LOGOUT_MS = 5 * 60 * 1000;

type Tab = "blocked" | "add";
type Draft = { ids: string[]; reason: string; until: string };

export default function Staff() {
  const [pin, setPin] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [staff, setStaff] = useState("");
  const [items, setItems] = useState<BlockItem[]>([]);
  const [roster, setRoster] = useState<Student[] | null>(null);
  const [tab, setTab] = useState<Tab>("blocked");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [klass, setKlass] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const idle = useRef<ReturnType<typeof setTimeout>>();

  const logout = useCallback((message = "") => {
    setPin(null);
    setPinInput("");
    setItems([]);
    setRoster(null);
    setSelected(new Set());
    setDraft(null);
    setNotice("");
    setError(message);
  }, []);

  // เรียก RPC ของครู: ถ้า PIN ใช้ไม่ได้หรือโดนล็อก ให้กลับไปหน้าใส่ PIN
  const call = useCallback(
    async <T,>(fn: string, args: Record<string, unknown>, withPin: string): Promise<({ ok: true } & T) | null> => {
      setBusy(true);
      setError("");
      try {
        const res = await rpc<StaffResult<T>>(fn, { p_pin: withPin, ...args });
        if (res.ok) return res;
        if (res.locked || res.error === "PIN ไม่ถูกต้อง") logout(res.error);
        else setError(res.error);
        return null;
      } catch (e) {
        setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [logout],
  );

  const loadList = useCallback(
    async (withPin: string) => {
      const res = await call<{ staff: string; items: BlockItem[] }>("staff_list", {}, withPin);
      if (res) {
        setStaff(res.staff);
        setItems(res.items);
      }
      return res !== null;
    },
    [call],
  );

  const loadRoster = useCallback(
    async (withPin: string) => {
      const res = await call<{ items: Student[] }>("staff_students", {}, withPin);
      if (res) setRoster(res.items);
    },
    [call],
  );

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = pinInput.trim();
    if (!candidate) return;
    if (await loadList(candidate)) {
      setPin(candidate);
      setPinInput("");
      setTab("blocked");
    }
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setSelected(new Set());
    setNotice("");
    if (next === "add" && roster === null && pin) loadRoster(pin);
  };

  // ออกจากระบบเองเมื่อไม่มีการใช้งาน เพราะเครื่องนี้นักเรียนใช้ร่วมด้วย
  useEffect(() => {
    if (!pin) return;
    const arm = () => {
      clearTimeout(idle.current);
      idle.current = setTimeout(() => logout("ออกจากระบบอัตโนมัติเพราะไม่มีการใช้งาน"), IDLE_LOGOUT_MS);
    };
    arm();
    const events = ["pointerdown", "keydown"] as const;
    events.forEach((ev) => window.addEventListener(ev, arm));
    return () => {
      clearTimeout(idle.current);
      events.forEach((ev) => window.removeEventListener(ev, arm));
    };
  }, [pin, logout]);

  const classes = useMemo(
    () =>
      Array.from(new Set((roster ?? []).map((s) => s.class_name))).sort((a, b) =>
        a.localeCompare(b, "th", { numeric: true }),
      ),
    [roster],
  );

  const visibleRoster = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (roster ?? []).filter(
      (s) =>
        (!klass || s.class_name === klass) &&
        (!q || s.student_id.includes(q) || s.full_name.toLowerCase().includes(q)),
    );
  }, [roster, klass, query]);

  const nameOf = useCallback(
    (id: string) =>
      items.find((i) => i.student_id === id)?.full_name ??
      roster?.find((s) => s.student_id === id)?.full_name ??
      id,
    [items, roster],
  );

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleIds = tab === "blocked" ? items.map((i) => i.student_id) : visibleRoster.map((s) => s.student_id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAllVisible = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      visibleIds.forEach((id) => (allVisibleSelected ? next.delete(id) : next.add(id)));
      return next;
    });

  const openDraft = (ids: string[]) => {
    const current = ids.length === 1 ? items.find((i) => i.student_id === ids[0]) : undefined;
    setDraft({ ids, reason: current?.reason ?? "", until: current?.until ?? "" });
  };

  const refresh = async (withPin: string) => {
    await loadList(withPin);
    if (roster !== null) await loadRoster(withPin);
  };

  const saveDraft = async () => {
    if (!pin || !draft) return;
    const res = await call<{ count: number; not_found: string[] }>(
      "staff_block_many",
      { p_ids: draft.ids, p_reason: draft.reason.trim(), p_until: draft.until || null },
      pin,
    );
    if (!res) return;
    setDraft(null);
    setSelected(new Set());
    setNotice(`บันทึกแล้ว ${res.count} คน`);
    await refresh(pin);
  };

  const unblock = async (ids: string[]) => {
    if (!pin) return;
    if (!window.confirm(`ปลด ${ids.length} คนออกจากรายชื่อห้ามเข้า?`)) return;
    const res = await call<{ count: number }>("staff_unblock_many", { p_ids: ids }, pin);
    if (!res) return;
    setSelected(new Set());
    setNotice(`ปลดออกแล้ว ${res.count} คน`);
    await refresh(pin);
  };

  if (!pin) {
    return (
      <main className="staff staff-login">
        <form onSubmit={login} className="card">
          <h1>โหมดครู</h1>
          <p className="muted">ใส่รหัสของครูเพื่อจัดการรายชื่อห้ามเข้า</p>
          <input
            className="field field-pin"
            type="password"
            autoComplete="off"
            autoFocus
            placeholder="รหัสครู"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            aria-label="รหัสครู"
          />
          {error && <p className="alert" role="alert">{error}</p>}
          <button className="btn btn-primary" disabled={busy || !pinInput.trim()}>
            {busy ? "กำลังตรวจสอบ…" : "เข้าสู่โหมดครู"}
          </button>
          <Link className="ghost center" href="/">กลับหน้าเช็กอิน</Link>
        </form>
      </main>
    );
  }

  const selectedIds = Array.from(selected);

  return (
    <main className="staff">
      <header className="staff-top">
        <div>
          <h1>รายชื่อห้ามเข้าห้องสมุด</h1>
          <p className="muted">ครู{staff ? `: ${staff}` : ""}</p>
        </div>
        <div className="staff-top-actions">
          <Link className="ghost" href="/">หน้าเช็กอิน</Link>
          <button className="ghost" onClick={() => logout()}>ออกจากระบบ</button>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "blocked"} className="tab" onClick={() => switchTab("blocked")}>
          ห้ามเข้าอยู่ ({items.length})
        </button>
        <button role="tab" aria-selected={tab === "add"} className="tab" onClick={() => switchTab("add")}>
          + เพิ่มรายชื่อ
        </button>
      </nav>

      {error && <p className="alert" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {tab === "add" && (
        <div className="filters">
          <select className="field" value={klass} onChange={(e) => setKlass(e.target.value)} aria-label="ห้อง">
            <option value="">ทุกห้อง</option>
            {classes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            className="field"
            type="search"
            placeholder="ค้นหาชื่อหรือรหัส"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="ค้นหาชื่อหรือรหัส"
          />
        </div>
      )}

      {visibleIds.length > 0 && (
        <label className="row row-all">
          <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
          <span>เลือกทั้งหมดที่แสดง ({visibleIds.length} คน)</span>
        </label>
      )}

      <ul className="list">
        {tab === "blocked" &&
          items.map((i) => (
            <li key={i.student_id} className={`row${selected.has(i.student_id) ? " row-on" : ""}`}>
              <label className="row-main">
                <input type="checkbox" checked={selected.has(i.student_id)} onChange={() => toggle(i.student_id)} />
                <span className="row-text">
                  <strong>{i.full_name ?? "(ไม่พบชื่อ)"}</strong>
                  <span className="muted">
                    {i.student_id}
                    {i.class_name ? ` · ${i.class_name}` : ""}
                  </span>
                  <span className="reason">{i.reason || "ไม่ได้ระบุเหตุผล"}</span>
                  <span className="muted">
                    {i.until ? `ถึง ${thaiDate(i.until)}` : "ไม่มีกำหนด"}
                    {i.added_by ? ` · โดย ${i.added_by}` : ""}
                  </span>
                </span>
              </label>
              {!i.active && <span className="badge">หมดอายุแล้ว</span>}
              <button className="btn btn-small" onClick={() => openDraft([i.student_id])}>แก้เหตุผล</button>
            </li>
          ))}

        {tab === "add" &&
          visibleRoster.map((s) => (
            <li key={s.student_id} className={`row${selected.has(s.student_id) ? " row-on" : ""}`}>
              <label className="row-main">
                <input type="checkbox" checked={selected.has(s.student_id)} onChange={() => toggle(s.student_id)} />
                <span className="row-text">
                  <strong>{s.full_name}</strong>
                  <span className="muted">
                    {s.student_id} · {s.class_name}
                    {s.class_no ? ` · เลขที่ ${s.class_no}` : ""}
                  </span>
                  {s.blocked && <span className="reason">ห้ามเข้าอยู่: {s.reason || "ไม่ได้ระบุเหตุผล"}</span>}
                </span>
              </label>
            </li>
          ))}
      </ul>

      {tab === "blocked" && items.length === 0 && !busy && (
        <p className="empty">ยังไม่มีใครถูกห้ามเข้า กด “+ เพิ่มรายชื่อ” เพื่อเลือกนักเรียน</p>
      )}
      {tab === "add" && roster === null && <p className="empty">{busy ? "กำลังโหลดรายชื่อ…" : "โหลดรายชื่อไม่สำเร็จ"}</p>}
      {tab === "add" && roster !== null && visibleRoster.length === 0 && <p className="empty">ไม่พบนักเรียนตามที่ค้นหา</p>}

      {selectedIds.length > 0 && (
        <div className="actionbar">
          <span>เลือกแล้ว {selectedIds.length} คน</span>
          <button className="ghost" onClick={() => setSelected(new Set())}>ยกเลิก</button>
          {tab === "blocked" && (
            <button className="btn" disabled={busy} onClick={() => unblock(selectedIds)}>ปลดออก</button>
          )}
          <button className="btn btn-primary" disabled={busy} onClick={() => openDraft(selectedIds)}>
            {tab === "blocked" ? "เปลี่ยนเหตุผล" : "กำหนดเหตุผล"}
          </button>
        </div>
      )}

      {draft && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="กำหนดเหตุผล">
          <div className="card dialog">
            <h2>ห้ามเข้า {draft.ids.length} คน</h2>
            <p className="muted">
              {draft.ids.slice(0, 3).map(nameOf).join(", ")}
              {draft.ids.length > 3 ? ` และอีก ${draft.ids.length - 3} คน` : ""}
            </p>

            <label className="label" htmlFor="reason">เหตุผล (ใช้กับทุกคนที่เลือก)</label>
            <div className="chips">
              {PRESET_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`chip${draft.reason === r ? " chip-on" : ""}`}
                  onClick={() => setDraft({ ...draft, reason: r })}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              id="reason"
              className="field"
              rows={2}
              placeholder="หรือพิมพ์เหตุผลเอง"
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            />

            <label className="label" htmlFor="until">ห้ามถึงวันที่ (เว้นว่าง = ไม่มีกำหนด)</label>
            <input
              id="until"
              className="field"
              type="date"
              value={draft.until}
              onChange={(e) => setDraft({ ...draft, until: e.target.value })}
            />

            {error && <p className="alert" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button className="btn" onClick={() => setDraft(null)}>ยกเลิก</button>
              <button className="btn btn-primary" disabled={busy || !draft.reason.trim()} onClick={saveDraft}>
                {busy ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
