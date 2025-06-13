import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";
import { randomBytes } from "crypto";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file is missing");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File Size of Thumbnail too Large");
  }

  const mediaType = file.type;
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for thumbnail");
  }
  if (mediaType !== "image/jpeg" && mediaType !== "image/png") {
    throw new BadRequestError("Incorrect Content type for thumbnail - must be jpeg or png");
  }
  const fileExtension = mediaType.split("/")[1];
  const fileName = `${randomBytes(32).toString("base64url")}.${fileExtension}`;
  const filePath = path.join(cfg.assetsRoot, fileName);

  const imageData = await file.arrayBuffer();
  if (!imageData) {
    throw new Error("Error reading File data");
  }

  await Bun.write(filePath, imageData);

  const videoMetaData = getVideo(cfg.db, videoId);
  if (!videoMetaData) {
    throw new NotFoundError("Video not found");
  }
  if (videoMetaData?.userID !== userID) {
    throw new UserForbiddenError("Video thumbnail does not belong to the current user");
  }

  videoMetaData.thumbnailURL = `http://localhost:${cfg.port}/assets/${fileName}`;
  updateVideo(cfg.db, videoMetaData);

  return respondWithJSON(200, videoMetaData);
}
