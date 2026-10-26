# Part of pos_freedelity. See LICENSE file for full copyright and licensing details.

from odoo import Command
from odoo.tests import tagged

from odoo.addons.point_of_sale.tests.test_frontend import TestPointOfSaleHttpCommon

from .ecr_mock import EcrMockTerminal


@tagged('post_install', '-at_install')
class TestFreedelityUi(TestPointOfSaleHttpCommon):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tax_21 = cls.env['account.tax'].create({
            'name': 'VAT 21% incl.',
            'amount_type': 'percent',
            'amount': 21.0,
            'type_tax_use': 'sale',
            'price_include_override': 'tax_included',
        })
        cls.tax_6 = cls.env['account.tax'].create({
            'name': 'VAT 6% incl.',
            'amount_type': 'percent',
            'amount': 6.0,
            'type_tax_use': 'sale',
            'price_include_override': 'tax_included',
        })
        cls.category = cls.env['pos.category'].create({'name': 'Freedelity Shoes'})
        cls.product_a = cls.env['product.product'].create({
            'name': 'Freedelity Sneaker',
            'lst_price': 30.0,
            'default_code': 'SNK-01',
            'barcode': '5410000000017',
            'taxes_id': [Command.set(cls.tax_21.ids)],
            'pos_categ_ids': [Command.set(cls.category.ids)],
            'available_in_pos': True,
        })
        cls.product_b = cls.env['product.product'].create({
            'name': 'Freedelity Book',
            'lst_price': 20.0,
            'taxes_id': [Command.set(cls.tax_6.ids)],
            'available_in_pos': True,
        })

    def setUp(self):
        super().setUp()
        self.terminal = EcrMockTerminal().start()
        self.addCleanup(self.terminal.stop)
        self.main_pos_config.write({
            'freedelity_enabled': True,
            'freedelity_terminal_host': '127.0.0.1',
            'freedelity_terminal_port': self.terminal.port,
        })

    def _order(self):
        return self.env['pos.order'].search([('config_id', '=', self.main_pos_config.id)], order='id desc', limit=1)

    def test_identify_vouchers_and_sale(self):
        self.terminal.busy_end_sessions = 2
        self.main_pos_config.with_user(self.pos_user).open_ui()
        self.start_pos_tour('pos_freedelity_identify_and_pay')

        order = self._order()
        self.assertEqual(order.freedelity_customer_id, 7755447)
        self.assertEqual(order.freedelity_customer_name, 'Sophie Lambert')
        self.assertEqual(order.freedelity_points, 120)
        self.assertEqual(order.freedelity_sync_state, 'done')
        self.assertAlmostEqual(order.amount_total, 40.0, places=2)
        voucher_lines = order.lines.filtered('freedelity_voucher_id')
        self.assertEqual(set(voucher_lines.mapped('freedelity_voucher_id')), {501, 502})
        # One discount line per tax group and voucher: the taxable base of each rate is reduced.
        self.assertEqual(len(voucher_lines), 4)
        self.assertEqual(set(voucher_lines.tax_ids.ids), {self.tax_21.id, self.tax_6.id})

        self.assertEqual(len(self.terminal.end_sessions), 1)
        sale = self.terminal.end_sessions[0]
        self.assertEqual(sale['id'], order.uuid)
        self.assertEqual(sale['sale_id'], order.pos_reference)
        self.assertFalse(sale['force'])
        self.assertAlmostEqual(sale['total'], 50.0, places=2)
        self.assertAlmostEqual(sale['total_paid'], 40.0, places=2)
        self.assertEqual(sorted(v['id'] for v in sale['vouchers_usage']), [501, 502])
        products = {p['name']: p for p in sale['products_data']}
        self.assertEqual(products['Freedelity Sneaker'], {
            'name': 'Freedelity Sneaker', 'ref': 'SNK-01', 'ean': '5410000000017',
            'cat': 'Freedelity Shoes', 'catref': str(self.category.id),
            'quantity': 1, 'price': 30.0, 'promotion': False,
        })
        self.assertEqual(products['Freedelity Book']['ref'], str(self.product_b.id))
        busy = [c for c in self.terminal.commands if c['action'] == 'end_session']
        self.assertEqual(len(busy), 3, 'two busy answers, then the unforced END_SESSION succeeds')

    def test_terminal_offline_sale_is_queued(self):
        self.main_pos_config.with_user(self.pos_user).open_ui()
        self.start_pos_tour('pos_freedelity_offline_queue')
        order = self._order()
        self.assertEqual(order.freedelity_sync_state, 'done')
        self.assertEqual(len(self.terminal.end_sessions), 1)
        self.assertEqual(self.terminal.end_sessions[0]['sale_id'], order.pos_reference)
        self.assertEqual(self.terminal.end_sessions[0]['vouchers_usage'], [])

    def test_search_customer_and_delete_order(self):
        self.terminal.identify = False
        self.main_pos_config.with_user(self.pos_user).open_ui()
        self.start_pos_tour('pos_freedelity_search_and_delete')
        actions = [c['action'] for c in self.terminal.commands]
        self.assertIn('search_customer', actions)
        self.assertIn('select_customer', actions)
        # The deleted order closes its terminal session without registering a sale.
        self.assertEqual(len(self.terminal.end_sessions), 1)
        self.assertNotIn('sale_id', self.terminal.end_sessions[0])

    def test_auto_start(self):
        self.main_pos_config.freedelity_auto_start = True
        self.main_pos_config.with_user(self.pos_user).open_ui()
        self.start_pos_tour('pos_freedelity_auto_start')
        self.assertEqual(self._order().freedelity_customer_id, 7755447)
