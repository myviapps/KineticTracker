import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { BulkUploader } from "@/components/bulk-uploader";

export const Route = createFileRoute("/_authenticated/_admin/import")({
  head: () => ({ meta: [{ title: "Import — Almanac" }] }),
  component: ImportPage,
});

function ImportPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <Link
        to="/dashboard"
        className="mb-4 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-3" /> Dashboard
      </Link>
      <h1 className="mb-2 text-2xl font-bold tracking-tight">Bulk Import</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Upload a CSV or Excel file to create classrooms and import students in one go.
      </p>
      <BulkUploader />
    </div>
  );
}
