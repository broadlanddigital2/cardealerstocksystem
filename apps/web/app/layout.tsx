import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "../src/index.css";

export const metadata: Metadata = {
  title: "MotorMetric",
  description: "The MotorTrade Accountants — Stock Book",
  robots: { index: true, follow: true },
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "The MotorTrade Accountants — Stock Book",
    description: "The MotorTrade Accountants — Stock Book",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "The MotorTrade Accountants — Stock Book" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
