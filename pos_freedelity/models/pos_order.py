# Part of pos_freedelity. See LICENSE file for full copyright and licensing details.

from odoo import api, fields, models


class PosOrder(models.Model):
    _inherit = 'pos.order'

    freedelity_customer_id = fields.Integer(string='Freedelity Customer ID', readonly=True, copy=False)
    freedelity_customer_name = fields.Char(string='Freedelity Customer', readonly=True, copy=False)
    freedelity_points = fields.Integer(
        string='Freedelity Points', readonly=True, copy=False,
        help='Points balance of the customer when they identified, before this sale.')
    freedelity_sync_state = fields.Selection([
        ('pending', 'Waiting for terminal'),
        ('done', 'Sent to terminal'),
        ('error', 'Error'),
    ], string='Freedelity Status', readonly=True, copy=False, index='btree_not_null')
    freedelity_sync_message = fields.Char(string='Freedelity Message', readonly=True, copy=False)
    freedelity_data = fields.Text(
        string='Freedelity Data', readonly=True, copy=False,
        help='Technical: JSON with the vouchers offered by the terminal for this order.')

    @api.model
    def freedelity_set_sync_state(self, uuid, state, message=False):
        """Called by the point of sale once the terminal acknowledged (or refused) the sale.

        Returns False when the order is not on the server yet, so the POS retries later.
        """
        if state not in ('done', 'error'):
            return False
        order = self.search([('uuid', '=', uuid)], limit=1)
        if not order:
            return False
        order.sudo().write({'freedelity_sync_state': state, 'freedelity_sync_message': message or False})
        return True


class PosOrderLine(models.Model):
    _inherit = 'pos.order.line'

    freedelity_voucher_id = fields.Integer(string='Freedelity Voucher ID', readonly=True, copy=False)

    @api.model
    def _load_pos_data_fields(self, config_id):
        return super()._load_pos_data_fields(config_id) + ['freedelity_voucher_id']
