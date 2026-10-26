# Part of pos_freedelity. See LICENSE file for full copyright and licensing details.

from odoo.exceptions import UserError, ValidationError
from odoo.tests import tagged

from odoo.addons.point_of_sale.tests.common import TestPoSCommon


@tagged('post_install', '-at_install')
class TestFreedelityBackend(TestPoSCommon):

    def setUp(self):
        super().setUp()
        self.config = self.basic_config
        self.voucher_product = self.env.ref('pos_freedelity.product_freedelity_voucher')

    def test_default_voucher_product(self):
        self.assertEqual(self.config.freedelity_voucher_product_id, self.voucher_product)
        self.assertEqual(self.config.freedelity_terminal_port, 9005)
        self.assertIn(self.voucher_product, self.config._get_special_products())

    def test_default_voucher_product_on_install(self):
        self.config.freedelity_voucher_product_id = False
        self.env['pos.config']._freedelity_default_voucher_product_on_install()
        self.assertEqual(self.config.freedelity_voucher_product_id, self.voucher_product)

    def test_settings_write_through(self):
        settings = self.env['res.config.settings'].create({'pos_config_id': self.config.id})
        settings.pos_freedelity_enabled = True
        settings.pos_freedelity_terminal_host = '192.168.1.50'
        settings.pos_freedelity_auto_start = True
        settings.execute()
        self.assertTrue(self.config.freedelity_enabled)
        self.assertEqual(self.config.freedelity_terminal_host, '192.168.1.50')
        self.assertTrue(self.config.freedelity_auto_start)

    def test_terminal_host_validation(self):
        with self.assertRaises(ValidationError):
            self.config.write({'freedelity_enabled': True, 'freedelity_terminal_host': 'http://192.168.1.50'})
        with self.assertRaises(ValidationError):
            self.config.write({'freedelity_enabled': True, 'freedelity_terminal_host': '192.168.1.50',
                               'freedelity_terminal_port': 70000})

    def test_open_ui_requires_terminal(self):
        self.config.freedelity_enabled = True
        with self.assertRaises(UserError):
            self.config.open_ui()

    def test_set_sync_state(self):
        self.config.open_ui()
        order = self.env['pos.order'].create({
            'session_id': self.config.current_session_id.id,
            'uuid': 'abc-123',
            'amount_total': 0, 'amount_tax': 0, 'amount_paid': 0, 'amount_return': 0,
            'freedelity_sync_state': 'pending',
        })
        pos_user = self.env['res.users'].create({
            'name': 'Cashier', 'login': 'freedelity_cashier',
            'group_ids': [(6, 0, [self.env.ref('point_of_sale.group_pos_user').id])],
        })
        PosOrder = self.env['pos.order'].with_user(pos_user)
        self.assertFalse(PosOrder.freedelity_set_sync_state('unknown-uuid', 'done'))
        self.assertFalse(PosOrder.freedelity_set_sync_state('abc-123', 'pending'))
        self.assertTrue(PosOrder.freedelity_set_sync_state('abc-123', 'error', 'boom'))
        self.assertEqual(order.freedelity_sync_state, 'error')
        self.assertEqual(order.freedelity_sync_message, 'boom')
        self.assertTrue(PosOrder.freedelity_set_sync_state('abc-123', 'done'))
        self.assertEqual(order.freedelity_sync_state, 'done')
        self.assertFalse(order.freedelity_sync_message)
