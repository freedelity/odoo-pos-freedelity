import { patch } from "@web/core/utils/patch";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";

patch(PaymentScreen.prototype, {
    async _finalizeValidation() {
        // The order is final from here on: queue its sale for the terminal before it is synced,
        // so the pending state travels with the order to the server.
        this.pos.freedelity?.onOrderValidated(this.currentOrder);
        return await super._finalizeValidation(...arguments);
    },
});
