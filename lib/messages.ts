// ข้อความบนจอ kiosk หลังเช็กอิน
// ไฟล์นี้เป็นเวอร์ชันตั้งต้น — เจ้าของโปรเจกต์มีเวอร์ชันของตัวเอง นำมาวางทับได้เลย
// ขอแค่ให้ export toScreen(result) ที่คืนค่า Screen ตามรูปแบบด้านล่าง

import { thaiDate, type CheckInResult } from "./rpc";

export type Screen = {
  tone: "ok" | "stop" | "warn";
  title: string;
  lines: string[];
};

export function toScreen(r: CheckInResult): Screen {
  switch (r.status) {
    case "allowed":
      return { tone: "ok", title: "เข้าใช้ห้องสมุดได้", lines: [r.name, r.class] };
    case "blocked":
      return {
        tone: "stop",
        title: "ยังเข้าใช้ห้องสมุดไม่ได้",
        lines: [
          r.name,
          r.reason ? `เหตุผล: ${r.reason}` : "กรุณาติดต่อครูบรรณารักษ์",
          r.until ? `ถึงวันที่ ${thaiDate(r.until)}` : "",
        ].filter(Boolean),
      };
    default:
      return { tone: "warn", title: "ไม่พบรหัสนักเรียนนี้", lines: ["ตรวจรหัส 5 หลักแล้วลองอีกครั้ง"] };
  }
}
