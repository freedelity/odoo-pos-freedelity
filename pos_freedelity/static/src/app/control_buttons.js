import { patch } from "@web/core/utils/patch";
import { ControlButtons } from "@point_of_sale/app/screens/product_screen/control_buttons/control_buttons";
import { getOrder } from "./compat";
import { FreedelityDialog } from "./freedelity_dialog";

patch(ControlButtons.prototype, {
    get freedelityLabel() {
        const order = getOrder(this.pos);
        return order?.freedelity_customer_id ? order.freedelity_customer_name : "";
    },
    clickFreedelity() {
        const order = getOrder(this.pos);
        if (order) {
            this.dialog.add(FreedelityDialog, { order });
        }
    },
});
