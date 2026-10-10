// Minimal Cloudflare Workers socket for `pg`, built on `cloudflare:sockets`.
//
// `pg` normally loads this from the `pg-cloudflare` package, but that package
// only exposes it under the "workerd" export condition; the Next.js/OpenNext
// build resolves the empty Node stub instead ("… is not a constructor"). We
// pass this class to pg via the `stream` option so the driver never needs it.
// Behaviour mirrors pg-cloudflare (MIT).
import { EventEmitter } from "node:events";

type CfSocket = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  closed: Promise<void>;
  close(): Promise<void>;
  startTls(options?: { expectedServerHostname?: string }): CfSocket;
};

export class CloudflareSocket extends EventEmitter {
  writable = false;
  destroyed = false;
  private upgrading = false;
  private upgraded = false;
  private cfSocket: CfSocket | null = null;
  private cfWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private cfReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private host = "";

  constructor(private readonly ssl: unknown) {
    super();
  }

  setNoDelay(): this { return this; }
  setKeepAlive(): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }

  async connect(port: number, host: string, connectListener?: () => void): Promise<this> {
    try {
      this.host = host;
      if (connectListener) this.once("connect", connectListener);
      const mod = (await import(/* webpackIgnore: true */ "cloudflare:sockets" as string)) as {
        connect(address: string, options?: { secureTransport?: "off" | "on" | "starttls" }): CfSocket;
      };
      this.cfSocket = mod.connect(`${host}:${port}`, this.ssl ? { secureTransport: "starttls" } : {});
      this.cfWriter = this.cfSocket.writable.getWriter();
      this.addClosedHandler();
      this.cfReader = this.cfSocket.readable.getReader();
      // With SSL pg first reads a single 'S'/'N' byte, then calls startTls().
      if (this.ssl) this.listenOnce().catch((e) => this.emit("error", e));
      else this.listen().catch((e) => this.emit("error", e));
      await this.cfWriter.ready;
      this.writable = true;
      this.emit("connect");
      return this;
    } catch (e) {
      this.emit("error", e);
      return this;
    }
  }

  private async listen(): Promise<void> {
    for (;;) {
      const { done, value } = await this.cfReader!.read();
      if (done) break;
      this.emit("data", Buffer.from(value));
    }
  }

  private async listenOnce(): Promise<void> {
    const { value } = await this.cfReader!.read();
    if (value) this.emit("data", Buffer.from(value));
  }

  write(data: Uint8Array | string, encoding: BufferEncoding | ((err?: Error) => void) = "utf8", callback: (err?: Error) => void = () => {}): boolean {
    if (typeof encoding === "function") {
      callback = encoding;
      encoding = "utf8";
    }
    if (data.length === 0) {
      callback();
      return true;
    }
    const bytes = typeof data === "string" ? Buffer.from(data, encoding) : data;
    this.cfWriter!.write(bytes).then(() => callback(), (err) => callback(err));
    return true;
  }

  end(data: Uint8Array = Buffer.alloc(0), encoding: BufferEncoding = "utf8", callback: (err?: Error) => void = () => {}): this {
    this.write(data, encoding, (err) => {
      this.cfSocket?.close().catch(() => {});
      callback(err);
    });
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this.end();
  }

  startTls(options: { servername?: string } = {}): void {
    if (this.upgraded) {
      this.emit("error", new Error("Cannot call startTls more than once on a socket"));
      return;
    }
    this.cfWriter!.releaseLock();
    this.cfReader!.releaseLock();
    this.upgrading = true;
    this.cfSocket = this.cfSocket!.startTls({ expectedServerHostname: options.servername || this.host });
    this.cfWriter = this.cfSocket.writable.getWriter();
    this.cfReader = this.cfSocket.readable.getReader();
    this.addClosedHandler();
    this.listen().catch((e) => this.emit("error", e));
  }

  private addClosedHandler(): void {
    this.cfSocket!.closed
      .then(() => {
        if (!this.upgrading) {
          this.cfSocket = null;
          this.emit("close");
        } else {
          this.upgrading = false;
          this.upgraded = true;
        }
      })
      .catch((e) => this.emit("error", e));
  }
}

export function isCloudflareWorkers(): boolean {
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  return nav?.userAgent === "Cloudflare-Workers";
}
