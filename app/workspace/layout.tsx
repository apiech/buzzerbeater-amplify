import type { Metadata } from "next";

type WorkspaceLayoutProps = {
  children: React.ReactNode;
};

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      "max-image-preview": "none",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  return children;
}
