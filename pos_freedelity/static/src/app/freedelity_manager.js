import { _t } from "@web/core/l10n/translation";
import { markRaw } from "@odoo/owl";
import { EcrClient, EcrError, EcrTransportError, isAbortError, sleep } from "./ecr_client";
import * as compat from "./compat";

const RETRY_INTERVAL = 30000;
const BUSY_RETRIES = 10; // END_SESSION answered "busy" this many times (1 s apart) => force it
const OUTBOX_MAX_AGE = 7 * 24 * 3600 * 1000;
const MIN_PROTOCOL = 3;

const round = (value, digits = 2) => {
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
};

/**
 * Everything the point of sale does with the Freedelity terminal.
 *
 * One terminal session per order, identified by the order uuid. The END_SESSION that registers the
 * sale is written to a persistent outbox (localStorage) before being sent, so a sale is never lost
 * when the terminal is unreachable: it is retried until the terminal acknowledges it. The terminal
 * itself queues the sale towards the Freedelity platform when its own Internet link is down.
 */
export class FreedelityManager {
    constructor(pos) {
        this.pos = pos;
        this.client = markRaw(
            new EcrClient(pos.config.freedelity_terminal_host, pos.config.freedelity_terminal_port)
        );
        this.sessions = {};
        this.outbox = this._loadOutbox();
        this.terminalStatus = "unknown"; // unknown | online | offline | unsupported
        this._flushing = null;
        this._timer = null;
    }

    start() {
        this._timer = setInterval(() => this.flush(), RETRY_INTERVAL);
        // "online": browser back on the network; "pos-network-online": Odoo 19 reconnected to its server.
        window.addEventListener("online", () => this.flush());
        window.addEventListener("pos-network-online", () => this.flush());
        this.checkTerminal().then(() => this.flush());
    }

    get voucherProduct() {
        return this.pos.config.freedelity_voucher_product_id;
    }

    get pendingCount() {
        return this.outbox.filter((entry) => entry.phase === "terminal").length;
    }

    async checkTerminal() {
        try {
            const reply = await this.client.send({ action: "get_version" });
            if (Number(reply.maxProtocolVersion) < MIN_PROTOCOL) {
                this.terminalStatus = "unsupported";
                this.pos.notification.add(
                    _t(
                        "The Freedelity terminal runs an outdated application (%s). Update it to use it with Odoo.",
                        reply.app || "?"
                    ),
                    { type: "danger", sticky: true }
                );
                return false;
            }
            this.terminalStatus = "online";
            return true;
        } catch (error) {
            this.terminalStatus = "offline";
            const message = (await this._localNetworkDenied())
                ? _t(
                      "This browser blocks access to the Freedelity terminal. Allow \"Local network access\" for this site in the browser settings, then reload the point of sale."
                  )
                : this.errorMessage(error);
            this.pos.notification.add(message, { type: "warning", sticky: true });
            return false;
        }
    }

    /** True when Chrome's Local Network Access permission was refused for this site. */
    async _localNetworkDenied() {
        try {
            const status = await navigator.permissions.query({ name: "local-network-access" });
            return status.state === "denied";
        } catch {
            return false; // browser without Local Network Access: nothing to allow
        }
    }

    errorMessage(error) {
        if (error instanceof EcrTransportError) {
            return _t(
                "The Freedelity terminal (%s) cannot be reached. Check that it is switched on, on the same network, and that it allows this device.",
                this.client.host
            );
        }
        if (error instanceof EcrError) {
            const messages = {
                busy: _t("The terminal is busy with another customer."),
                cancelled: _t("The identification was cancelled on the terminal."),
                session_not_found: _t("The terminal no longer knows this order."),
                unprovisioned: _t("The terminal is not configured yet (unprovisioned)."),
                unsupported: _t("The terminal does not support this operation. Update its application."),
                missing_parameter: _t("The terminal rejected the request (missing parameter)."),
            };
            return messages[error.reason] || error.message;
        }
        return error?.message || String(error);
    }

    // ------------------------------------------------------------------ sessions
    getSession(order) {
        if (!this.sessions[order.uuid]) {
            this.sessions[order.uuid] = {
                started: false,
                status: order.freedelity_customer_id ? "identified" : "idle",
                error: null,
                vouchersStatus: "none",
                vouchers: this._storedVouchers(order),
            };
            if (this.sessions[order.uuid].vouchers.length) {
                this.sessions[order.uuid].vouchersStatus = "loaded";
            }
        }
        return this.sessions[order.uuid];
    }

