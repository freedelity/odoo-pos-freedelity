/**
 * Client for the Freedelity CustomerScreen ECR protocol (v3, HTTP framing).
 *
 * The terminal listens on plain HTTP (`POST http://<terminal>:9005/ecr_command`, JSON body) and answers
 * every request with HTTP 200 and `{status: "success" | "pending" | "error", ...}`. Commands that need
 * the customer (identification, vouchers, ...) answer `pending` and must simply be sent again until
 * they leave that state. The terminal handles one request at a time, so requests are serialized.
 */

const POLL_INTERVAL = 300;
const REQUEST_TIMEOUT = 10000;

/** The terminal answered `status: "error"`. `reason` is the protocol reason code. */
export class EcrError extends Error {
    constructor(reason, message, reply) {
        super(message || reason);
        this.name = "EcrError";
        // The specification says "canceled", the terminal sends "cancelled": normalise.
        this.reason = reason === "canceled" ? "cancelled" : reason;
        this.reply = reply;
    }
}

/** The terminal could not be reached, or answered something that is not a protocol reply. */
export class EcrTransportError extends Error {
    constructor(message) {
        super(message);
        this.name = "EcrTransportError";
    }
}

export function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            return reject(signal.reason);
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export function isAbortError(error) {
    return error?.name === "AbortError";
}

export class EcrClient {
    constructor(host, port) {
        this.host = (host || "").trim();
        this.port = port || 9005;
        const hostname = this.host.includes(":") && !this.host.startsWith("[") ? `[${this.host}]` : this.host;
        this.url = `http://${hostname}:${this.port}/ecr_command`;
        // Chrome's Local Network Access: a private address must be announced as "local",
        // a loopback one as "loopback" (the request fails if the space does not match).
        this.addressSpace = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(this.host)
            ? "loopback"
            : "local";
        this._queue = Promise.resolve();
    }

    /**
     * Send one command and return the reply. Rejects with EcrError when the terminal answers
     * `status: "error"`, with EcrTransportError when it cannot be reached.
     */
    send(command, { signal } = {}) {
        const run = () => this._send(command, signal);
        const result = this._queue.then(run, run);
        this._queue = result.catch(() => {});
        return result;
    }

    async _send(command, signal) {
        if (signal?.aborted) {
            throw signal.reason;
        }
        const controller = new AbortController();
        const timer = setTimeout(
            () => controller.abort(new EcrTransportError("Timeout")),
            REQUEST_TIMEOUT
        );
        const onAbort = () => controller.abort(signal.reason);
        signal?.addEventListener("abort", onAbort, { once: true });
        let response;
        try {
            // A text/plain body keeps this a "simple" CORS request: no preflight. The terminal
            // ignores the content type and always parses JSON.
            response = await fetch(this.url, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=UTF-8" },
                body: JSON.stringify(command),
                signal: controller.signal,
                cache: "no-store",
                targetAddressSpace: this.addressSpace,
            });
        } catch (error) {
            if (signal?.aborted) {
                throw signal.reason;
            }
            if (error instanceof EcrTransportError) {
                throw error;
            }
            throw new EcrTransportError(error?.message || String(error));
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
        }
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new EcrTransportError(`HTTP ${response.status} ${text}`.trim());
        }
        let reply;
        try {
            reply = await response.json();
        } catch {
            throw new EcrTransportError("Invalid reply from the terminal");
        }
        if (reply?.status === "error") {
            throw new EcrError(reply.reason, reply.message, reply);
        }
        return reply;
    }

    /** Send `command` again until the terminal answers something else than `pending`. */
    async poll(command, { signal, interval = POLL_INTERVAL } = {}) {
        for (;;) {
            const reply = await this.send(command, { signal });
            if (reply.status !== "pending") {
                return reply;
            }
            await sleep(interval, signal);
        }
    }
}
