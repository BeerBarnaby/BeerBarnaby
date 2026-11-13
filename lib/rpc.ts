// Thin client for the Supabase RPC endpoints. Only the public anon key is used;
// every permission check (including the staff PIN) happens inside the database.

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export type CheckInResult =
  | { status: "allowed"; name: string; class: string }
  | { status: "already"; name: string; class: string; first_at: string }
  | { status: "blocked"; name: string; reason: string | null; until: string | null }
  | { status: "not_found" };

export type BlockItem = {
  student_id: string;
  full_name: string | null;
  class_name: string | null;
  reason: string | null;
  until: string | null;
  added_by: string | null;
  created_at: string;
  active: boolean;
};

export type Student = {
  student_id: string;
  full_name: string;
  class_name: string;
  class_no: number | null;
  blocked: boolean;
  reason: string | null;
  until: string | null;
};

export type StatsData = {
  from: string;
  to: string;
  summary: { today: number; total: number; students: number; blocked: number; not_found: number };
  days: { day: string; count: number }[];
  hours: { hour: number; count: number }[];
  levels: { level: string; count: number; students: number; enrolled: number }[];
};

export type StaffFail = { ok: false; error: string; locked?: boolean; retry_after?: number };
export type StaffResult<T> = ({ ok: true } & T) | StaffFail;

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!BASE || !KEY) throw new Error("ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล");
  const res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`เชื่อมต่อไม่สำเร็จ (${res.status})`);
  return res.json() as Promise<T>;
}

export function thaiDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}
