import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Inspector } from "@/inspector/Inspector";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "open-in-code-editor",
  description:
    "Hold Option to inspect any element, Option+click to open its source in your editor.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {process.env.NODE_ENV === "development" && (
          <Inspector projectRoot={process.cwd()} />
        )}
      </body>
    </html>
  );
}
