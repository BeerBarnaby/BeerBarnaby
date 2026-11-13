"use client";

import { useCallback, useEffect, useState } from "react";
import type { StatsData } from "../../lib/rpc";

const RANGES = [
  { days: 7, label: "7 วัน" },
  { days: 30, label: "30 วัน" },
  { days: 90, label: "90 วัน" },
];

type Bar = { key: string; axis: string; tip: string; value: number };

const dayLabel = (iso: string, long = false) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    ...(long ? { weekday: "short" } : {}),
  });

// แกน y ลงท้ายที่เลขกลมๆ ที่ครอบค่าสูงสุดพอดี
function niceMax(max: number): number {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 4, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

function Columns({ bars, labelEvery, name }: { bars: Bar[]; labelEvery: number; name: string }) {
  const [active, setActive] = useState<number | null>(null);
  const top = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  const tipLeft = active === null ? 50 : Math.min(88, Math.max(12, ((active + 0.5) / bars.length) * 100));

  return (
    <div className="chart" role="group" aria-label={name}>
      <div className="chart-y" aria-hidden>
        <span>{top}</span>
        <span>{top / 2}</span>
        <span>0</span>
      </div>
      <div className="chart-plot" onPointerLeave={() => setActive(null)}>
        <div className="chart-grid" aria-hidden><i /><i /><i /></div>
        {active !== null && (
          <div className="chart-tip" style={{ left: `${tipLeft}%` }} role="status">
            <strong>{bars[active].value} ครั้ง</strong>
            <span>{bars[active].tip}</span>
          </div>
        )}
        <div className="chart-cols">
          {bars.map((b, i) => (
            <button
              key={b.key}
              type="button"
              className={`col${active === i ? " col-on" : ""}`}
              aria-label={`${b.tip} ${b.value} ครั้ง`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(i)}
            >
              <i style={{ height: `${(b.value / top) * 100}%` }} />
            </button>
          ))}
        </div>
        <div className="chart-x" aria-hidden>
          {bars.map((b, i) => (
            <span key={b.key}>{(bars.length - 1 - i) % labelEvery === 0 ? b.axis : ""}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Stats({ load }: { load: (days: number) => Promise<StatsData | null> }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(
    async (d: number) => {
      setLoading(true);
      const res = await load(d);
      if (res) setData(res);
      setLoading(false);
    },
    [load],
  );

  useEffect(() => {
    refresh(days);
  }, [days, refresh]);

  if (!data) return <p className="empty">{loading ? "กำลังโหลดสถิติ…" : "โหลดสถิติไม่สำเร็จ"}</p>;

  const { summary } = data;
  const dayBars: Bar[] = data.days.map((d) => ({
    key: d.day,
    axis: days <= 7 ? String(Number(d.day.slice(8))) : dayLabel(d.day),
    tip: dayLabel(d.day, true),
    value: d.count,
  }));

  // แสดงชั่วโมงเรียนเสมอ และขยายช่วงถ้ามีคนเข้านอกเวลา
  const hoursSeen = data.hours.map((h) => h.hour);
  const firstHour = Math.min(7, ...hoursSeen);
  const lastHour = Math.max(17, ...hoursSeen);
  const hourBars: Bar[] = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => {
    const hour = firstHour + i;
    return {
      key: String(hour),
      axis: String(hour),
      tip: `${hour}:00–${hour}:59 น.`,
      value: data.hours.find((h) => h.hour === hour)?.count ?? 0,
    };
  });
  const peak = hourBars.reduce((a, b) => (b.value > a.value ? b : a), hourBars[0]);
  const levelMax = Math.max(1, ...data.levels.map((l) => l.count));

  return (
    <section className={`stats${loading ? " stats-loading" : ""}`}>
      <div className="range" role="group" aria-label="ช่วงเวลา">
        {RANGES.map((r) => (
          <button key={r.days} className={`chip${days === r.days ? " chip-on" : ""}`} aria-pressed={days === r.days} onClick={() => setDays(r.days)}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="tiles">
        <div className="tile tile-hero">
          <span className="tile-label">เข้าใช้วันนี้</span>
          <strong>{summary.today.toLocaleString("th-TH")}</strong>
          <span className="tile-unit">ครั้ง</span>
        </div>
        <div className="tile">
          <span className="tile-label">รวม {days} วัน</span>
          <strong>{summary.total.toLocaleString("th-TH")}</strong>
          <span className="tile-unit">ครั้ง</span>
        </div>
        <div className="tile">
          <span className="tile-label">นักเรียนที่มาใช้</span>
          <strong>{summary.students.toLocaleString("th-TH")}</strong>
          <span className="tile-unit">คน (ไม่นับซ้ำ)</span>
        </div>
        <div className="tile">
          <span className="tile-label">ถูกห้ามเข้า</span>
          <strong>{summary.blocked.toLocaleString("th-TH")}</strong>
          <span className="tile-unit">ครั้ง</span>
        </div>
      </div>

      {summary.total === 0 ? (
        <p className="empty">ยังไม่มีการเข้าใช้ห้องสมุดในช่วง {days} วันนี้</p>
      ) : (
        <>
          <figure className="panel">
            <figcaption>
              <h2>จำนวนเข้าใช้ต่อวัน</h2>
              <p className="muted">{dayLabel(data.from)} – {dayLabel(data.to)}</p>
            </figcaption>
            <Columns bars={dayBars} labelEvery={days <= 7 ? 1 : days <= 30 ? 7 : 14} name="จำนวนเข้าใช้ต่อวัน" />
            <details className="table-view">
              <summary>ดูเป็นตาราง</summary>
              <table>
                <thead><tr><th>วันที่</th><th>ครั้ง</th></tr></thead>
                <tbody>
                  {[...data.days].reverse().map((d) => (
                    <tr key={d.day}><td>{dayLabel(d.day, true)}</td><td>{d.count}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          </figure>

          <figure className="panel">
            <figcaption>
              <h2>ช่วงเวลาที่คนเข้าเยอะ</h2>
              <p className="muted">รวมทุกวันในช่วงนี้ แยกตามชั่วโมง · มากที่สุดช่วง {peak.tip}</p>
            </figcaption>
            <Columns bars={hourBars} labelEvery={1} name="จำนวนเข้าใช้แยกตามชั่วโมง" />
          </figure>

          <figure className="panel">
            <figcaption>
              <h2>แยกตามระดับชั้น</h2>
              <p className="muted">จำนวนครั้ง และจำนวนนักเรียนที่มาใช้จากทั้งระดับ</p>
            </figcaption>
            <ul className="hbars">
              {data.levels.map((l) => (
                <li key={l.level}>
                  <span className="hbar-name">{l.level}</span>
                  <span className="hbar-track"><i style={{ width: `${(l.count / levelMax) * 100}%` }} /></span>
                  <span className="hbar-value">
                    <strong>{l.count}</strong> ครั้ง
                    <span className="muted"> · {l.students}/{l.enrolled} คน</span>
                  </span>
                </li>
              ))}
            </ul>
          </figure>
        </>
      )}
    </section>
  );
}
