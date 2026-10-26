import { patch } from "@web/core/utils/patch";
import { PosStore } from "./compat";
import { FreedelityManager } from "./freedelity_manager";

patch(PosStore.prototype, {
    async afterProcessServerData() {
        const result = await super.afterProcessServerData(...arguments);
        if (this.config.freedelity_enabled && this.config.freedelity_terminal_host) {
            this.freedelity = new FreedelityManager(this);
            this.freedelity.start();
        }
        return result;
    },
    async addLineToOrder(vals, order, opts = {}, configure = true) {
        const line = await super.addLineToOrder(...arguments);
        if (
            this.freedelity &&
            this.config.freedelity_auto_start &&
            line &&
            !this.freedelity.isVoucherLine(line)
        ) {
            this.freedelity.startInBackground(order);
        }
        return line;
    },
    async onDeleteOrder(order) {
        const deleted = await super.onDeleteOrder(...arguments);
        if (deleted !== false && this.freedelity) {
            this.freedelity.close(order);
        }
        return deleted;
    },
});
