import type { Metadata } from "next";
import Providers from "@/components/providers";
import "./globals.css";
export const metadata: Metadata = {
  title: "SignCraft · Operations",
  description:
    "From first brief to final installation. Signage operations, in one place.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
