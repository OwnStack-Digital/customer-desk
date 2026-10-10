import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "OwnStack — Your customer workspace",
  description:
    "A clear, calm workspace for customer conversations, replies and quotes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
