#!/usr/bin/env python3
# Part of pos_freedelity. See LICENSE file for full copyright and licensing details.
"""In-process fake of a Freedelity CustomerScreen terminal (ECR protocol v3, HTTP framing).

Mirrors the behaviour of the real terminal (apps/customer-screen/lib/services/ecr/ecr_handler.dart):
plain HTTP, ``POST /ecr_command`` with a JSON body, ``OPTIONS`` preflight answered with ``*`` CORS
headers, business errors returned as HTTP 200 + ``{"status": "error", "reason": ...}``, commands that
need time answered ``pending`` until polled again, sessions renamed after END_SESSION so a second
END_SESSION returns ``session_not_found``.

Has no Odoo dependency: it is imported by the tests and can run standalone for manual testing::

    python3 ecr_mock.py --port 9005
"""
import argparse
import copy
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_CUSTOMER = {
    'id': 7755447,
    'firstname': 'Sophie',
    'name': 'Lambert',
    'sex': 'F',
    'lang': 'fr',
    'postal': 1400,
    'city': 'Nivelles',
    'country': 'BE',
    'points': 120,
    'credit': 0,
}

DEFAULT_VOUCHERS = [
    {'id': 501, 'name': '5 EUR welcome voucher', 'value': 5.0, 'balance': 5.0, 'minpurchase': 0.0,
     'partialauthorized': False, 'percentage': 0, 'validityend': '2099-12-31'},
    {'id': 502, 'name': '10% birthday voucher', 'value': 0.0, 'balance': 0.0, 'minpurchase': 0.0,
     'partialauthorized': False, 'percentage': 10, 'validityend': '2099-12-31'},
    {'id': 503, 'name': '20 EUR voucher (min. 100 EUR)', 'value': 20.0, 'balance': 20.0,
     'minpurchase': 100.0, 'partialauthorized': False, 'percentage': 0, 'validityend': '2099-12-31'},
]


