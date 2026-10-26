# Part of pos_freedelity. See LICENSE file for full copyright and licensing details.

from odoo import models


class ProductProduct(models.Model):
    _inherit = 'product.product'

    def _load_pos_data(self, data):
        # The voucher product is not sold from the product grid; make sure it is loaded anyway.
        res = super()._load_pos_data(data)
        config = self.env['pos.config'].browse(data['pos.config']['data'][0]['id'])
        product_id = config.freedelity_voucher_product_id.id
        if config.freedelity_enabled and product_id and product_id not in {p['id'] for p in res['data']}:
            product_model = self.env['product.product'].with_context(display_default_code=False)
            product = product_model.search_read([('id', '=', product_id)], fields=res['fields'], load=False)
            self._process_pos_ui_product_product(product, config)
            res['data'].extend(product)
        return res
