import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest, S3File } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { randomBytes } from "crypto";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_VIDEO_UPLOAD_LIMIT = 1 << 30;
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid Video Id for uploading");
  }
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);
  const videoMetaData = getVideo(cfg.db, videoId);
  if (!videoMetaData) {
    throw new NotFoundError("Video to Upload not Found");
  }
  if (videoMetaData?.userID !== userID) {
    throw new UserForbiddenError("Video to upload does not belong to user");
  }

  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("Video File not found");
  }
  if (file.size > MAX_VIDEO_UPLOAD_LIMIT) {
    throw new BadRequestError("Video upload file more than max limit");
  }

  const mediaType = file.type;
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("File to upload must be mp4");
  }

  const tmpFileName = `${randomBytes(32).toString("hex")}.mp4`;
  const tmpFilePath = `/tmp/${tmpFileName}`;
  const tmpBunFile = Bun.file(tmpFilePath);
  await Bun.write(tmpBunFile, file);

  const tmpS3File: S3File = cfg.s3Client.file(tmpFileName);
  await tmpS3File.write(tmpBunFile, { type: mediaType });

  const awsVideoUrl = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${tmpFileName}`;
  videoMetaData.videoURL = awsVideoUrl;
  updateVideo(cfg.db, videoMetaData);

  console.log(`Uploading video to ${awsVideoUrl}`);
  // Delete the tmptile before returning
  await Bun.file(tmpFilePath).delete();

  return respondWithJSON(200, null);
}
