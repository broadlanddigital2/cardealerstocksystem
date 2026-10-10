import { withRequestDb } from "@workspace/db";
import { runScheduledJob, type ScheduledJob } from "@/server/cron";

export const dynamic = "force-dynamic";

// Scheduled jobs, invoked by the Cloudflare cron trigger (see worker.ts) or
// manually. Protected by CRON_SECRET: `Authorization: Bearer <CRON_SECRET>`.
export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { job } = await ctx.params;
  try {
    const result = await withRequestDb(() => runScheduledJob(job as ScheduledJob));
    return Response.json({ ok: true, job, result });
  } catch (err) {
    return Response.json(
      { ok: false, job, error: err instanceof Error ? err.message : String(err) },
      { status: err instanceof Error && err.message.startsWith("Unknown job") ? 404 : 500 },
    );
  }
}
