import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Matrix CRM v2",
  description: "Milestone 1 foundation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
