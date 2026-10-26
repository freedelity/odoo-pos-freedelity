import * as ProductScreen from "@point_of_sale/../tests/tours/utils/product_screen_util";
import * as PaymentScreen from "@point_of_sale/../tests/tours/utils/payment_screen_util";
import * as ReceiptScreen from "@point_of_sale/../tests/tours/utils/receipt_screen_util";
import * as Dialog from "@point_of_sale/../tests/tours/utils/dialog_util";
import * as Chrome from "@point_of_sale/../tests/tours/utils/chrome_util";
import { registry } from "@web/core/registry";

const openFreedelity = () => [
    {
        content: "open the Freedelity dialog",
        trigger: ".o_freedelity_button",
        run: "click",
    },
];

const customerIdentified = () => [
    {
        content: "the customer identified on the terminal",
        trigger: ".o_freedelity_customer:contains('Sophie Lambert')",
    },
    {
        content: "points are displayed",
        trigger: ".o_freedelity_points:contains('120')",
    },
];

const tickVoucher = (name) => [
    {
        content: `tick voucher ${name}`,
        trigger: `.o_freedelity_voucher:contains('${name}') input`,
        run: "click",
    },
];

const terminalControl = (changes) => [
    {
        content: `fake terminal: ${JSON.stringify(changes)}`,
        trigger: "body",
        run: async () => {
            const port = window.posmodel.config.freedelity_terminal_port;
            await fetch(`http://127.0.0.1:${port}/mock/control`, {
                method: "POST",
                body: JSON.stringify(changes),
            });
        },
    },
];

const outboxFlushed = () => [
    {
        content: "the sale reached the terminal and its state was reported to the server",
        trigger: "body",
        run: async () => {
            const freedelity = window.posmodel.freedelity;
            for (let i = 0; i < 150 && freedelity.outbox.length; i++) {
                await freedelity.flush();
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
            if (freedelity.outbox.length) {
                throw new Error("Freedelity outbox not flushed");
            }
        },
    },
];

const payCash = () => [
    ProductScreen.clickPayButton(),
    PaymentScreen.clickPaymentMethod("Cash"),
    PaymentScreen.clickValidate(),
    ReceiptScreen.isShown(),
].flat();

registry.category("web_tour.tours").add("pos_freedelity_identify_and_pay", {
    steps: () =>
        [
            Chrome.startPoS(),
            Dialog.confirm("Open Register"),
            ProductScreen.clickDisplayedProduct("Freedelity Sneaker"),
            ProductScreen.clickDisplayedProduct("Freedelity Book"),
            ProductScreen.totalAmountIs("50.00"),
            openFreedelity(),
            customerIdentified(),
            {
                content: "the voucher needing 100 EUR of purchase is disabled",
                trigger: ".o_freedelity_voucher:contains('min. 100') input:disabled",
            },
            tickVoucher("5 EUR welcome voucher"),
            tickVoucher("10% birthday voucher"),
            {
                content: "apply the vouchers",
                trigger: ".o_freedelity_apply",
                run: "click",
            },
            ProductScreen.totalAmountIs("40.00"),
            {
                content: "the button shows the customer",
                trigger: ".o_freedelity_button:contains('Sophie Lambert')",
            },
            payCash(),
            outboxFlushed(),
        ].flat(),
});

registry.category("web_tour.tours").add("pos_freedelity_offline_queue", {
    steps: () =>
        [
            Chrome.startPoS(),
            Dialog.confirm("Open Register"),
            ProductScreen.clickDisplayedProduct("Freedelity Sneaker"),
            openFreedelity(),
            customerIdentified(),
            {
                content: "close the dialog without voucher",
                trigger: ".modal-footer .btn-secondary",
                run: "click",
            },
            terminalControl({ offline: true }),
            payCash(),
            ReceiptScreen.clickNextOrder(),
            {
                content: "the sale waits for the terminal",
                trigger: ".o_freedelity_pending:contains('1')",
            },
            terminalControl({ offline: false }),
            outboxFlushed(),
            {
                content: "nothing waits for the terminal any more",
                trigger: ".o_freedelity_button:not(:has(.o_freedelity_pending))",
            },
        ].flat(),
});

registry.category("web_tour.tours").add("pos_freedelity_search_and_delete", {
    steps: () =>
        [
            Chrome.startPoS(),
            Dialog.confirm("Open Register"),
            ProductScreen.clickDisplayedProduct("Freedelity Sneaker"),
            openFreedelity(),
            {
                content: "waiting for the customer",
                trigger: ".o_freedelity_waiting",
            },
            {
                content: "open the search",
                trigger: ".o_freedelity_search_toggle",
                run: "click",
            },
            {
                content: "type a name",
                trigger: ".o_freedelity_pattern",
                run: "edit Lambert",
            },
            {
                content: "search",
                trigger: ".o_freedelity_search_button",
                run: "click",
            },
            {
                content: "pick the customer",
                trigger: ".o_freedelity_result:contains('Sophie Lambert')",
                run: "click",
            },
            customerIdentified(),
            {
                content: "close the dialog",
                trigger: ".modal-footer .btn-secondary",
                run: "click",
            },
            {
                content: "delete the order",
                trigger: "body",
                run: () => {
                    window.posmodel.onDeleteOrder(window.posmodel.get_order());
                },
            },
            Dialog.confirm(),
            {
                content: "the terminal session was closed",
                trigger: "body",
                run: async () => {
                    const port = window.posmodel.config.freedelity_terminal_port;
                    for (let i = 0; i < 50; i++) {
                        const response = await fetch(`http://127.0.0.1:${port}/mock/control`, {
                            method: "POST",
                            body: "{}",
                        });
                        if ((await response.json()).end_sessions) {
                            return;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 200));
                    }
                    throw new Error("The terminal session was not closed");
                },
            },
        ].flat(),
});

registry.category("web_tour.tours").add("pos_freedelity_auto_start", {
    steps: () =>
        [
            Chrome.startPoS(),
            Dialog.confirm("Open Register"),
            ProductScreen.clickDisplayedProduct("Freedelity Sneaker"),
            {
                content: "the customer identified without opening the dialog",
                trigger: ".o_freedelity_button:contains('Sophie Lambert')",
            },
            payCash(),
            outboxFlushed(),
        ].flat(),
});
