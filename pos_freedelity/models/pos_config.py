# Part of pos_freedelity. See LICENSE file for full copyright and licensing details.

from odoo import _, api, fields, models
from odoo.exceptions import UserError, ValidationError


class PosConfig(models.Model):
    _inherit = 'pos.config'

    freedelity_enabled = fields.Boolean(
        string='Freedelity Loyalty',
        help='Identify customers, apply their vouchers and register sales on a Freedelity CustomerScreen terminal.')
    freedelity_terminal_host = fields.Char(
        string='Terminal IP Address',
        help='Local IP address of the CustomerScreen terminal, e.g. 192.168.1.50. '
             'The terminal must allow the IP address of the device running the point of sale.')
    freedelity_terminal_port = fields.Integer(string='Terminal Port', default=9005)
    freedelity_voucher_product_id = fields.Many2one(
        'product.product', string='Voucher Product',
        default=lambda self: self.env.ref('pos_freedelity.product_freedelity_voucher', raise_if_not_found=False),
        help='Product used for the discount lines created when a Freedelity voucher is applied.')
    freedelity_auto_start = fields.Boolean(
        string='Start Identification Automatically',
        help='Open a session on the terminal as soon as a product is added to a new order, '
             'so the customer can identify while the order is being rung up.')

    @api.constrains('freedelity_enabled', 'freedelity_terminal_host', 'freedelity_terminal_port')
    def _check_freedelity_terminal(self):
        for config in self.filtered('freedelity_enabled'):
            if config.freedelity_terminal_port and not 0 < config.freedelity_terminal_port < 65536:
                raise ValidationError(_('The Freedelity terminal port must be between 1 and 65535.'))
            host = (config.freedelity_terminal_host or '').strip()
            if host and ('/' in host or ':' in host.strip('[]') and not host.startswith('[')):
                raise ValidationError(_('Enter only the IP address of the Freedelity terminal, without "http://" or port.'))

    def open_ui(self):
        for config in self:
            if not config.current_session_id and config.freedelity_enabled:
                if not config.freedelity_terminal_host:
                    raise UserError(_('Set the IP address of the Freedelity terminal in the Point of Sale settings.'))
                if not config.freedelity_voucher_product_id:
                    raise UserError(_('Set the Freedelity voucher product in the Point of Sale settings.'))
        return super().open_ui()

    def _get_special_products(self):
        res = super()._get_special_products()
        default_product = self.env.ref('pos_freedelity.product_freedelity_voucher', raise_if_not_found=False) \
            or self.env['product.product']
        return res | self.env['pos.config'].search([]).mapped('freedelity_voucher_product_id') | default_product