    _storedVouchers(order) {
        try {
            return JSON.parse(order.freedelity_data || "{}").vouchers || [];
        } catch {
            return [];
        }
    }

    async _ensureStarted(order) {
        const session = this.getSession(order);
        if (!session.started) {
            await this.client.send({ action: "start_session", id: order.uuid, force_active: false });
            session.started = true;
        }
        return session;
    }

    /**
     * Open the session on the terminal and display it. Rejects with EcrError("busy") when another
     * session is displayed and `force` is false.
     */
    async activate(order, { force = false } = {}) {
        await this._ensureStarted(order);
        await this.client.send({ action: "select_session", id: order.uuid, only_if_idle: !force });
    }

    /** Wait (in the background) for the customer to identify, then fetch their vouchers. */
    identify(order) {
        const session = this.getSession(order);
        if (session.status === "waiting" || session.status === "identified") {
            return;
        }
        const controller = new AbortController();
        session.controller = markRaw(controller);
        session.status = "waiting";
        session.error = null;
        const { signal } = controller;
        (async () => {
            await this._ensureStarted(order);
            const reply = await this.client.poll(
                { action: "get_customer_details", id: order.uuid, early: true },
                { signal }
            );
            this._setCustomer(order, reply.customer || {});
            session.status = "identified";
            await this.loadVouchers(order, signal);
        })()
            .catch((error) => {
                if (isAbortError(error) || signal.aborted) {
                    if (session.status === "waiting") {
                        session.status = "idle";
                    }
                    return;
                }
                session.status = order.freedelity_customer_id ? "identified" : "error";
                session.error = this.errorMessage(error);
            })
            .finally(() => {
                if (session.controller === controller) {
                    session.controller = null;
                }
            });
    }

    _setCustomer(order, customer) {
        order.freedelity_customer_id = Number(customer.id) || 0;
        order.freedelity_customer_name = [customer.firstname, customer.name].filter(Boolean).join(" ");
        order.freedelity_points = Math.round(Number(customer.points) || 0);
    }

    async loadVouchers(order, signal) {
        const session = this.getSession(order);
        session.vouchersStatus = "loading";
        try {
            const reply = await this.client.poll({ action: "get_vouchers", id: order.uuid }, { signal });
            session.vouchers = (reply.vouchers || []).filter((voucher) => !voucher.hide);
            order.freedelity_data = JSON.stringify({ vouchers: session.vouchers });
            session.vouchersStatus = "loaded";
        } catch (error) {
            if (isAbortError(error) || signal?.aborted) {
                session.vouchersStatus = "none";
                return;
            }
            session.vouchersStatus = "error";
            session.error = this.errorMessage(error);
        }
    }

    /** Auto-start: open the session as soon as the order gets its first product. */
    async startInBackground(order) {
        const session = this.getSession(order);
        if (session.started || order.freedelity_customer_id || this.terminalStatus === "unsupported") {
            return;
        }
        try {
            await this.activate(order);
        } catch (error) {
            if (!(error instanceof EcrError && error.reason === "busy")) {
                return;
            }
            // Another order is displayed: the session stays open, the cashier can display it later.
        }
        this.identify(order);
    }

    async searchCustomers(order, pattern, zipcode, signal) {
        await this._ensureStarted(order);
        const command = { action: "search_customer", id: order.uuid, pattern };
        if (zipcode) {
            command.zipcode = String(zipcode);
        }
        const reply = await this.client.poll(command, { signal });
        return reply.customers || [];
    }

    async selectCustomer(order, customerId, signal) {
        await this._ensureStarted(order);
        await this.client.poll(
            { action: "select_customer", id: order.uuid, customer: Number(customerId) },
            { signal }
        );
        const session = this.getSession(order);
        if (session.status !== "waiting") {
            session.status = "idle";
            this.identify(order);
        }
    }

    /** Stop waiting for the customer and give the terminal screen back. */
    async cancel(order) {
        const session = this.getSession(order);
        session.controller?.abort();
        if (session.started) {
            await this.client.send({ action: "unselect_session", id: order.uuid }).catch(() => {});
        }
    }

    /** The order was deleted: close its session on the terminal without registering a sale. */
    async close(order) {
        const session = this.sessions[order.uuid];
        if (!session) {
            return;
        }
        session.controller?.abort();
        delete this.sessions[order.uuid];
        if (session.started) {
            await this.client.send({ action: "end_session", id: order.uuid, force: true }).catch(() => {});
        }
    }

