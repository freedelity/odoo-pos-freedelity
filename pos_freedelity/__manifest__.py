# Part of pos_freedelity. See LICENSE file for full copyright and licensing details.
{
    'name': 'POS Freedelity Loyalty',
    'version': '19.0.1.0.0',
    'category': 'Sales/Point of Sale',
    'summary': 'Identify loyalty customers, redeem their vouchers and register their sales '
               'with the Freedelity CustomerScreen terminal',
    'description': """
Connects the Odoo point of sale to a Freedelity CustomerScreen terminal on the local network (ECR protocol v3):
customer identification, voucher redemption and sale registration.

Data sent: when Freedelity is enabled in the Point of Sale settings (disabled by default), the cash register's
browser sends each paid order to the terminal: order reference, totals, vouchers used, and the name, reference,
category, quantity and price of each product. The terminal forwards it to the merchant's Freedelity loyalty
account (Freedelity SA, Belgium). Nothing is sent by the Odoo server and nothing is sent while the option is off.
""",
    'author': 'Freedelity SA',
    'maintainer': 'Freedelity SA',
    'website': 'https://www.freedelity.be',
    'support': 'support@freedelity.be',
    'license': 'LGPL-3',
    'depends': ['point_of_sale'],
    'data': [
        'data/product_data.xml',
        'views/res_config_settings_views.xml',
        'views/pos_order_views.xml',
    ],
    'assets': {
        'point_of_sale._assets_pos': [
            'pos_freedelity/static/src/**/*',
        ],
        'web.assets_tests': [
            'pos_freedelity/static/tests/tours/**/*',
        ],
    },
    'images': ['static/description/banner.png'],
    'installable': True,
    'application': False,
}
