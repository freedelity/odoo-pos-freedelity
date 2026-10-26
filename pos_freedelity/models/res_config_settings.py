# Part of pos_freedelity. See LICENSE file for full copyright and licensing details.

from odoo import fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    pos_freedelity_enabled = fields.Boolean(related='pos_config_id.freedelity_enabled', readonly=False)
    pos_freedelity_terminal_host = fields.Char(related='pos_config_id.freedelity_terminal_host', readonly=False)
    pos_freedelity_terminal_port = fields.Integer(related='pos_config_id.freedelity_terminal_port', readonly=False)
    pos_freedelity_voucher_product_id = fields.Many2one(
        related='pos_config_id.freedelity_voucher_product_id', readonly=False)
    pos_freedelity_auto_start = fields.Boolean(related='pos_config_id.freedelity_auto_start', readonly=False)
