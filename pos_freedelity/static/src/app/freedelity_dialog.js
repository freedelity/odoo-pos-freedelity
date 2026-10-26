import { Component, onMounted, onWillUnmount, useState } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { Dialog } from "@web/core/dialog/dialog";
import { ask, formatCurrency, usePos } from "./compat";
import { EcrError, isAbortError } from "./ecr_client";

export class FreedelityDialog extends Component {
    static template = "pos_freedelity.FreedelityDialog";
    static components = { Dialog };
    static props = { order: Object, close: Function };

    setup() {
        this.pos = usePos();
        this.manager = this.pos.freedelity;
        this.state = useState({
            searchOpen: false,
            pattern: "",
            zipcode: "",
            searching: false,
            results: null,
            searchError: null,
            selected: [...this.manager.appliedVoucherIds(this.props.order)],
            applying: false,
            connectError: null,
        });
        this.searchController = null;
        onMounted(() => this.connect());
        onWillUnmount(() => this.searchController?.abort());
    }

    get session() {
        return this.manager.getSession(this.props.order);
    }

    get vouchers() {
        return this.session.vouchers.map((voucher) => ({
            voucher,
            blocker: this.manager.voucherBlocker(this.props.order, voucher),
            label: this.manager.isPercentVoucher(voucher)
                ? `${Number(voucher.percentage)} %`
                : this.format(this.manager.voucherAmount(voucher)),
            expiry: (voucher.validityend || "").slice(0, 10),
        }));
    }

    customerName(customer) {
        return [customer.firstname, customer.name].filter(Boolean).join(" ");
    }

    customerPlace(customer) {
        return [customer.zip, customer.city].filter(Boolean).join(" ");
    }

    format(amount) {
        return formatCurrency(this.pos, amount);
    }

    /** Open the session, display it on the terminal and wait for the customer. */
    async connect(force = false) {
        this.state.connectError = null;
        if (this.session.status === "identified") {
            if (this.session.vouchersStatus === "none" || this.session.vouchersStatus === "error") {
                this.manager.loadVouchers(this.props.order);
            }
            return;
        }
        try {
            await this.manager.activate(this.props.order, { force });
        } catch (error) {
            if (error instanceof EcrError && error.reason === "busy") {
                const confirmed = await ask(this.pos.dialog, {
                    title: _t("Terminal busy"),
                    body: _t(
                        "The terminal is displaying another order. Display this order instead?"
                    ),
                    confirmLabel: _t("Display this order"),
                });
                if (confirmed) {
                    return this.connect(true);
                }
                this.state.connectError = this.manager.errorMessage(error);
                return;
            }
            this.state.connectError = this.manager.errorMessage(error);
            return;
        }
        this.manager.identify(this.props.order);
    }

    retry() {
        this.session.status = "idle";
        this.connect();
    }

    toggleSearch() {
        this.state.searchOpen = !this.state.searchOpen;
    }

    async search() {
        if (!this.state.pattern.trim()) {
            return;
        }
        this.searchController?.abort();
        this.searchController = new AbortController();
        this.state.searching = true;
        this.state.searchError = null;
        this.state.results = null;
        try {
            this.state.results = await this.manager.searchCustomers(
                this.props.order,
                this.state.pattern.trim(),
                this.state.zipcode.trim(),
                this.searchController.signal
            );
        } catch (error) {
            if (!isAbortError(error)) {
                this.state.searchError = this.manager.errorMessage(error);
            }
        } finally {
            this.state.searching = false;
        }
    }

    async pickCustomer(customer) {
        this.state.searching = true;
        this.state.searchError = null;
        try {
            await this.manager.selectCustomer(this.props.order, customer.id, this.searchController?.signal);
            this.state.searchOpen = false;
            this.state.results = null;
        } catch (error) {
            if (!isAbortError(error)) {
                this.state.searchError = this.manager.errorMessage(error);
            }
        } finally {
            this.state.searching = false;
        }
    }

    isSelected(voucher) {
        return this.state.selected.includes(voucher.id);
    }

    toggleVoucher(voucher) {
        const index = this.state.selected.indexOf(voucher.id);
        if (index >= 0) {
            this.state.selected.splice(index, 1);
        } else {
            this.state.selected.push(voucher.id);
        }
    }

    async apply() {
        this.state.applying = true;
        try {
            const vouchers = this.session.vouchers.filter((voucher) => this.isSelected(voucher));
            await this.manager.applyVouchers(this.props.order, vouchers);
        } finally {
            this.state.applying = false;
        }
        this.props.close();
    }

    async stop() {
        await this.manager.cancel(this.props.order);
        this.props.close();
    }
}
