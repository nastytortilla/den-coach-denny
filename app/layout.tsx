import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Den Coach Denny",
  description: "Den Defenders' AI teammate for customer answers, call coaching, and smart scheduling.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
