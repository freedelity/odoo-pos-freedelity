import { patch } from "@web/core/utils/patch";
import OrderPaymentValidation from "@point_of_sale/app/utils/order_payment_validation";

patch(OrderPaymentValidation.prototype, {
    async finalizeValidation() {
        // The order is final from here on: queue its sale for the terminal before it is synced,
        // so the pending state travels with the order to the server. Covers the fast payment too.
        this.pos.freedelity?.onOrderValidated(this.order);
        const result = await super.finalizeValidation(...arguments);
        // The order is now on the server (unless offline): report the terminal's answer right away.
        this.pos.freedelity?.flush();
        return result;
    },
});
