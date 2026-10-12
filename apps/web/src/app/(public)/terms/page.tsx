import type { Metadata } from "next";
import { TermsContent } from "./terms-content";

export const metadata: Metadata = {
  title: "Terms of use · ankileet",
  description: "Terms governing use of ankileet and its Chrome extension.",
};

export default function TermsPage() {
  return <TermsContent />;
}
