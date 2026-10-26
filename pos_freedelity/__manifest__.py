# Part of pos_freedelity. See LICENSE file for full copyright and licensing details.
{
    'name': 'Freedelity Loyalty for Point of Sale',
    'version': '19.0.1.0.0',
    'category': 'Sales/Point of Sale',
    'summary': 'Identify loyalty customers, redeem their vouchers and register their sales '
               'with the Freedelity CustomerScreen terminal',
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
