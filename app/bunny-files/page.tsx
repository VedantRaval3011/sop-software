import { BunnyFilesClient } from "@/components/bunny-files/BunnyFilesClient";

export const metadata = {
  title: "Bunny Files — SOP Control",
  description: "Browse Bunny CDN storage and compare files with the SOP registry",
};

export default function BunnyFilesPage() {
  return <BunnyFilesClient />;
}
