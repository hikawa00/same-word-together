import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "同词相遇｜多人联想游戏",
  description: "两人或三人同时想词、同步揭晓，看看第几轮能想到同一个词。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
