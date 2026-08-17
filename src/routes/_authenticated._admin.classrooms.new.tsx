import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { createClassroom } from "@/lib/classrooms.functions";
import { listColleges } from "@/lib/colleges.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/_admin/classrooms/new")({
  head: () => ({ meta: [{ title: "New Classroom — Almanac" }] }),
  component: NewClassroomPage,
});

function NewClassroomPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [collegeId, setCollegeId] = useState("");
  const nav = useNavigate();
  const qc = useQueryClient();

  /*
    The college a new cohort belongs to.

    Shown only when there is a choice to make. With one college the server
    infers it and the field would be a required-looking control with a single
    option; with several, inference fails and creation was impossible without
    this — the server threw "Multiple colleges exist" and the form had no way
    to answer.
  */
  const { data: collegeData } = useQuery({
    queryKey: ["colleges"],
    queryFn: () => listColleges(),
    staleTime: 5 * 60_000,
  });
  const colleges = collegeData?.colleges ?? [];
  const mustChoose = colleges.length > 1;

  const create = useServerFn(createClassroom);
  const mutation = useMutation({
    mutationFn: () =>
      create({ data: { name, description, ...(collegeId ? { college_id: collegeId } : {}) } }),
    onSuccess: (r) => {
      toast.success("Classroom created");
      qc.invalidateQueries({ queryKey: ["classrooms"] });
      nav({ to: "/classrooms/$id/students/new", params: { id: r.id } });
    },
    onError: (e) => toast.error(String(e)),
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <h1 className="mb-2 text-2xl font-bold tracking-tight">Create Classroom</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Group students under a classroom so you can compare and refresh them together.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return toast.error("Name is required");
          if (mustChoose && !collegeId) return toast.error("Choose a college for this classroom");
          mutation.mutate();
        }}
        className="space-y-6 rounded-lg border border-border bg-surface p-6"
      >
        <div>
          <Label htmlFor="name">Classroom name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="CS101 — Data Structures"
            maxLength={100}
            required
          />
        </div>
        {mustChoose && (
          <div>
            <Label htmlFor="college">College</Label>
            <select
              id="college"
              value={collegeId}
              onChange={(e) => setCollegeId(e.target.value)}
              required
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">Select a college…</option>
              {colleges.map((c) => (
                <option key={c.college_id} value={c.college_id}>
                  {c.college_name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Decides which college&rsquo;s rankings and reports this cohort appears in.
            </p>
          </div>
        )}
        <div>
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Fall 2024 · Section B"
            maxLength={500}
            rows={3}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create & add students"}
          </Button>
        </div>
      </form>
    </div>
  );
}
