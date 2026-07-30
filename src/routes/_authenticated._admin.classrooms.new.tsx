import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { createClassroom } from "@/lib/classrooms.functions";
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
  const nav = useNavigate();
  const qc = useQueryClient();
  const create = useServerFn(createClassroom);
  const mutation = useMutation({
    mutationFn: () => create({ data: { name, description } }),
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
