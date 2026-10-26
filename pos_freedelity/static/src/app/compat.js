/**
 * Odoo 19.0 adapter. Everything that differs between Odoo versions (import paths, snake_case vs
 * camelCase model API) goes through this file, so the rest of the module is identical on every branch.
 */
import { accountTaxHelpers } from "@account/helpers/account_tax";

export { PosStore } from "@point_of_sale/app/services/pos_store";
export { usePos } from "@point_of_sale/app/hooks/pos_hook";
export { ask } from "@point_of_sale/app/utils/make_awaitable_dialog";

export const getOrder = (pos) => pos.getOrder();
// The reference stored as pos_reference on the server, e.g. "Order 00003-001-0001".
export const getSaleReference = (order) => order.pos_reference || order.name || order.uuid;
export const getLines = (order) => order.getOrderlines();
export const getOrderTotal = (order) => order.priceIncl;
export const isRefundOrder = (order) => order.isRefund || order.lines.some((line) => line.refunded_orderline_id);
export const getLineQty = (line) => line.getQuantity();
export const getLinePriceIncl = (line) => line.priceIncl;
export const getLineDiscount = (line) => line.getDiscount();
export const getLineName = (line) => line.getFullProductName();
export const canBeDiscounted = (tax) => accountTaxHelpers.can_be_discounted(tax);
export const removeLine = (order, line) => order.removeOrderline(line);
export const formatCurrency = (pos, amount) => pos.env.utils.formatCurrency(amount);

/** Lines grouped by their sorted tax ids, keyed like Odoo 18's get_orderlines_grouped_by_tax_ids. */
export const linesGroupedByTax = (order) => {
    const groups = {};
    for (const line of order.getOrderlines()) {
        const key = line.tax_ids
            .map((tax) => tax.id)
            .sort((a, b) => a - b)
            .join(",");
        (groups[key] ||= []).push(line);
    }
    return groups;
};

/** Amount of `lines` expressed like their price unit: tax included only with price-included taxes. */
export const baseAmount = (order, lines) =>
    lines.reduce(
        (sum, line) =>
            sum + (line.tax_ids.every((tax) => tax.price_include) ? line.priceIncl : line.priceExcl),
        0
    );

export const addDiscountLine = async (pos, order, { product, priceUnit, taxes, name, voucherId }) => {
    const line = await pos.addLineToOrder(
        {
            product_id: product,
            product_tmpl_id: product.product_tmpl_id,
            price_unit: priceUnit,
            qty: 1,
            tax_ids: [["link", ...taxes]],
            freedelity_voucher_id: voucherId,
        },
        order,
        { force: true },
        false
    );
    // addLineToOrder resets the name to the product's: show the voucher instead.
    if (line) {
        line.full_product_name = name;
    }
    return line;
};
