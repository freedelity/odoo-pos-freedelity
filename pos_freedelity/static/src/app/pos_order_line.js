import { patch } from "@web/core/utils/patch";
import { PosOrderline } from "@point_of_sale/app/models/pos_order_line";

patch(PosOrderline.prototype, {
    set_full_product_name() {
        // A voucher line is named after its voucher; keep that name when the line is reloaded.
        if (this.freedelity_voucher_id && this.full_product_name) {
            return;
        }
        return super.set_full_product_name(...arguments);
    },
});
