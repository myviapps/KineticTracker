import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCollege, updateCollege, deleteCollege } from "@/lib/colleges.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type CollegeRow = { id: string; name: string; classroom_count?: number };

/**
 * Create, rename and delete colleges.
 *
 * Colleges were read-only to the whole application — no create, rename or
 * delete existed anywhere — so adding one meant writing SQL, and a mistake
 * could not be undone from the app at all. That is how two empty demo colleges
 * ended up permanently in the picker, and why an admin on an empty instance had
 * no way to start.
 *
 * Delete is guarded server-side rather than here: the check that matters is the
 * count of dependent classrooms and assignments at the moment of deletion, and
 * a client that has been open for a while does not know it.
 */
export function CollegeAdmin({ colleges }: { colleges: CollegeRow[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [editing, setEditing] = useState<CollegeRow | null>(null);

  const qc = useQueryClient();
  const create = useServerFn(createCollege);
  const update = useServerFn(updateCollege);
  const remove = useServerFn(deleteCollege);

  // Every college change moves classroom pickers, rankings scope and report
  // scope, so they all refetch rather than each page guessing when to.
  const settle = () => {
    qc.invalidateQueries({ queryKey: ["colleges"] });
    qc.invalidateQueries({ queryKey: ["classrooms"] });
    qc.invalidateQueries({ queryKey: ["report-scopes"] });
    qc.invalidateQueries({ queryKey: ["rankings"] });
  };

  const createM = useMutation({
    mutationFn: () => create({ data: { name, city: city || null } }),
    onSuccess: () => {
      toast.success(`${name} created`);
      setName("");
      setCity("");
      settle();
    },
    onError: (e) => toast.error(String(e)),
  });

  const updateM = useMutation({
    mutationFn: () => update({ data: { id: editing!.id, name: editing!.name } }),
    onSuccess: () => {
      toast.success("College renamed");
      setEditing(null);
      settle();
    },
    onError: (e) => toast.error(String(e)),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("College deleted");
      settle();
    },
    onError: (e) => toast.error(String(e)),
  });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Building2 className="mr-1 size-4" /> Manage colleges
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage colleges</DialogTitle>
            <DialogDescription>
              A college groups classrooms, scopes CEOs and placement officers, and defines the pool
              that College Rank is measured against.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {colleges.length > 0 && (
              <div className="divide-y divide-border rounded-md border border-border">
                {colleges.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      {editing?.id === c.id ? (
                        <Input
                          value={editing.name}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          aria-label={`Rename ${c.name}`}
                          className="h-8"
                          autoFocus
                        />
                      ) : (
                        <>
                          <div className="truncate text-sm font-medium">{c.name}</div>
                          <div className="font-mono text-3xs text-muted-foreground">
                            {c.classroom_count ?? 0} classroom
                            {(c.classroom_count ?? 0) === 1 ? "" : "s"}
                          </div>
                        </>
                      )}
                    </div>

                    {editing?.id === c.id ? (
                      <>
                        <Button
                          size="sm"
                          disabled={!editing.name.trim() || updateM.isPending}
                          onClick={() => updateM.mutate()}
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={`Rename ${c.name}`}
                          onClick={() => setEditing({ id: c.id, name: c.name })}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        {/* Enabled regardless of the count — the server owns the
                            rule and explains it. A disabled button with no
                            reason is the worse failure. */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 text-destructive hover:text-destructive"
                          aria-label={`Delete ${c.name}`}
                          disabled={deleteM.isPending}
                          onClick={() => deleteM.mutate(c.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return toast.error("Name is required");
                createM.mutate();
              }}
              className="space-y-3 rounded-md border border-dashed border-border p-3"
            >
              <div>
                <Label htmlFor="new-college">Add a college</Label>
                <Input
                  id="new-college"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="CMR Technical Campus"
                  maxLength={120}
                />
              </div>
              <div>
                <Label htmlFor="new-college-city">City (optional)</Label>
                <Input
                  id="new-college-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Hyderabad"
                  maxLength={120}
                />
              </div>
              <Button type="submit" size="sm" disabled={createM.isPending || !name.trim()}>
                <Plus className="mr-1 size-4" />
                {createM.isPending ? "Creating…" : "Create college"}
              </Button>
            </form>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
