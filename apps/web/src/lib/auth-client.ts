import { apiKeyClient } from "@better-auth/api-key/client";
import {
  adminClient,
  anonymousClient,
  deviceAuthorizationClient,
  emailOTPClient,
  genericOAuthClient,
  inferAdditionalFields,
  lastLoginMethodClient,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import type { AccessControl } from "better-auth/plugins/access";
import { createAuthClient } from "better-auth/react";
import { ac, admin, globalAdmin, member, owner, viewer } from "./permissions";

const getBaseURL = () => {
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:1337";
  try {
    const url = new URL(apiUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return apiUrl.split("/").slice(0, 3).join("/");
  }
};

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  basePath: "/api/auth",
  plugins: [
    anonymousClient(),
    lastLoginMethodClient(),
    magicLinkClient(),
    emailOTPClient(),
    organizationClient({
      // `ac` (from @kaneo/permissions) is typed to our known resource keys
      // (project/task/label/workspace + better-auth's organization/member/
      // invitation/team/ac defaults). The client's `AccessControl` type
      // expects `newRole` to accept an open string index signature because
      // `dynamicAccessControl` lets the server hand back roles for resource
      // keys that aren't in that static list. `newRole`/`authorize` don't
      // validate keys at runtime, so this widening cast doesn't misrepresent
      // behavior — it only relaxes a generic constraint that's stricter than
      // what the object actually does at runtime.
      ac: ac as AccessControl,
      roles: {
        viewer,
        member,
        admin,
        owner,
        "global-admin": globalAdmin,
      },
      dynamicAccessControl: {
        enabled: true,
      },
    }),
    genericOAuthClient(),
    deviceAuthorizationClient(),
    apiKeyClient(),
    adminClient(),
    inferAdditionalFields({
      user: {
        locale: {
          type: "string",
          required: false,
          input: true,
        },
      },
    }),
  ],
});
