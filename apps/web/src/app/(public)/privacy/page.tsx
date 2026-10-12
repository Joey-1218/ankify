import type { Metadata } from "next";
import { PrivacyContent } from "./privacy-content";

export const metadata: Metadata = {
  title: "Privacy policy · ankileet",
  description: "How ankileet and its Chrome extension handle user data.",
};

export default function PrivacyPage() {
  return <PrivacyContent />;
}
