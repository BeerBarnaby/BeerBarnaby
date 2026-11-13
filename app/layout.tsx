import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans-thai/300.css";
import "@fontsource/ibm-plex-sans-thai/400.css";
import "@fontsource/ibm-plex-sans-thai/500.css";
import "@fontsource/ibm-plex-sans-thai/600.css";
import "@fontsource/ibm-plex-sans-thai/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "เช็กอินห้องสมุด",
  description: "ระบบเช็กอินเข้าใช้ห้องสมุด",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#12284c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
