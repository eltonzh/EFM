import asyncio, json, random, os, mimetypes, datetime, time, zoneinfo, hashlib
from pathlib import Path
import websockets
from websockets import Response
from websockets.datastructures import Headers
import anthropic
import openai

REPO_DIR = Path(__file__).parent.resolve()
CHAT_FILE     = REPO_DIR / 'chat_history.json'
IDENTITY_FILE = REPO_DIR / 'identities.json'

# Unambiguous chars (no I, O, 0, 1)
CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

ACCOUNTS_FILE = REPO_DIR / 'accounts.json'

def load_accounts():
    if ACCOUNTS_FILE.exists():
        try:
            return json.loads(ACCOUNTS_FILE.read_text())
        except Exception:
            pass
    return {}

def save_accounts():
    ACCOUNTS_FILE.write_text(json.dumps(accounts))

def load_identities():
    if IDENTITY_FILE.exists():
        try:
            return json.loads(IDENTITY_FILE.read_text())
        except Exception:
            pass
    return {'by_device': {}, 'by_code': {}}

def save_identities_file():
    IDENTITY_FILE.write_text(json.dumps(identity_store))

def initials_from_name(name):
    parts = name.strip().split()
    if not parts:
        return 'XX'
    first_init = parts[0][0].upper() if parts[0] else 'X'
    if len(parts) >= 2:
        last_part = parts[-1]
        # "Z." format (last initial with dot)
        if len(last_part) == 2 and last_part[1] == '.':
            last_init = last_part[0].upper()
        else:
            last_init = last_part[0].upper()
    else:
        # No last initial — use second letter of first name
        last_init = parts[0][1].upper() if len(parts[0]) > 1 else 'X'
    return first_init + last_init

SUFFIX_CHARS = '0123456789!@#$%&*+'

def generate_code(name=''):
    prefix = initials_from_name(name) if name else 'XX'
    for _ in range(100):
        suffix = ''.join(random.choice(SUFFIX_CHARS) for _ in range(3))
        code = prefix + suffix
        if code not in identity_store['by_code']:
            return code
    return prefix + ''.join(random.choice(SUFFIX_CHARS) for _ in range(5))

MAX_NAME_LEN      = 40
MAX_TEXT_LEN      = 1000
MAX_ID_LEN        = 64
MAX_MSG_BYTES     = 65_536   # 64 KB hard cap per WebSocket message
MAX_HISTORY_ITEMS = 6        # history items client may send for Claude context
CLAUDE_RPM        = 5        # max ask_claude calls per connection per 60 s

def load_chat_history():
    if CHAT_FILE.exists():
        try:
            data = json.loads(CHAT_FILE.read_text())
            if data.get('date') == datetime.datetime.now(zoneinfo.ZoneInfo('America/Los_Angeles')).date().isoformat():
                return data.get('messages', [])
        except Exception:
            pass
    return []

def save_chat_history():
    CHAT_FILE.write_text(json.dumps({'date': datetime.datetime.now(zoneinfo.ZoneInfo('America/Los_Angeles')).date().isoformat(), 'messages': chat_history}))

def check_daily_reset():
    if CHAT_FILE.exists():
        try:
            data = json.loads(CHAT_FILE.read_text())
            if data.get('date') != datetime.datetime.now(zoneinfo.ZoneInfo('America/Los_Angeles')).date().isoformat():
                chat_history.clear()
                save_chat_history()
        except Exception:
            pass

def now_iso():
    return datetime.datetime.utcnow().isoformat() + 'Z'

