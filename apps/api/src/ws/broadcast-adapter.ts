export type ProjectBroadcastMessage = {
  type: string;
  projectId: string;
  taskId?: string;
  sourceTaskId?: string;
  targetTaskId?: string;
  /** Workspace-wide sync fields (set for WORKSPACE_SYNC messages) */
  entity?: string;
  workspaceId?: string;
};

export type BroadcastMessage = {
  /**
   * Routing channel key. Either a projectId (project-scoped task/comment
   * updates) or `workspace:<workspaceId>` (workspace-wide sync).
   */
  projectId: string;
  message: ProjectBroadcastMessage;
  excludeInitiatorId?: string;
};

export type BroadcastAdapter = {
  /** Publish a message to all instances watching this project */
  publish(msg: BroadcastMessage): Promise<void>;

  /** Subscribe to messages for delivery to local connections */
  subscribe(handler: (msg: BroadcastMessage) => void): Promise<void>;

  /** Cleanup on shutdown */
  shutdown(): Promise<void>;
};
