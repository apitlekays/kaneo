import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver, validator } from "hono-openapi";
import * as v from "valibot";
import {
  createAvatarUploadUrl,
  getAvatarObject,
  isImageContentType,
  validateTaskAssetUploadInput,
} from "../storage/s3";

const user = new Hono<{
  Variables: {
    userId: string;
  };
}>()
  .put(
    "/avatar-upload",
    describeRoute({
      operationId: "createAvatarUpload",
      tags: ["User"],
      description:
        "Create a presigned upload URL for the current user's avatar",
      responses: {
        200: {
          description: "Avatar upload URL created successfully",
          content: {
            "application/json": { schema: resolver(v.any()) },
          },
        },
      },
    }),
    validator(
      "json",
      v.object({
        contentType: v.string(),
        size: v.number(),
      }),
    ),
    async (c) => {
      const userId = c.get("userId");
      if (!userId) {
        throw new HTTPException(401, { message: "Unauthorized" });
      }

      const { contentType, size } = c.req.valid("json");

      try {
        validateTaskAssetUploadInput(contentType, size);
      } catch (error) {
        throw new HTTPException(400, {
          message:
            error instanceof Error
              ? error.message
              : "Invalid avatar upload request",
        });
      }

      if (!isImageContentType(contentType)) {
        throw new HTTPException(400, {
          message: "Only image files are allowed for avatars.",
        });
      }

      try {
        const upload = await createAvatarUploadUrl({ userId, contentType });

        // Stable served URL with a cache-busting version token. The object key
        // is deterministic (avatars/<userId>), so the version param is what
        // forces clients to re-fetch after a new upload overwrites the object.
        const imageUrl = new URL(
          `/api/user/avatar/${userId}?v=${Date.now()}`,
          c.req.url,
        ).toString();

        return c.json({
          uploadUrl: upload.uploadUrl,
          key: upload.key,
          headers: upload.headers,
          imageUrl,
        });
      } catch (error) {
        throw new HTTPException(503, {
          message:
            error instanceof Error
              ? error.message
              : "Avatar uploads are not configured",
        });
      }
    },
  )
  .get(
    "/avatar/:userId",
    describeRoute({
      operationId: "getUserAvatar",
      tags: ["User"],
      description: "Stream a user's uploaded avatar image",
      responses: {
        200: {
          description: "The avatar image binary stream",
          content: {
            "image/*": { schema: resolver(v.any()) },
          },
        },
      },
    }),
    validator("param", v.object({ userId: v.string() })),
    async (c) => {
      const { userId } = c.req.valid("param");

      try {
        const object = await getAvatarObject(userId);

        return new Response(object.body as BodyInit, {
          headers: {
            // Safe to cache: the served URL carries a `?v=` token that changes
            // on every new upload, so a cached entry is never stale.
            "Cache-Control": "private, max-age=86400",
            "Content-Length": object.contentLength?.toString() || "",
            "Content-Type": object.contentType || "image/png",
            ETag: object.etag || "",
            "Last-Modified": object.lastModified?.toUTCString() || "",
          },
        });
      } catch {
        throw new HTTPException(404, { message: "Avatar not found" });
      }
    },
  );

export default user;
