import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mailmomo",
    short_name: "Mailmomo",
    description: "A calm, keyboard-first, AI-native email client",
    start_url: "/mail/inbox",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2f6fed",
    icons: [{ src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%232f6fed'/%3E%3Cpath d='M7 11l9 6 9-6M7 11v10h18V11' fill='none' stroke='white' stroke-width='2' stroke-linejoin='round'/%3E%3C/svg%3E", sizes: "any", type: "image/svg+xml" }],
  };
}
