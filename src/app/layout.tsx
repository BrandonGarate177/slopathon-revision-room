import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bangerz Studio Revisions",
  description: "Talk back to the draft. Timestamped, prioritized revision notes from spoken feedback.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
