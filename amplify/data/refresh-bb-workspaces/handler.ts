import { env } from "$amplify/env/refresh-bb-workspaces";

import { getOrRefreshWorkspace, listConnectedUsers } from "../_backend/workspace";

export const handler = async (): Promise<{ refreshedUsers: number }> => {
  const connections = await listConnectedUsers(env);

  for (const connection of connections) {
    try {
      await getOrRefreshWorkspace({
        env,
        identity: { sub: connection.userId },
        force: true,
      });
    } catch (error) {
      console.error("Scheduled BB workspace refresh failed", {
        userId: connection.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    refreshedUsers: connections.length,
  };
};
