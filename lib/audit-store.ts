import type { AuditEntry } from "@/lib/types";

/** Persistence seam for a future Supabase/PostgreSQL adapter. Browser history currently uses localStorage. */
export async function persistAuditEntry(_entry: AuditEntry): Promise<void> {
  if (process.env.DATABASE_URL) {
    // Add a server-side adapter once the deployment selects a database provider and schema.
  }
}
