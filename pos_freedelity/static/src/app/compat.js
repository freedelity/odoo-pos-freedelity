/**
 * Odoo 18.0 adapter. Everything that differs between Odoo versions (import paths, snake_case vs
 * camelCase model API) goes through this file, so the rest of the module is identical on every branch.
 */
import { accountTaxHelpers } from "@account/helpers/account_tax";

export { PosStore } from "@point_of_sale/app/store/pos_store";
export { usePos } from "@point_of_sale/app/store/pos_hook";
export { ask } from "@point_of_sale/app/store/make_awaitable_dialog";

export const getOrder = (pos) => pos.get_order();
export const getLines = (order) => order.get_orderlines();
export const getOrderTotal = (order) => order.get_total_with_tax();
export const isRefundOrder = (order) => order._isRefundOrder();
export const getLineQty = (line) => line.get_quantity();
export const getLinePriceIncl = (line) => line.get_price_with_tax();
export const getLineDiscount = (line) => line.get_discount();
export const getLineName = (line) => line.get_full_product_name();
export const linesGroupedByTax = (order) => order.get_orderlines_grouped_by_tax_ids();
export const baseAmount = (order, lines) => order.calculate_base_amount(lines);
export const canBeDiscounted = (tax) => accountTaxHelpers.can_be_discounted(tax);
export const removeLine = (order, line) => order.removeOrderline(line);
export const formatCurrency = (pos, amount) => pos.env.utils.formatCurrency(amount);

export const addDiscountLine = (pos, order, { product, priceUnit, taxes, name, voucherId }) =>
    pos.addLineToOrder(
        {
            product_id: product,
            price_unit: priceUnit,
            qty: 1,
            tax_ids: [["link", ...taxes]],
            full_product_name: name,
            freedelity_voucher_id: voucherId,
        },
        order,
        { merge: false },
        false
    );
