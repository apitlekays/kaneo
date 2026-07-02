import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/fetchers/correspondence/letters";
import { toast } from "@/lib/toast";

export function useLetters(workspaceId: string, filters: api.LetterFilters) {
  return useQuery({
    queryKey: ["letters", workspaceId, filters],
    queryFn: () => api.listLetters(workspaceId, filters),
    enabled: !!workspaceId,
  });
}

export function useLetter(workspaceId: string, id: string | null) {
  return useQuery({
    queryKey: ["letter", workspaceId, id],
    queryFn: () => api.getLetter(workspaceId, id as string),
    enabled: !!workspaceId && !!id,
  });
}

export function useCorrespondenceSummary(workspaceId: string) {
  return useQuery({
    queryKey: ["correspondence-summary", workspaceId],
    queryFn: () => api.getCorrespondenceSummary(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useLetterMutations(workspaceId: string, letterId?: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["letters", workspaceId] });
    qc.invalidateQueries({ queryKey: ["correspondence-summary", workspaceId] });
    if (letterId) {
      qc.invalidateQueries({ queryKey: ["letter", workspaceId, letterId] });
    }
  };
  const onError = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : "Something went wrong",
    );
  const id = letterId as string;

  return {
    create: useMutation({
      mutationFn: (body: object) => api.createLetter(workspaceId, body),
      onSuccess: () => {
        invalidate();
        toast.success("Letter captured");
      },
      onError,
    }),
    update: useMutation({
      mutationFn: (body: object) => api.updateLetter(workspaceId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Saved");
      },
      onError,
    }),
    register: useMutation({
      mutationFn: (numberSchemeId?: string) =>
        api.registerLetter(workspaceId, id, numberSchemeId),
      onSuccess: () => {
        invalidate();
        toast.success("Registered");
      },
      onError,
    }),
    classify: useMutation({
      mutationFn: (body: object) => api.classifyLetter(workspaceId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Classified");
      },
      onError,
    }),
    route: useMutation({
      mutationFn: (body: object) => api.routeLetter(workspaceId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Routed");
      },
      onError,
    }),
    addMinute: useMutation({
      mutationFn: (body: object) => api.addMinute(workspaceId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Minute added");
      },
      onError,
    }),
    setStatus: useMutation({
      mutationFn: (status: string) =>
        api.setLetterStatus(workspaceId, id, status),
      onSuccess: () => {
        invalidate();
        toast.success("Status updated");
      },
      onError,
    }),
    link: useMutation({
      mutationFn: (body: object) => api.linkLetter(workspaceId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Linked");
      },
      onError,
    }),
    saveDraft: useMutation({
      mutationFn: (bodyHtml: string) =>
        api.saveDraftVersion(workspaceId, id, bodyHtml),
      onSuccess: () => {
        invalidate();
        toast.success("Draft saved");
      },
      onError,
    }),
    submitReview: useMutation({
      mutationFn: () => api.submitReview(workspaceId, id),
      onSuccess: () => {
        invalidate();
        toast.success("Submitted for review");
      },
      onError,
    }),
    reviewDecision: useMutation({
      mutationFn: (body: {
        decision: "approve" | "return";
        comment?: string;
      }) => api.reviewDecision(workspaceId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Review recorded");
      },
      onError,
    }),
    approvalDecision: useMutation({
      mutationFn: (body: {
        stepInstanceId: string;
        decision: "approve" | "reject" | "return";
        comment?: string;
      }) => api.approvalDecision(workspaceId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Decision recorded");
      },
      onError,
    }),
    sign: useMutation({
      mutationFn: () => api.signLetter(workspaceId, id),
      onSuccess: () => {
        invalidate();
        toast.success("Letter signed");
      },
      onError,
    }),
    dispatch: useMutation({
      mutationFn: (body: {
        method: "email" | "post" | "courier" | "hand" | "group";
        distributionListIds?: string[];
        recipients?: { name?: string; email?: string }[];
        trackingNo?: string;
        coverNote?: string;
      }) => api.dispatchLetter(workspaceId, id, body),
      onSuccess: () => {
        invalidate();
        toast.success("Dispatched");
      },
      onError,
    }),
  };
}
