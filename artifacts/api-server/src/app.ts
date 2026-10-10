import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { ObjectStorageService } from "./lib/objectStorage";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

// Periodically clean up orphaned upload objects (those that were uploaded but
// never attached to a vehicle or settings record). Run every 30 minutes and
// delete objects older than 30 minutes. Wrapped in try/catch so a missing
// PRIVATE_OBJECT_DIR config (e.g. during local dev without object storage)
// does not crash the server.
const ORPHAN_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const ORPHAN_MAX_AGE_MS = 30 * 60 * 1000;
const orphanSweeper = new ObjectStorageService();
setInterval(() => {
  orphanSweeper.cleanupOrphanedUploads(ORPHAN_MAX_AGE_MS).catch((err) => {
    logger.warn({ err }, "Orphaned upload cleanup failed");
  });
}, ORPHAN_SWEEP_INTERVAL_MS);

export default app;