async def process_request(connection, request):
    if request.headers.get('Upgrade', '').lower() == 'websocket':
        return None  # let WebSocket upgrade proceed normally
    path = request.path.split('?')[0].lstrip('/')
    if not path:
        path = 'index.html'
    # Prevent path traversal — resolve and confirm it stays inside REPO_DIR
    file_path = (REPO_DIR / path).resolve()
    if not str(file_path).startswith(str(REPO_DIR) + os.sep) and file_path != REPO_DIR:
        return Response(403, 'Forbidden', Headers([('Content-Type', 'text/plain')]), b'Forbidden')
    if file_path.is_file():
        mime, _ = mimetypes.guess_type(str(file_path))
        body = file_path.read_bytes()
        no_cache = mime and (mime.startswith('text/') or mime in ('application/javascript',))
        headers = [
            ('Content-Type', mime or 'application/octet-stream'),
            ('Content-Length', str(len(body))),
        ]
        if no_cache:
            headers.append(('Cache-Control', 'no-cache'))
        return Response(200, 'OK', Headers(headers), body)
    return Response(404, 'Not Found', Headers([('Content-Type', 'text/plain')]), b'Not found')

# 36 colors evenly spread around the hue wheel — vibrant, all distinct
COLORS = [f'hsl({h * 10}, 82%, 56%)' for h in range(36)]

clients        = {}    # websocket -> {id, name, color}
chat_clients   = set() # websockets that are in the chat room
chat_history   = load_chat_history()
identity_store = load_identities()  # {by_device: {device_id: {...}}, by_code: {code: device_id}}
accounts       = load_accounts()    # {email: {password_hash, name, fv, sfv, code}}
MAX_HISTORY  = 500

free_colors = list(COLORS)
random.shuffle(free_colors)

def pick_color():
    if free_colors:
        return free_colors.pop()
    return f'hsl({random.randint(0, 359)}, 82%, 56%)'

def release_color(color):
    if color in COLORS and color not in free_colors:
        free_colors.append(color)

async def broadcast_cursors(data, exclude=None):
    msg = json.dumps(data)
    for ws in list(clients):
        if ws is not exclude:
            try:
                await ws.send(msg)
            except Exception:
                pass

async def broadcast_chat(data):
    msg = json.dumps(data)
    for ws in list(chat_clients):
        try:
            await ws.send(msg)
        except Exception:
            pass

