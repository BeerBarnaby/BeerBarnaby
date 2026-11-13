// ข้อความบนจอหลังเช็กอิน
// ไฟล์นี้เป็นเวอร์ชันตั้งต้น ถ้ามีข้อความของตัวเอง นำมาวางทับได้เลย
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
      return { tone: "ok", title: "เช็กอินสำเร็จ", lines: [r.name, r.class, "เข้าใช้ห้องสมุดได้"] };
    case "already":
      return {
        tone: "ok",
        title: "วันนี้เช็กอินแล้ว",
        lines: [r.name, r.class, `เช็กอินไว้เมื่อ ${r.first_at} น. เข้าใช้ห้องสมุดได้`],
      };
    case "blocked":
      return {
        tone: "stop",
        title: "เข้าห้องสมุดไม่ได้",
        lines: [
          r.name,
          r.reason ? r.reason : "กรุณาติดต่อครู",
          r.until ? `ถึงวันที่ ${thaiDate(r.until)}` : "",
        ].filter(Boolean),
      };
    default:
      return { tone: "warn", title: "ไม่พบรหัสนี้", lines: ["ตรวจรหัสนักเรียน 5 หลักแล้วลองอีกครั้ง"] };
  }
}
