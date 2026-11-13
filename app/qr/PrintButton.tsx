"use client";

export default function PrintButton() {
  return (
    <button className="btn btn-primary poster-print" onClick={() => window.print()}>
      พิมพ์หน้านี้
    </button>
  );
}