class EcrMockTerminal:
    """State of the fake terminal. All attributes may be changed by tests while it runs."""

    def __init__(self, host='127.0.0.1', port=0):
        self.customer = copy.deepcopy(DEFAULT_CUSTOMER)
        self.vouchers = copy.deepcopy(DEFAULT_VOUCHERS)
        self.search_results = [{'id': self.customer['id'], 'name': self.customer['name'],
                                'firstname': self.customer['firstname'], 'zip': '1400', 'city': 'Nivelles'}]
        self.pending_polls = 2          # number of `pending` answers before a polled command succeeds
        self.busy_end_sessions = 0      # number of END_SESSION(force=false) answered `busy`
        self.identify = True            # False: the customer never identifies on the screen
        self.offline = False            # True: drop every connection without answering
        self.sessions = {}              # id -> dict(state)
        self.active_session = None
        self.commands = []              # every command received, in order
        self.end_sessions = []          # END_SESSION payloads that closed a session
        self.lock = threading.Lock()
        self._server = ThreadingHTTPServer((host, port), self._make_handler())
        self._server.daemon_threads = True
        self._thread = None

    @property
    def port(self):
        return self._server.server_address[1]

    def start(self):
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self

    def stop(self):
        self._server.shutdown()
        self._server.server_close()

    # ------------------------------------------------------------------ protocol
    def _poll(self, session, key):
        """Return True once `key` has been polled more than `pending_polls` times."""
        session[key] = session.get(key, 0) + 1
        return session[key] > self.pending_polls

    def handle(self, cmd):
        action = cmd.get('action')
        sid = cmd.get('id')
        sid = None if sid is None else str(sid)
        self.commands.append(cmd)
        session = self.sessions.get(sid) if sid is not None else None

        if action == 'get_version':
            return {'status': 'success', 'app': '1.2.0-mock', 'minProtocolVersion': 1, 'maxProtocolVersion': 3}
        if action == 'get_active_session':
            if self.active_session is None:
                return {'status': 'error', 'reason': 'session_not_found'}
            return {'status': 'success', 'id': self.active_session}
        if action == 'start_session':
            self.sessions[sid] = {'customer': None}
            if cmd.get('force_active', True):
                self.active_session = sid
            return {'status': 'success'}
        if action not in ('get_customer_details', 'get_vouchers') and session is None:
            return {'status': 'error', 'reason': 'session_not_found'}
        if action == 'select_session':
            if cmd.get('only_if_idle') and self.active_session not in (None, sid):
                return {'status': 'error', 'reason': 'busy'}
            self.active_session = sid
            return {'status': 'success'}
        if action == 'unselect_session':
            if self.active_session == sid:
                self.active_session = None
            return {'status': 'success'}
        if action in ('get_customer_details', 'get_vouchers'):
            # Still answered after END_SESSION (app >= 1.2.0), under the original id.
            session = session or self.sessions.get('-%s' % sid)
            if session is None:
                return {'status': 'error', 'reason': 'session_not_found'}
            if action == 'get_customer_details':
                if session['customer'] is None:
                    if not self.identify or not self._poll(session, 'details_polls'):
                        return {'status': 'pending'}
                    session['customer'] = copy.deepcopy(self.customer)
                return {'status': 'success', 'complete': True, 'customer': session['customer']}
            if session['customer'] is None:
                return {'status': 'error', 'reason': 'cancelled', 'message': 'customer not identified'}
            if not self._poll(session, 'voucher_polls'):
                return {'status': 'pending'}
            return {'status': 'success', 'vouchers': copy.deepcopy(self.vouchers)}
        if action == 'search_customer':
            if not self._poll(session, 'search_polls'):
                return {'status': 'pending'}
            return {'status': 'success', 'customers': copy.deepcopy(self.search_results)}
        if action == 'select_customer':
            match = [c for c in self.search_results if c['id'] == cmd.get('customer')]
            if not match:
                return {'status': 'error', 'reason': 'cancelled', 'message': 'customer not found'}
            session['customer'] = dict(copy.deepcopy(self.customer), **match[0])
            return {'status': 'success'}
        if action == 'end_session':
            has_sale = any(k in cmd for k in ('total_paid', 'vouchers_usage', 'savings', 'products_data'))
            if has_sale and ('sale_id' not in cmd or 'total' not in cmd):
                return {'status': 'error', 'reason': 'missing_parameter'}
            if not cmd.get('force', True) and self.busy_end_sessions > 0:
                self.busy_end_sessions -= 1
                return {'status': 'error', 'reason': 'busy'}
            self.end_sessions.append(cmd)
            self.sessions['-%s' % sid] = self.sessions.pop(sid)
            if self.active_session == sid:
                self.active_session = None
            return {'status': 'success'}
        return {'status': 'error', 'reason': 'unsupported', 'minProtocolVersion': 1, 'maxProtocolVersion': 3}

    # ------------------------------------------------------------------ HTTP
    def _make_handler(self):
        terminal = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *args):
                pass

            def _send(self, status, body=b'', content_type='application/json'):
                self.send_response(status)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_OPTIONS(self):
                self.send_response(200)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Headers', '*')
                self.send_header('Access-Control-Allow-Methods', '*')
                self.send_header('Content-Length', '0')
                self.end_headers()

            def do_POST(self):
                length = int(self.headers.get('Content-Length') or 0)
                raw = self.rfile.read(length)
                if self.path == '/mock/control':
                    # Test hook (not part of the protocol): set attributes of the fake terminal.
                    changes = json.loads(raw.decode('utf-8') or '{}')
                    with terminal.lock:
                        for key in ('offline', 'identify', 'pending_polls', 'busy_end_sessions'):
                            if key in changes:
                                setattr(terminal, key, changes[key])
                        state = {'status': 'success', 'end_sessions': len(terminal.end_sessions)}
                    return self._send(200, json.dumps(state).encode())
                if terminal.offline:
                    self.close_connection = True
                    self.connection.close()
                    return
                if self.path != '/ecr_command':
                    return self._send(404, b'not found', 'text/plain')
                try:
                    cmd = json.loads(raw.decode('utf-8') or '{}')
                    assert isinstance(cmd, dict) and 'action' in cmd
                except Exception:  # noqa: BLE001 - the real terminal answers 417 to any malformed body
                    return self._send(417, b'malformed request', 'text/plain')
                with terminal.lock:
                    reply = terminal.handle(cmd)
                self._send(200, json.dumps(reply).encode())

        return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=9005)
    args = parser.parse_args()
    terminal = EcrMockTerminal(args.host, args.port)
    print('Fake CustomerScreen terminal listening on http://%s:%s/ecr_command' % (args.host, terminal.port))
    try:
        terminal._server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