    // ------------------------------------------------------------------ vouchers
    isVoucherLine(line) {
        return Boolean(line.freedelity_voucher_id) || line.product_id?.id === this.voucherProduct?.id;
    }

    goodsLines(order) {
        return compat.getLines(order).filter((line) => !this.isVoucherLine(line));
    }

    goodsTotal(order) {
        return round(this.goodsLines(order).reduce((sum, line) => sum + compat.getLinePriceIncl(line), 0));
    }

    appliedVoucherIds(order) {
        return new Set(
            compat
                .getLines(order)
                .filter((line) => line.freedelity_voucher_id)
                .map((line) => line.freedelity_voucher_id)
        );
    }

    voucherAmount(voucher) {
        const balance = Number(voucher.balance) || 0;
        return balance > 0 ? balance : Number(voucher.value) || 0;
    }

    isPercentVoucher(voucher) {
        return Number(voucher.percentage) > 0;
    }

    /** Why `voucher` cannot be used on `order`, or null when it can. */
    voucherBlocker(order, voucher) {
        const total = this.goodsTotal(order);
        if (total <= 0) {
            return _t("Add products first");
        }
        const minimum = Number(voucher.minpurchase) || 0;
        if (minimum > 0 && total < minimum) {
            return _t("Minimum purchase %s", compat.formatCurrency(this.pos, minimum));
        }
        if (!this.isPercentVoucher(voucher) && this.voucherAmount(voucher) <= 0) {
            return _t("No balance left");
        }
        return null;
    }

    /**
     * Replace the voucher lines of `order` by discount lines for `vouchers`. Each voucher becomes one
     * line per tax group, proportional to the goods of that group, so the taxable base is reduced
     * the same way as the point of sale's own global discount.
     */
    async applyVouchers(order, vouchers) {
        const product = this.voucherProduct;
        for (const line of compat.getLines(order).filter((line) => this.isVoucherLine(line))) {
            compat.removeLine(order, line);
        }
        const goodsTotal = this.goodsTotal(order);
        if (!product || goodsTotal <= 0) {
            return;
        }
        const groups = Object.entries(compat.linesGroupedByTax(order)).map(([taxIds, lines]) => {
            const goods = lines.filter((line) => !this.isVoucherLine(line));
            const taxes = taxIds
                .split(",")
                .filter((id) => id !== "")
                .map((id) => this.pos.models["account.tax"].get(Number(id)))
                .filter((tax) => tax && compat.canBeDiscounted(tax));
            return { taxes, base: compat.baseAmount(order, goods) };
        });
        let remaining = goodsTotal;
        for (const voucher of vouchers) {
            if (this.voucherBlocker(order, voucher) || remaining <= 0) {
                continue;
            }
            let amount = this.isPercentVoucher(voucher)
                ? (goodsTotal * Number(voucher.percentage)) / 100
                : this.voucherAmount(voucher);
            amount = Math.min(round(amount), remaining);
            remaining = round(remaining - amount);
            const ratio = amount / goodsTotal;
            for (const group of groups) {
                const priceUnit = -ratio * group.base;
                if (priceUnit < 0) {
                    await compat.addDiscountLine(this.pos, order, {
                        product,
                        priceUnit,
                        taxes: group.taxes,
                        name: voucher.name || _t("Freedelity voucher"),
                        voucherId: voucher.id,
                    });
                }
            }
        }
    }

    // ------------------------------------------------------------------ sale
    buildSale(order) {
        const products = this.goodsLines(order)
            .filter((line) => compat.getLineQty(line))
            .map((line) => {
                const product = line.product_id;
                const qty = compat.getLineQty(line);
                const category = (product.pos_categ_ids || [])[0];
                const item = {
                    name: compat.getLineName(line),
                    ref: product.default_code || product.barcode || String(product.id),
                    cat: category?.name || _t("Other"),
                    catref: String(category?.id || 0),
                    quantity: qty,
                    price: round(compat.getLinePriceIncl(line) / qty, 4),
                    promotion: compat.getLineDiscount(line) > 0,
                };
                if (product.barcode) {
                    item.ean = product.barcode;
                }
                return item;
            });
        const usage = [];
        const voucherLines = compat.getLines(order).filter((line) => line.freedelity_voucher_id);
        const vouchers = this.getSession(order).vouchers;
        for (const voucherId of this.appliedVoucherIds(order)) {
            const voucher = vouchers.find((v) => v.id === voucherId);
            const used = -voucherLines
                .filter((line) => line.freedelity_voucher_id === voucherId)
                .reduce((sum, line) => sum + compat.getLinePriceIncl(line), 0);
            usage.push(voucher?.partialauthorized ? { id: voucherId, value: round(used) } : { id: voucherId });
        }
        return {
            sale_id: compat.getSaleReference(order),
            total: this.goodsTotal(order),
            total_paid: round(compat.getOrderTotal(order)),
            vouchers_usage: usage,
            products_data: products,
        };
    }

