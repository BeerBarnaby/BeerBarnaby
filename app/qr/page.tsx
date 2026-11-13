import { headers } from "next/headers";
import QRCode from "qrcode";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "QR เช็กอินห้องสมุด" };

// หน้าโปสเตอร์สำหรับพิมพ์ติดที่จุดลงทะเบียน: นักเรียนสแกนแล้วเปิดหน้าเช็กอินในมือถือตัวเอง
export default async function QrPage() {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "library-checkin-nine.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = `${proto}://${host}/`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#12284c", light: "#ffffff" } });

  return (
    <main className="poster">
      <div className="poster-sheet">
        <span className="kicker">ห้องสมุด</span>
        <h1>สแกนเพื่อเช็กอิน</h1>
        <p className="poster-sub">เปิดกล้องมือถือ สแกน แล้วกดรหัสนักเรียน 5 หลัก</p>
        <div className="poster-qr" dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label={`QR Code ไปที่ ${url}`} />
        <ol className="poster-steps">
          <li>สแกน QR Code</li>
          <li>กดรหัสนักเรียน 5 หลัก</li>
          <li>แสดงหน้าจอผลให้ครูดู</li>
        </ol>
        <p className="poster-url">{url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</p>
      </div>
      <PrintButton />
    </main>
  );
}
