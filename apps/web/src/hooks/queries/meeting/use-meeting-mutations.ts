import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "@/fetchers/meeting";
import { toast } from "@/lib/toast";

export function useMeetingMutations(workspaceId: string, meetingId?: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["meetings", workspaceId] });
    if (meetingId) {
      qc.invalidateQueries({ queryKey: ["meeting", workspaceId, meetingId] });
    }
  };
  const onError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : "Something went wrong",
    );
  const id = meetingId as string;

  return {
    create: useMutation({
      mutationFn: (body: api.CreateMeetingInput) =>
        api.createMeeting(workspaceId, body),
      onSuccess: () => {
        invalidate();
        toast.success("Meeting created");
      },
      onError,
    }),
    update: useMutation({
      mutationFn: (body: api.UpdateMeetingInput) =>
        api.updateMeeting(workspaceId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Meeting saved");
      },
      onError,
    }),
    addAttendee: useMutation({
      mutationFn: (body: api.AddAttendeeInput) =>
        api.addAttendee(workspaceId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Attendee added");
      },
      onError,
    }),
    removeAttendee: useMutation({
      mutationFn: (attendeeId: string) =>
        api.removeAttendee(workspaceId, id, attendeeId),
      onSuccess: () => {
        invalidate();
        toast.success("Attendee removed");
      },
      onError,
    }),
    addMinuteItem: useMutation({
      mutationFn: (body: api.AddMinuteItemInput) =>
        api.addMinuteItem(workspaceId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Minute item added");
      },
      onError,
    }),
    updateMinuteItem: useMutation({
      mutationFn: (vars: { itemId: string; body: api.UpdateMinuteItemInput }) =>
        api.updateMinuteItem(workspaceId, id, vars.itemId, vars.body),
      onSuccess: () => {
        invalidate();
        toast.success("Minute item saved");
      },
      onError,
    }),
    adopt: useMutation({
      mutationFn: (adoptedByMeetingId: string) =>
        api.adoptMeeting(workspaceId, id, adoptedByMeetingId),
      onSuccess: () => {
        invalidate();
        toast.success("Meeting adopted");
      },
      onError,
    }),
  };
}