    /**
     * Called when the order is validated. Queues the END_SESSION that registers the sale and sends it
     * without blocking the cashier.
     */
    onOrderValidated(order) {
        const session = this.sessions[order.uuid];
        session?.controller?.abort();
        delete this.sessions[order.uuid];
        if (!order.freedelity_customer_id || compat.isRefundOrder(order) || compat.getOrderTotal(order) < 0) {
            // Nothing to register (anonymous order or refund): just release the terminal session.
            if (session?.started) {
                this.client.send({ action: "end_session", id: order.uuid, force: true }).catch(() => {});
            }
            return;
        }
        order.freedelity_sync_state = "pending";
        this.outbox.push({
            uuid: order.uuid,
            payload: this.buildSale(order),
            phase: "terminal",
            busy: 0,
            maybeDelivered: false,
            created: Date.now(),
        });
        this._saveOutbox();
        this.flush();
    }

    // ------------------------------------------------------------------ outbox
    get _outboxKey() {
        return `pos_freedelity.outbox.${this.pos.config.id}`;
    }

    _loadOutbox() {
        try {
            const entries = JSON.parse(window.localStorage.getItem(this._outboxKey) || "[]");
            return entries.filter((entry) => Date.now() - entry.created < OUTBOX_MAX_AGE);
        } catch {
            return [];
        }
    }

    _saveOutbox() {
        try {
            window.localStorage.setItem(this._outboxKey, JSON.stringify(this.outbox));
        } catch {
            // Storage full or disabled: the queue still lives in memory for this session.
        }
    }

    flush() {
        if (!this._flushing) {
            this._flushing = (async () => {
                for (const entry of [...this.outbox]) {
                    if (!(await this._deliver(entry))) {
                        break; // terminal or server unreachable: retry everything later
                    }
                }
            })().finally(() => {
                this._flushing = null;
            });
        }
        return this._flushing;
    }

    /** Returns false when delivery must be retried later. */
    async _deliver(entry) {
        if (entry.phase === "terminal") {
            const result = await this._sendSale(entry);
            if (!result) {
                return false;
            }
            Object.assign(entry, result, { phase: "report" });
            this._saveOutbox();
            const order = this.pos.models["pos.order"].find((o) => o.uuid === entry.uuid);
            if (order) {
                order.freedelity_sync_state = result.state;
            }
            if (result.state === "error") {
                this.pos.notification.add(
                    _t("Freedelity: the sale %s was not registered. %s", entry.payload.sale_id, result.message),
                    { type: "danger", sticky: true }
                );
            }
        }
        try {
            const reported = await this.pos.data.call("pos.order", "freedelity_set_sync_state", [
                entry.uuid,
                entry.state,
                entry.message || false,
            ]);
            if (!reported) {
                return true; // the order is not on the server yet: keep the entry, try the next one
            }
        } catch {
            return false;
        }
        this.outbox.splice(this.outbox.indexOf(entry), 1);
        this._saveOutbox();
        return true;
    }

    async _sendSale(entry) {
        for (;;) {
            try {
                await this.client.send({
                    ...entry.payload,
                    action: "end_session",
                    id: entry.uuid,
                    force: entry.busy >= BUSY_RETRIES,
                });
                this.terminalStatus = "online";
                return { state: "done", message: "" };
            } catch (error) {
                if (error instanceof EcrTransportError) {
                    // The request may have reached the terminal before the connection failed.
                    entry.maybeDelivered = true;
                    this.terminalStatus = "offline";
                    this._saveOutbox();
                    return null;
                }
                switch (error.reason) {
                    case "busy":
                        entry.busy++;
                        this._saveOutbox();
                        await sleep(1000);
                        continue;
                    case "session_not_found":
                        if (entry.maybeDelivered) {
                            // A previous attempt was processed but its reply was lost.
                            return { state: "done", message: "" };
                        }
                        return { state: "error", message: this.errorMessage(error) };
                    case "unprovisioned":
                        return null;
                    default:
                        return { state: "error", message: this.errorMessage(error) };
                }
            }
        }
    }
}