async def handler(websocket):
    color = None
    claude_timestamps = []  # per-connection rate-limit window
    try:
        async for raw in websocket:
            # Drop oversized messages before parsing
            if isinstance(raw, (bytes, str)) and len(raw) > MAX_MSG_BYTES:
                continue
            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                continue
            if not isinstance(data, dict):
                continue
            kind = data.get('type')

            # ── cursor events ──────────────────────────────────────────
            if kind == 'join':
                name = str(data.get('name', 'Guest'))[:MAX_NAME_LEN].strip() or 'Guest'
                cid  = str(data.get('id',   ''))[:MAX_ID_LEN]
                existing_names = {v['name'] for v in clients.values()}
                display_name = name
                if display_name in existing_names:
                    n = 2
                    while f'{name} {n}' in existing_names:
                        n += 1
                    display_name = f'{name} {n}'
                color = pick_color()
                info  = {'id': cid, 'name': display_name, 'color': color}
                clients[websocket] = info
                await websocket.send(json.dumps({'type': 'color_assign', 'color': color, 'name': display_name}))
                existing = [v for k, v in clients.items() if k is not websocket]
                if existing:
                    await websocket.send(json.dumps({'type': 'init', 'cursors': existing}))
                await broadcast_cursors({'type': 'join', **info}, exclude=websocket)

            elif kind == 'move':
                # Only relay validated numeric coords + known id — never forward raw data
                try:
                    x = float(data.get('x', 0))
                    y = float(data.get('y', 0))
                    cid = str(data.get('id', ''))[:MAX_ID_LEN]
                    await broadcast_cursors({'type': 'move', 'id': cid, 'x': x, 'y': y}, exclude=websocket)
                except (TypeError, ValueError):
                    pass

            # ── chat events ────────────────────────────────────────────
            elif kind == 'chat_join':
                chat_clients.add(websocket)
                await websocket.send(json.dumps({'type': 'chat_history', 'messages': chat_history}))

            elif kind == 'chat':
                check_daily_reset()
                name = str(data.get('name', 'Guest'))[:MAX_NAME_LEN].strip() or 'Guest'
                text = str(data.get('text', ''))[:MAX_TEXT_LEN].strip()
                if not text:
                    continue
                # Use server timestamp — never trust client-supplied time
                msg = {'name': name, 'text': text, 'time': now_iso()}
                chat_history.append(msg)
                if len(chat_history) > MAX_HISTORY:
                    chat_history.pop(0)
                save_chat_history()
                await broadcast_chat({'type': 'chat', **msg})

            elif kind == 'ask_claude':
                # Per-connection rate limit: CLAUDE_RPM requests per 60 s
                ts_now = time.monotonic()
                claude_timestamps = [t for t in claude_timestamps if ts_now - t < 60]
                if len(claude_timestamps) >= CLAUDE_RPM:
                    await websocket.send(json.dumps({
                        'type': 'claude_reply', 'name': 'Claude',
                        'text': "You're asking too fast — wait a moment and try again.",
                        'time': now_iso()
                    }))
                    continue
                claude_timestamps.append(ts_now)

                user_text = str(data.get('text', ''))[:MAX_TEXT_LEN].strip()
                if not user_text:
                    continue

                raw_history = data.get('history', [])
                if not isinstance(raw_history, list):
                    raw_history = []
                raw_history = raw_history[-MAX_HISTORY_ITEMS:]  # cap depth

                api_key = os.environ.get('ANTHROPIC_API_KEY', '')
                if not api_key:
                    reply = "I can't respond right now — no API key is configured."
                else:
                    try:
                        aclient = anthropic.AsyncAnthropic(api_key=api_key)
                        messages = []
                        for m in raw_history:
                            if not isinstance(m, dict):
                                continue
                            role    = 'user' if m.get('who') == 'user' else 'assistant'
                            content = str(m.get('text', ''))[:MAX_TEXT_LEN]
                            messages.append({'role': role, 'content': content})
                        # API requires messages to start with 'user' and alternate roles
                        while messages and messages[0]['role'] != 'user':
                            messages.pop(0)
                        clean = []
                        for msg in messages:
                            if clean and clean[-1]['role'] == msg['role']:
                                clean[-1] = msg
                            else:
                                clean.append(msg)
                        clean.append({'role': 'user', 'content': user_text})
                        response = await aclient.messages.create(
                            model='claude-sonnet-4-6',
                            max_tokens=250,
                            system="You are Claude, a helpful AI in EFM (Elton's Fun Math). Be friendly, brief, and encouraging. Answer math questions clearly. Never greet with 'Welcome to EFM' or re-introduce yourself — just answer directly.",
                            messages=clean
                        )
                        reply = response.content[0].text
                    except Exception as e:
                        reply = f"Oops, something went wrong: {str(e)[:80]}"
                await websocket.send(json.dumps({'type': 'claude_reply', 'name': 'Claude', 'text': reply, 'time': now_iso()}))

            elif kind == 'register':
                email    = str(data.get('email',    '')).lower().strip()[:120]
                password = str(data.get('password', ''))[:200]
                name     = str(data.get('name',     ''))[:MAX_NAME_LEN].strip()
                if not email or '@' not in email or not password or not name:
                    await websocket.send(json.dumps({'type': 'register_error', 'message': 'Please fill in all fields.'}))
                    continue
                if len(password) < 6:
                    await websocket.send(json.dumps({'type': 'register_error', 'message': 'Password must be at least 6 characters.'}))
                    continue
                if email in accounts:
                    await websocket.send(json.dumps({'type': 'register_error', 'message': 'That email is already registered. Use your account code to log in.'}))
                    continue
                pw_hash = hashlib.sha256(password.encode()).hexdigest()
                code    = generate_code(name)
                accounts[email] = {'password_hash': pw_hash, 'name': name, 'fv': '', 'sfv': '', 'code': code}
                identity_store['by_code'][code]             = 'email:' + email
                identity_store['by_device']['email:' + email] = {'name': name, 'fv': '', 'sfv': '', 'code': code}
                save_accounts()
                save_identities_file()
                await websocket.send(json.dumps({'type': 'register_ok', 'code': code}))

            elif kind == 'save_identity':
                device_id = str(data.get('device_id', ''))[:64].strip()
                name      = str(data.get('name', ''))[:MAX_NAME_LEN].strip()
                fv        = str(data.get('fv',  ''))[:64].strip()
                sfv       = str(data.get('sfv', ''))[:64].strip()
                if device_id and name:
                    existing = identity_store['by_device'].get(device_id, {})
                    code = existing.get('code') or generate_code(name)
                    identity_store['by_device'][device_id] = {'name': name, 'fv': fv, 'sfv': sfv, 'code': code}
                    identity_store['by_code'][code] = device_id
                    save_identities_file()
                    await websocket.send(json.dumps({'type': 'identity_saved', 'code': code}))

            elif kind == 'get_identity':
                device_id = str(data.get('device_id', ''))[:64].strip()
                record    = identity_store['by_device'].get(device_id)
                await websocket.send(json.dumps({'type': 'identity_data', 'identity': record}))

            elif kind == 'get_identity_by_code':
                code      = str(data.get('code', '')).upper().strip()[:8]
                device_id = identity_store['by_code'].get(code)
                record    = identity_store['by_device'].get(device_id) if device_id else None
                await websocket.send(json.dumps({'type': 'identity_data', 'identity': record, 'from_code': True}))

            elif kind == 'ask_chatgpt':
                user_text = str(data.get('text', ''))[:MAX_TEXT_LEN].strip()
                if not user_text:
                    continue
                raw_history = data.get('history', [])
                if not isinstance(raw_history, list):
                    raw_history = []
                raw_history = raw_history[-MAX_HISTORY_ITEMS:]
                api_key = os.environ.get('ANTHROPIC_API_KEY', '')
                if not api_key:
                    reply = "I can't respond right now — no API key is configured."
                else:
                    try:
                        aclient = anthropic.AsyncAnthropic(api_key=api_key)
                        messages = []
                        for m in raw_history:
                            if not isinstance(m, dict):
                                continue
                            role = 'user' if m.get('who') == 'user' else 'assistant'
                            messages.append({'role': role, 'content': str(m.get('text', ''))[:MAX_TEXT_LEN]})
                        while messages and messages[0]['role'] != 'user':
                            messages.pop(0)
                        clean = []
                        for msg in messages:
                            if clean and clean[-1]['role'] == msg['role']:
                                clean[-1] = msg
                            else:
                                clean.append(msg)
                        clean.append({'role': 'user', 'content': user_text})
                        response = await aclient.messages.create(
                            model='claude-sonnet-4-6',
                            max_tokens=250,
                            system="You are a helpful AI in EFM (Elton's Fun Math). Be friendly, brief, and encouraging. Answer math questions clearly. Never re-introduce yourself — just answer directly.",
                            messages=clean
                        )
                        reply = response.content[0].text
                    except Exception as e:
                        reply = f"Oops, something went wrong: {str(e)[:80]}"
                await websocket.send(json.dumps({'type': 'gpt_reply', 'name': 'ChatGPT', 'text': reply, 'time': now_iso()}))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        chat_clients.discard(websocket)
        if websocket in clients:
            cid = clients.pop(websocket)['id']
            release_color(color)
            await broadcast_cursors({'type': 'leave', 'id': cid})

async def main():
    port = int(os.environ.get('PORT', 8080))
    host = '0.0.0.0'
    async with websockets.serve(handler, host, port, process_request=process_request):
        print(f'Cursor + chat server running on {host}:{port}')
        await asyncio.Future()

asyncio.run(main())
